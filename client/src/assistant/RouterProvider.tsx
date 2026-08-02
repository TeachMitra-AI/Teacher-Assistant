// AI Action Router — the client coordinator (Phase 1, Milestone M6).
//
// A COORDINATOR, NOT A STORE. It owns exactly what no page can own: the session
// slot memory, the pending clarification, the circuit breaker, the catalog
// version, and the sequence number that makes a late response harmless. It owns
// no form values, no generated content, and no navigation history — every one of
// those already has an owner and taking a second one is how a router becomes a
// framework.
//
// ─── ONE PAGE CONSUMES THIS, AND ONLY ONE ──────────────────────────────────
// Guardrail G14 says a page must not consume RouterProvider. Its target is
// GeneratorPage, which the spec names explicitly (§5.5) and which reaches the
// router through a single pure module instead. The Coach composer is different
// in kind: it IS the entry point, and the pending clarification is rendered
// there, so it cannot be reached through a pure function. The requirement that
// actually protects the codebase — a single seam, no scattered coupling, a page
// that still renders if this file is deleted — is met the same way M3 met it:
// CoachPage has ONE import line from assistant/, and this context has an inert
// default so the page renders correctly with the provider absent.
//
// ─── WITH THE FLAG OFF, NOTHING HERE RUNS ──────────────────────────────────
// `submit` returns a passthrough before touching storage, the gate or the
// network. That is what makes "flags off ⇒ zero assistant requests in a network
// trace" provable rather than asserted.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { ASSISTANT_ENABLED } from '../config';
import { executeAction } from './ActionExecutor';
import { postInterpret } from './api';
import { clearCatalog, domainForAction, ensureCatalog, readCachedCatalog } from './catalog';
import { createCircuitBreaker, type CircuitBreaker } from './circuitBreaker';
import { isCommand, normalizeUtterance } from './intentGate';
import { completeAsk, resolveAskReply, type PendingAskState } from './pendingAsk';
import { clearCache, readCached, readCachedMemoryUpdates, writeCached } from './repeatCache';
import { flushOnHide } from './telemetryTransport';
import { advanceTurn, clearMemory, mergeMemory, readMemory } from './sessionMemory';
import type { PendingAsk, ResolvedAction } from './types';

/**
 * What the composer should do next.
 *
 * `passthrough` is the instruction "submit this to the coach exactly as you do
 * today" — which is why the utterance travels with it. Cancelling a clarifying
 * question returns the ORIGINAL message rather than the cancellation, so a
 * teacher who backs out of a question still gets an answer. No utterance ever
 * dead-ends.
 */
export type RoutingResult = 'navigated' | 'asked' | 'passthrough';

export interface RoutingOutcome {
  result: RoutingResult;
  utterance: string;
}

export interface AssistantRoutingValue {
  /** False when the client flag is off. The composer uses this to keep its own path synchronous. */
  enabled: boolean;
  /** True while an /interpret request is outstanding, for the composer's existing spinner. */
  routing: boolean;
  pendingAsk: PendingAskState | null;
  /**
   * Route one composer submission.
   *
   * `isComposerIdle` is the second half of the stale-response guard (CHANGE-9):
   * the caller reports whether the teacher has started typing something new. A
   * response that arrives after they have moved on may not navigate them away
   * mid-thought.
   */
  submit: (utterance: string, isComposerIdle?: () => boolean) => Promise<RoutingOutcome>;
  /** A chip was tapped. Resolved entirely client-side (CHANGE-3). */
  answerWithOption: (value: string) => RoutingOutcome;
  /** The clarifying question was dismissed. */
  cancelAsk: () => RoutingOutcome;
  /** "New chat" — forget the conversation's memory and any pending question. */
  resetSession: () => void;
}

/**
 * What a consumer gets when the provider is absent.
 *
 * Not a thrown error, unlike useOnboarding: this must degrade, because the whole
 * feature is meant to be deletable and a page that crashes without it is a page
 * coupled to it.
 */
const INERT: AssistantRoutingValue = {
  enabled: false,
  routing: false,
  pendingAsk: null,
  submit: async (utterance: string) => ({ result: 'passthrough', utterance }),
  answerWithOption: () => ({ result: 'passthrough', utterance: '' }),
  cancelAsk: () => ({ result: 'passthrough', utterance: '' }),
  resetSession: () => {},
};

const AssistantRoutingContext = createContext<AssistantRoutingValue>(INERT);

/** No composer to consult (a chip tap, a cancel) — those are never stale. */
const ALWAYS_IDLE = () => true;

export function RouterProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const [pendingAsk, setPendingAskState] = useState<PendingAskState | null>(null);
  const [routing, setRouting] = useState(false);

  // The pending ask is read inside async callbacks that would otherwise close
  // over a stale value, so the ref is the source of truth and the state exists
  // only to re-render.
  const pendingAskRef = useRef<PendingAskState | null>(null);
  const setPendingAsk = useCallback((next: PendingAskState | null) => {
    pendingAskRef.current = next;
    setPendingAskState(next);
  }, []);

  /** Monotonic. Only the newest in-flight request is allowed to navigate. */
  const sequenceRef = useRef(0);
  const catalogVersionRef = useRef<number | null>(null);
  const breakerRef = useRef<CircuitBreaker | null>(null);
  if (breakerRef.current === null) breakerRef.current = createCircuitBreaker();

  /**
   * The catalog version to key cache entries on.
   *
   * Seeded from whatever the session already fetched, and 0 before anything has
   * been. A wrong-but-stable value only costs cache misses — it can never make a
   * decision, because the SERVER builds its own catalog on every request and
   * ignores what the client claims.
   */
  const currentCatalogVersion = useCallback((): number => {
    if (catalogVersionRef.current === null) {
      catalogVersionRef.current = readCachedCatalog()?.catalogVersion ?? 0;
    }
    return catalogVersionRef.current;
  }, []);

  const dispatch = useCallback(
    (action: ResolvedAction, utterance: string, requestId?: string): RoutingOutcome => {
      // `requestId` is absent on a repeat-cache hit, and deliberately so: the
      // cache replays a decision made for an earlier request, and reusing that
      // id would attach two deliveries to one decision. An unjoinable delivery
      // is honest; a wrongly-joined one corrupts the metric.
      const outcome = executeAction(action, { navigate, utterance, requestId, domainOf: domainForAction });
      return outcome === 'navigated'
        ? { result: 'navigated', utterance }
        : { result: 'passthrough', utterance };
    },
    [navigate]
  );

  /**
   * The full path: gate → breaker → cache → network → decision.
   *
   * Every early return is the same instruction to the composer — send it to the
   * coach — and every one of them is cheaper than the last thing that was tried.
   */
  const route = useCallback(
    async (
      utterance: string,
      pendingAskPayload: PendingAsk | null,
      isComposerIdle: () => boolean
    ): Promise<RoutingOutcome> => {
      const passthrough: RoutingOutcome = { result: 'passthrough', utterance };

      // Tier 1. Pure, local, and the reason a coaching question costs nothing.
      if (!isCommand(utterance)) return passthrough;

      // Layer 6. A failing endpoint is not asked again for a minute.
      const breaker = breakerRef.current;
      if (breaker && breaker.isOpen()) return passthrough;

      // Best-effort and deliberately NOT awaited: the catalog is needed only for
      // the unknown-id fallback and the cache key, both of which tolerate being
      // one turn late. Awaiting it would put a second network deadline in front
      // of routing on exactly the connection least able to afford it.
      void ensureCatalog().then((catalog) => {
        if (catalog) catalogVersionRef.current = catalog.catalogVersion;
      });

      const key = normalizeUtterance(utterance);

      // Tier 2. Skipped while answering a question: the cached decision was made
      // for a different, complete message.
      if (!pendingAskPayload) {
        const catalogVersion = currentCatalogVersion();
        const cached = readCached(key, catalogVersion);
        if (cached) {
          // A cache hit replays a past decision without a network call, and
          // must replay its effect on session memory too — otherwise a value
          // the teacher stated once is correctly filled on every repeat but
          // never actually remembered past the first time, because the ONLY
          // other place memory is written is a few lines below, on the
          // network path this hit just skipped entirely.
          mergeMemory(readCachedMemoryUpdates(key, catalogVersion));
          return dispatch(cached, utterance);
        }
      }

      // Tier 3. The only network call on this path.
      const sequence = sequenceRef.current + 1;
      sequenceRef.current = sequence;
      setRouting(true);
      try {
        const outcome = await postInterpret({
          utterance,
          catalogVersion: currentCatalogVersion(),
          memory: readMemory(),
          pendingAsk: pendingAskPayload,
          turn: advanceTurn(),
          sequence,
        });

        if (outcome.status === 'unavailable') {
          if (breaker) breaker.trip();
          return passthrough;
        }
        if (outcome.status !== 'ok') return passthrough;

        const response = outcome.response;

        // CHANGE-9, both halves. A superseded request, or a teacher who has
        // started typing something else, may NOT be navigated. Note that the
        // message is still answered — discarding a response must never mean
        // discarding the teacher's question.
        if (sequence !== sequenceRef.current || !isComposerIdle()) return passthrough;

        // The signal the catalog endpoint exists for: a version this client has
        // not seen means its cached assumptions are void.
        if (response.catalogVersion !== currentCatalogVersion()) {
          catalogVersionRef.current = response.catalogVersion;
          clearCatalog();
          clearCache();
        }

        if (response.passthrough || !Array.isArray(response.actions) || response.actions.length === 0) {
          return passthrough;
        }

        // Documented Phase 1 contract: execute actions[0], ignore the rest. The
        // array exists so Phase 4 is additive rather than a breaking change.
        const action = response.actions[0];

        if (action && action.decision === 'ask' && action.ask) {
          // No memory is written here, matching the server, which refuses to
          // emit memoryUpdates on an ask: a turn that ended in a question has
          // not settled anything worth remembering.
          setPendingAsk({ action, utterance, requestId: response.requestId });
          return { result: 'asked', utterance };
        }

        mergeMemory(response.memoryUpdates);
        if (action) writeCached(key, response.catalogVersion, action, response.memoryUpdates);
        return action ? dispatch(action, utterance, response.requestId) : passthrough;
      } finally {
        setRouting(false);
      }
    },
    [currentCatalogVersion, dispatch, setPendingAsk]
  );

  const submit = useCallback(
    async (utterance: string, isComposerIdle: () => boolean = ALWAYS_IDLE): Promise<RoutingOutcome> => {
      if (!ASSISTANT_ENABLED) return { result: 'passthrough', utterance };

      const pending = pendingAskRef.current;
      if (!pending) return route(utterance, null, isComposerIdle);

      // Answering a clarifying question by typing rather than tapping.
      const value = resolveAskReply(pending.action.ask, utterance);
      setPendingAsk(null);

      if (value !== null) {
        // Identical to a chip: no network, no model call (CHANGE-3).
        return dispatch(completeAsk(pending.action, value), pending.utterance, pending.requestId);
      }

      // Not an answer to this question — the teacher has moved on. Classify it
      // as a new message, carrying pendingAsk on the wire so the envelope is
      // complete. The server validates and currently ignores it (M5 decision
      // D5), which simply makes this turn a normal classification.
      return route(
        utterance,
        { actionId: pending.action.actionId, slot: pending.action.ask ? pending.action.ask.slot : '' },
        isComposerIdle
      );
    },
    [dispatch, route, setPendingAsk]
  );

  const answerWithOption = useCallback(
    (value: string): RoutingOutcome => {
      const pending = pendingAskRef.current;
      if (!pending) return { result: 'passthrough', utterance: '' };
      setPendingAsk(null);
      return dispatch(completeAsk(pending.action, value), pending.utterance, pending.requestId);
    },
    [dispatch, setPendingAsk]
  );

  const cancelAsk = useCallback((): RoutingOutcome => {
    const pending = pendingAskRef.current;
    setPendingAsk(null);
    // The original message goes to the coach. A teacher who backs out of
    // "quiz or worksheet?" still asked for something.
    return { result: 'passthrough', utterance: pending ? pending.utterance : '' };
  }, [setPendingAsk]);

  const resetSession = useCallback(() => {
    clearMemory();
    setPendingAsk(null);
    // The repeat cache survives deliberately: its entries carry no memory-derived
    // values (decision D12), so none of them can leak the previous conversation
    // into the next one.
  }, [setPendingAsk]);

  /**
   * Telemetry's only lifecycle hook (M8).
   *
   * The provider owns it because a module singleton cannot register and tear down
   * a listener, and this is the one place whose lifetime matches the feature's.
   * GeneratorPage still does NOT consume this provider (G14): the transport is a
   * module singleton both reach independently, so the page keeps its single
   * import line and the folder stays deletable.
   *
   * `visibilitychange` rather than `unload`: on the target platform (low-end
   * mobile Chrome) `unload` frequently never fires, while backgrounding a tab
   * reliably goes hidden. Still best-effort, which is exactly why abandonment is
   * derived from a missing outcome rather than reported by a beacon.
   *
   * With the flag off this registers nothing — no listener, no timer, no
   * background activity of any kind.
   *
   * Placed below `submit` deliberately: the flags-off source guard in
   * RouterProvider.test.ts pins the FIRST `if (!ASSISTANT_ENABLED)` in this file
   * to submit's short-circuit, which is the check that makes "flags off ⇒ zero
   * assistant requests" provable. Declaring this effect above it would have
   * shadowed that guard without weakening the actual control, and a guard that
   * silently points at the wrong line is worse than no guard.
   */
  useEffect(() => {
    if (!ASSISTANT_ENABLED) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushOnHide();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  const value = useMemo<AssistantRoutingValue>(
    () => ({
      enabled: ASSISTANT_ENABLED,
      routing,
      pendingAsk,
      submit,
      answerWithOption,
      cancelAsk,
      resetSession,
    }),
    [routing, pendingAsk, submit, answerWithOption, cancelAsk, resetSession]
  );

  return <AssistantRoutingContext.Provider value={value}>{children}</AssistantRoutingContext.Provider>;
}

/**
 * The composer's single seam into the router.
 *
 * Returns the inert value when the provider is absent, so the page renders and
 * behaves exactly as it did before this feature existed.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAssistantRouting(): AssistantRoutingValue {
  return useContext(AssistantRoutingContext);
}
