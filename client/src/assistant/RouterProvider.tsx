// Client coordinator for the action router. It owns only what no page can: session memory, the pending clarification,
// the circuit breaker, the catalog version and the sequence number that makes a late response harmless. No form
// values, generated content or navigation history.
// Coach's composer is the one consumer (via a single import); the context has an inert default so the page still
// renders without the provider. With the flag off `submit` passes through before touching storage or the network.

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
 * What the composer should do next. `passthrough` means "send it to the coach as usual", so the utterance travels
 * with it; cancelling a question returns the original message, so nothing dead-ends.
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
   * Routes one composer submission. `isComposerIdle` reports whether the teacher has started typing something
   * new; a response that arrives after that must not navigate them away mid-thought.
   */
  submit: (utterance: string, isComposerIdle?: () => boolean) => Promise<RoutingOutcome>;
  /** A chip was tapped. Resolved client-side, no network. */
  answerWithOption: (value: string) => RoutingOutcome;
  /** The clarifying question was dismissed. */
  cancelAsk: () => RoutingOutcome;
  /** "New chat" — forget the conversation's memory and any pending question. */
  resetSession: () => void;
}

// Inert value for when the provider is absent. Doesn't throw, so pages stay decoupled from the feature.
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

// No composer to consult (chip tap, cancel); those are never stale.
const ALWAYS_IDLE = () => true;

export function RouterProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const [pendingAsk, setPendingAskState] = useState<PendingAskState | null>(null);
  const [routing, setRouting] = useState(false);

  // Async callbacks read this, so the ref is the source of truth and the state only triggers re-renders.
  const pendingAskRef = useRef<PendingAskState | null>(null);
  const setPendingAsk = useCallback((next: PendingAskState | null) => {
    pendingAskRef.current = next;
    setPendingAskState(next);
  }, []);

  // Monotonic; only the newest in-flight request may navigate.
  const sequenceRef = useRef(0);
  const catalogVersionRef = useRef<number | null>(null);
  const breakerRef = useRef<CircuitBreaker | null>(null);
  if (breakerRef.current === null) breakerRef.current = createCircuitBreaker();

  // Catalog version for cache keys. A wrong value only costs cache misses: the server builds its own catalog
  // and ignores what the client claims.
  const currentCatalogVersion = useCallback((): number => {
    if (catalogVersionRef.current === null) {
      catalogVersionRef.current = readCachedCatalog()?.catalogVersion ?? 0;
    }
    return catalogVersionRef.current;
  }, []);

  const dispatch = useCallback(
    (action: ResolvedAction, utterance: string, requestId?: string): RoutingOutcome => {
      // No requestId on a cache hit: it replays an earlier decision, and reusing that id would attach two
      // deliveries to one decision.
      const outcome = executeAction(action, { navigate, utterance, requestId, domainOf: domainForAction });
      return outcome === 'navigated'
        ? { result: 'navigated', utterance }
        : { result: 'passthrough', utterance };
    },
    [navigate]
  );

  // gate → breaker → cache → network → decision. Every early return means "send it to the coach".
  const route = useCallback(
    async (
      utterance: string,
      pendingAskPayload: PendingAsk | null,
      isComposerIdle: () => boolean
    ): Promise<RoutingOutcome> => {
      const passthrough: RoutingOutcome = { result: 'passthrough', utterance };

      // Local gate: a coaching question costs nothing.
      if (!isCommand(utterance)) return passthrough;

      // A failing endpoint isn't asked again for a minute.
      const breaker = breakerRef.current;
      if (breaker && breaker.isOpen()) return passthrough;

      // Not awaited: only the unknown-id fallback and the cache key need it, and both tolerate being a turn late.
      void ensureCatalog().then((catalog) => {
        if (catalog) catalogVersionRef.current = catalog.catalogVersion;
      });

      const key = normalizeUtterance(utterance);

      // Skipped while answering a question; the cached decision was for a different, complete message.
      if (!pendingAskPayload) {
        const catalogVersion = currentCatalogVersion();
        const cached = readCached(key, catalogVersion);
        if (cached) {
          // Replay the memory writes too, or a value stated once would never be remembered on repeats
          // (the network path below is the only other place memory is written).
          mergeMemory(readCachedMemoryUpdates(key, catalogVersion));
          return dispatch(cached, utterance);
        }
      }

      // The only network call on this path.
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

        // Drop the response if it's superseded or the teacher started typing something else. The message
        // is still answered by the coach.
        if (sequence !== sequenceRef.current || !isComposerIdle()) return passthrough;

        // A new catalog version voids the client's cached assumptions.
        if (response.catalogVersion !== currentCatalogVersion()) {
          catalogVersionRef.current = response.catalogVersion;
          clearCatalog();
          clearCache();
        }

        if (response.passthrough || !Array.isArray(response.actions) || response.actions.length === 0) {
          return passthrough;
        }

        // Only actions[0] is executed for now; the array leaves room for more later.
        const action = response.actions[0];

        if (action && action.decision === 'ask' && action.ask) {
          // No memory on an ask, matching the server: a turn that ended in a question settled nothing.
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

      // Answered by typing rather than tapping.
      const value = resolveAskReply(pending.action.ask, utterance);
      setPendingAsk(null);

      if (value !== null) {
        // Same as a chip: no network, no model call.
        return dispatch(completeAsk(pending.action, value), pending.utterance, pending.requestId);
      }

      // Not an answer; the teacher moved on. Classify it as a new message, sending pendingAsk so the envelope is
      // complete (the server validates it and currently ignores it).
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
    // The original message goes to the coach; backing out of the question doesn't cancel the request.
    return { result: 'passthrough', utterance: pending ? pending.utterance : '' };
  }, [setPendingAsk]);

  const resetSession = useCallback(() => {
    clearMemory();
    setPendingAsk(null);
    // The repeat cache survives: its entries hold no memory-derived values, so nothing leaks into the next chat.
  }, [setPendingAsk]);

  // Flushes telemetry when the tab is hidden. Owned here because a module singleton can't register/tear down a
  // listener. `visibilitychange` rather than `unload`, which often never fires on mobile Chrome. Registers
  // nothing with the flag off.
  // Keep this below `submit`: RouterProvider.test.ts pins the first ASSISTANT_ENABLED check in this file to
  // submit's short-circuit.
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

/** The composer's single seam into the router; returns the inert value when there's no provider. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAssistantRouting(): AssistantRoutingValue {
  return useContext(AssistantRoutingContext);
}
