import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Sidebar from '../components/Sidebar';
import ChatSearchOverlay from '../components/ChatSearchOverlay';
import WelcomeScreen from '../components/WelcomeScreen';
import MessageList from '../components/MessageList';
import TeachingContextMenu from '../components/TeachingContextMenu';
import Composer from '../components/Composer';
import OnboardingTip from '../components/OnboardingTip';
import ChatResizeHandle from '../components/ChatResizeHandle';
import AiClarifyPrompt from '../components/AiClarifyPrompt';
import ScrollToBottom from '../components/ScrollToBottom';
import { useToast } from '../components/Toast';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useAttachments, type SelectedAttachment } from '../hooks/useAttachments';
import { usePreferences } from '../hooks/usePreferences';
import { useAuth } from '../auth';
import { useOnboarding } from '../onboarding';
import { useOnboardingTip } from '../hooks/useOnboardingTip';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useEdgeSwipeToOpen } from '../hooks/useSidebarSwipe';
import { useHistoryOverrides } from '../hooks/useHistoryOverrides';
import { useRetryCountdown } from '../hooks/useRetryCountdown';
import { retryMessage } from '../lib/retryCountdown';
import { api, ApiError } from '../api';
// This page's ONLY import from the AI Action Router (milestone M6). Keeping the
// coupling to a single line is what makes the feature deletable and what keeps
// this file — the most-used path in the product — reviewable.
import { useAssistantRouting, type RoutingOutcome } from '../assistant/RouterProvider';
import { persistOnboarding } from '../lib/onboarding';
import { ADMIN_ROLES, CLASSROOM_MODE_ENABLED, SPEECH_LOCALE } from '../config';
import type { AttachmentMeta, CoachResponse, HistoryItem, QueryContext, Turn } from '../types';

const EMPTY_CONTEXT: QueryContext = { grade: '', subject: '', classroomType: '', issueType: '' };

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 768px)').matches;
}

function newTurnId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random()}`;
}

// Chat/composer resize handle: keeps the composer usable at its smallest and
// prevents a drag from ever swallowing the whole viewport at its largest.
const COMPOSER_MIN_HEIGHT = 110;
const COMPOSER_MAX_HEIGHT_RATIO = 0.65;
const COMPOSER_KEYBOARD_STEP = 24;

function clampComposerHeight(value: number): number {
  const max = window.innerHeight * COMPOSER_MAX_HEIGHT_RATIO;
  return Math.min(Math.max(value, COMPOSER_MIN_HEIGHT), max);
}

export default function CoachPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { show } = useToast();
  const { user, updateUser } = useAuth();
  const { introReopened, closeIntro } = useOnboarding();
  const router = useAssistantRouting();
  const navigate = useNavigate();
  const prefs = user?.preferences ?? {};
  const displayName = user?.displayName || user?.name || '';
  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;
  const isSuperAdmin = user?.role === 'super_admin';
  // First-run onboarding intro: shown once, only in the empty welcome state,
  // until the teacher dismisses it. The shown-once flag lives on the account
  // (preferences.onboarding) so it follows them across devices — see Phase 0.
  // `introReopened` is the Phase 2 "Getting Started" re-entry: it re-shows the
  // same intro on demand without touching the persisted first-run gate.
  const showIntro = introReopened || !prefs.onboarding?.seenWelcomeIntro;

  const [language, setLanguage] = useState(prefs.defaultLanguage || 'en');
  const [query, setQuery] = useState('');
  const [context, setContext] = useState<QueryContext>({
    grade: prefs.defaultGrade ?? '',
    subject: prefs.defaultSubject ?? '',
    classroomType: prefs.defaultClassroomType ?? '',
    issueType: '',
  });

  // ---- Classroom Mode (docs/classroom-mode.md) -----------------------------
  //
  // Plain component state, deliberately NOT persisted to user.preferences (D16).
  // It survives navigation within the session and resets to OFF on a reload.
  // The risk being managed is not annoyance but silent spend: this is the one
  // mode where every question costs several model calls instead of one, and a
  // mode remembered across sessions is one a teacher stops noticing. Two taps
  // tomorrow is the cheaper mistake.
  const [classroomMode, setClassroomMode] = useState(false);
  // First-visit tip pointing at the "+" button (P7).
  const classroomTip = useOnboardingTip('classroom-mode-intro');

  function setClassroomModeOn(on: boolean) {
    setClassroomMode(on);
    show(on ? 'Classroom Mode on' : 'Classroom Mode off', 'success');
  }

  const [turns, setTurns] = useState<Turn[]>([]);
  const isSubmitting = turns.some((t) => t.status === 'pending');

  // Every Gemini API key exhausted (see api.ts's ApiError.retryAt) — blocks
  // sending until the soonest key recovers, then clears itself automatically
  // (no auto-resend of what was typed; see the countdown effect below).
  const [aiCooldownUntil, setAiCooldownUntil] = useState<number | null>(null);
  const { remainingMs: aiCooldownRemainingMs, ready: aiCooldownReady } = useRetryCountdown(aiCooldownUntil);
  useEffect(() => {
    if (aiCooldownUntil != null && aiCooldownReady) setAiCooldownUntil(null);
  }, [aiCooldownUntil, aiCooldownReady]);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Lifted up from Sidebar (which used to own this directly) so
  // ChatSearchOverlay can show the same pin/rename state — a chat renamed or
  // pinned from either surface must show consistently in the other, and two
  // separate hook instances would each keep their own, disagreeing overrides.
  const {
    isPinned, titleFor, pinnedIds, togglePin,
    rename: renameHistoryItem, forget: forgetHistoryItem,
  } = useHistoryOverrides(history);
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobileViewport());
  // Chat-history search (TopBar's Search icon → ChatSearchOverlay.tsx, an
  // overlay in the main content column, NOT inside Sidebar). Only whether
  // it's open lives here; the query text is local to the overlay itself,
  // since nothing outside it needs to read that. Independent of
  // sidebarOpen — see toggleHistorySearch below for the one place they
  // still interact, and why.
  const [historySearchOpen, setHistorySearchOpen] = useState(false);

  // null = the composer keeps its default content-sized (auto) height; a
  // number is only ever set once the teacher actually drags the resize
  // handle, and only applies on desktop/tablet in the active-chat state.
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());
  // A SECOND, narrower breakpoint than `isMobile` (768px) above, matching the
  // 640px at which the stylesheet switches the Coach page into its phone
  // layout. Used below to decide when the scroll-to-latest button is needed —
  // see its comment.
  const isPhoneLayout = useMediaQuery('(max-width: 640px)');

  const bottomRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const resizeDragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

  const voice = useVoiceInput(SPEECH_LOCALE[language] || 'en-US', (text) => {
    setQuery((q) => (q ? `${q} ${text}` : text));
  });
  const attachments = useAttachments();

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await api<{ queries: HistoryItem[] }>('/queries?limit=20');
      setHistory(data.queries);
    } catch {
      // History is non-critical; fail quietly.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Toggles the search overlay. On mobile, the drawer is a fixed full-screen
  // panel (z-index 1200 — see .sidebar's mobile rule in index.css) that would
  // otherwise sit visually on top of the overlay (scoped to .coach-main-chat,
  // a much lower stacking context) if both were open at once — closing it
  // here avoids that dead-looking overlapping-layers state. Desktop's inline
  // sidebar has no such conflict (it's a normal-flow column, not an overlay),
  // so it's left alone there.
  function toggleHistorySearch() {
    if (historySearchOpen) {
      setHistorySearchOpen(false);
      return;
    }
    if (isMobile && sidebarOpen) setSidebarOpen(false);
    setHistorySearchOpen(true);
  }

  // Close the sidebar (acting as a mobile drawer) with Escape. Skipped while
  // search is open: ChatSearchOverlay closes itself on the same Escape press
  // (via useDismissable), and this would otherwise ALSO fire — on desktop
  // that means it would collapse the always-visible inline sidebar too, just
  // because the teacher wanted to dismiss search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || historySearchOpen) return;
      setSidebarOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historySearchOpen]);

  // When the viewport crosses from desktop into mobile, the sidebar switches
  // from an inline column to a fixed drawer — close it so it doesn't
  // unexpectedly cover the screen. Only fires on the transition, so it never
  // interferes with the user opening/closing the drawer while on mobile.
  useEffect(() => {
    let wasMobile = isMobileViewport();
    function onResize() {
      const nowMobile = isMobileViewport();
      if (nowMobile && !wasMobile) {
        setSidebarOpen(false);
        // A composer height dragged on desktop/tablet has no safe meaning on
        // a phone viewport — drop it so mobile always gets the default,
        // content-sized composer.
        setComposerHeight(null);
      }
      setIsMobile(nowMobile);
      wasMobile = nowMobile;
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Additional gesture on top of the existing tap-to-open icon — swipe right
  // from the left screen edge to open the drawer (mobile only; see
  // useSidebarSwipe.ts). Only armed while the drawer is closed, so it never
  // competes with the swipe-to-close gesture Sidebar attaches to itself.
  // Also closes search if it happens to be open — same overlapping-layers
  // concern toggleHistorySearch guards against in the other direction.
  useEdgeSwipeToOpen(isMobile && !sidebarOpen, () => {
    setHistorySearchOpen(false);
    setSidebarOpen(true);
  });

  // "Getting Started" (Phase 2) can be triggered from any page, including while a
  // conversation is on screen. The intro only lives in the empty welcome state,
  // so clear the current thread to reveal it — the conversation itself is safe in
  // history and reopenable from the sidebar, exactly like starting a new chat.
  useEffect(() => {
    if (!introReopened) return;
    setTurns([]);
    setQuery('');
    if (isMobileViewport()) setSidebarOpen(false);
  }, [introReopened]);

  function scrollToBottom() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }

  async function runTurn(id: string, queryText: string, lang: string, ctx: QueryContext, classroom: boolean) {
    try {
      const res = await api<CoachResponse>('/coach', {
        method: 'POST',
        // `classroomMode` is sent only when it is actually on, so a teacher who
        // never touches the feature produces a request body identical to the
        // one this page has always sent.
        body: { query: queryText, language: lang, context: ctx, ...(classroom ? { classroomMode: true } : {}) },
      });
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'done', response: res, rating: null } : t)));
      loadHistory();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to get a response. Please try again.';
      const errorIsNetwork = err instanceof ApiError && err.status === 0;
      const retryAt = err instanceof ApiError && err.code === 'RATE_LIMITED' ? err.retryAt : undefined;
      if (retryAt != null) setAiCooldownUntil(retryAt);
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error', error: message, errorIsNetwork, retryAt } : t)));
    } finally {
      scrollToBottom();
    }
  }

  // Persist the first-run welcome intro as "seen" (idempotent — a no-op once the
  // gate is set). Called both on explicit dismissal and on first engagement, so a
  // teacher who just starts using the app without clicking "Got it" still isn't
  // re-shown the intro on their next login. Optimistic + non-blocking.
  function markIntroSeen() {
    if (!user || user.preferences.onboarding?.seenWelcomeIntro) return;
    void persistOnboarding(user, updateUser, { ...user.preferences.onboarding, seenWelcomeIntro: true });
  }

  async function submitTurn(queryText: string, lang: string, ctx: QueryContext) {
    // Starting any turn means the user is done with the intro: hide it now and
    // persist the "seen" gate so it doesn't come back next session.
    closeIntro();
    markIntroSeen();
    const id = newTurnId();
    // Snapshotted onto the turn at submit time, exactly as `language` and
    // `context` are — see the field's comment in types.ts for why a retry must
    // not read it live.
    const classroom = CLASSROOM_MODE_ENABLED && classroomMode;
    setTurns((ts) => [
      ...ts,
      { id, query: queryText, language: lang, context: ctx, status: 'pending', rating: null, classroomMode: classroom, startedAt: Date.now() },
    ]);
    scrollToBottom();
    await runTurn(id, queryText, lang, ctx, classroom);
  }

  // The multimodal-attachment sibling of runTurn/submitTurn — a SEPARATE path
  // (POST /api/coach/attachment, multipart) rather than a branch inside the
  // two functions above, so the existing text/voice turn flow above is never
  // touched by this feature (approved design: see
  // docs/multimodal-attachments-architecture.md). Deliberately bypasses the
  // AI Action Router entirely — an attachment-bearing message is Coach-shaped
  // Q&A, not a navigation/prefill action, so there is nothing for the router
  // to resolve; see the architecture doc's "AI routing changes" section for
  // the full reasoning.
  //
  // ALL files go in ONE request (repeated 'files' form entries), matching the
  // approved multi-attachment design: the backend sends everything to Gemini
  // together so it reasons over the complete set, not one call per file.
  async function runTurnWithAttachments(id: string, queryText: string, lang: string, files: File[]) {
    try {
      const formData = new FormData();
      formData.append('query', queryText);
      formData.append('language', lang);
      for (const file of files) formData.append('files', file);
      const res = await api<CoachResponse>('/coach/attachment', { method: 'POST', body: formData });
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'done', response: res, rating: null } : t)));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to get a response. Please try again.';
      const errorIsNetwork = err instanceof ApiError && err.status === 0;
      const retryAt = err instanceof ApiError && err.code === 'RATE_LIMITED' ? err.retryAt : undefined;
      if (retryAt != null) setAiCooldownUntil(retryAt);
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error', error: message, errorIsNetwork, retryAt } : t)));
    } finally {
      scrollToBottom();
    }
  }

  async function submitTurnWithAttachments(queryText: string, lang: string, selected: SelectedAttachment[]) {
    closeIntro();
    markIntroSeen();
    const id = newTurnId();
    const meta: AttachmentMeta[] = selected.map((a) => ({ name: a.file.name, kind: a.kind }));
    // No `context` is sent — the attachment endpoint has no grade/subject
    // fields (unlike /coach); EMPTY_CONTEXT here is only to satisfy Turn's
    // type, never sent over the wire.
    setTurns((ts) => [
      ...ts,
      { id, query: queryText, language: lang, context: EMPTY_CONTEXT, status: 'pending', rating: null, attachments: meta, startedAt: Date.now() },
    ]);
    scrollToBottom();
    await runTurnWithAttachments(
      id,
      queryText,
      lang,
      selected.map((a) => a.file)
    );
  }

  // Every router outcome ends in one of two places: the teacher has been taken
  // somewhere, or their message goes to the coach exactly as it always has.
  // 'asked' is the third state and needs nothing here — the question is on
  // screen and the teacher's next action decides what happens to it.
  function settleRouting(outcome: RoutingOutcome) {
    if (outcome.result !== 'passthrough') return;
    const text = outcome.utterance.trim();
    if (!text) return;
    submitTurn(text, language, context);
  }

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      show('Please enter a question', 'error');
      return;
    }
    const pendingAttachments = attachments.attachments;
    // Clearing the text is all that's needed — the Composer resizes itself from
    // the value it is given (one owner of the box's height, see its layout
    // effect), so nothing here has to touch the textarea's style.
    setQuery('');

    // An attachment-bearing message skips the AI Action Router entirely and
    // goes straight to Coach — see runTurnWithAttachments's comment for why.
    if (pendingAttachments.length > 0) {
      attachments.clear();
      submitTurnWithAttachments(trimmed, language, pendingAttachments);
      return;
    }

    // The AI Action Router's pre-pass (milestone M6). With the client flag off
    // this is one boolean check and the original synchronous call below — no
    // await, no request, and no behavioural difference from before the feature
    // existed.
    if (!router.enabled) {
      submitTurn(trimmed, language, context);
      return;
    }
    // The live textarea value is the second half of the stale-response guard
    // (CHANGE-9): a response that lands after the teacher has started typing
    // again must not navigate them away mid-thought.
    void router.submit(trimmed, () => (textareaRef.current?.value ?? '') === '').then(settleRouting);
  }

  async function handleRetry(turn: Turn) {
    // The files themselves are never kept once a turn is submitted (see
    // useAttachments/runTurnWithAttachments) — only their display metadata
    // is, so a blind retry would silently ask Coach about "these files" with
    // nothing attached. Ask the teacher to re-attach instead of guessing wrong.
    if (turn.attachments && turn.attachments.length > 0) {
      show('To retry, please re-attach the file(s) and ask again.', 'error');
      return;
    }
    setTurns((ts) => ts.map((t) => (t.id === turn.id
      // startedAt is reset: a retry is a new wait, and inheriting the old
      // turn's elapsed time would open it already saying "taking longer than
      // usual" with a Cancel button.
      ? { ...t, status: 'pending', error: undefined, startedAt: Date.now() }
      : t)));
    // `turn.classroomMode ?? false` — the mode as it was when this turn was
    // first submitted, not as it is now. Turns created before this field
    // existed simply retry without it.
    await runTurn(turn.id, turn.query, turn.language, turn.context, turn.classroomMode ?? false);
  }

  // Edit-and-resubmit a sent prompt (MessageBubble's Edit action). Updates
  // the SAME turn in place — same `id`, same snapshotted language/context/
  // classroomMode it was first submitted with — rather than appending a new
  // one, so the thread never grows a duplicate message and the edited
  // question simply gets a new answer where the old one was. Mirrors
  // handleRetry above, just with the query text also changing.
  async function handleEditTurn(turnId: string, newQuery: string) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn) return;
    setTurns((ts) => ts.map((t) => (t.id === turnId
      // `restored: false` — this is a fresh generation for the edited text,
      // not the rebuilt-from-history state selectHistory produces, so
      // ClassroomSet must not treat its cards as already-idle (D24).
      ? { ...t, query: newQuery, status: 'pending', error: undefined, response: undefined, rating: null, restored: false, startedAt: Date.now() }
      : t)));
    scrollToBottom();
    await runTurn(turnId, newQuery, turn.language, turn.context, turn.classroomMode ?? false);
  }

  async function handleFeedback(turnId: string, rating: 'helpful' | 'not_helpful') {
    const turn = turns.find((t) => t.id === turnId);
    const queryId = turn?.response?.queryId;
    if (!queryId) return;
    setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, rating } : t)));
    try {
      await api('/feedback', { method: 'POST', body: { queryId, rating } });
      show('Thanks for your feedback', 'success');
    } catch {
      setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, rating: null } : t)));
      show('Could not save feedback', 'error');
    }
  }

  function handleNewChat() {
    setTurns([]);
    setQuery('');
    setContext(EMPTY_CONTEXT);
    attachments.clear();
    // A new conversation must not inherit the previous one's remembered grade,
    // subject or topic — a stale slot produces a confident, wrong worksheet.
    router.resetSession();
    if (isMobileViewport()) setSidebarOpen(false);
  }

  function pickPrompt(prompt: string) {
    setQuery(prompt);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    });
  }

  // Dismiss the intro. Always clears the transient reopen flag first, then marks
  // the intro seen. On a "Getting Started" re-view the gate is already set, so
  // markIntroSeen is a no-op — reopening never resets the persisted state.
  function handleDismissIntro() {
    closeIntro();
    markIntroSeen();
  }

  async function handleDeleteHistory(item: HistoryItem) {
    const previous = history;
    setHistory((h) => h.filter((x) => x.id !== item.id));
    try {
      await api(`/queries/${item.id}`, { method: 'DELETE' });
      show('Removed from history', 'success');
    } catch (err) {
      setHistory(previous); // rollback on failure
      show(err instanceof ApiError ? err.message : 'Could not delete', 'error');
    }
  }

  async function handleClearHistory() {
    if (history.length === 0) return;
    const confirmed = window.confirm('Delete your entire question history? This cannot be undone.');
    if (!confirmed) return;
    const previous = history;
    setHistory([]);
    try {
      await api('/queries', { method: 'DELETE' });
      show('History cleared', 'success');
    } catch (err) {
      setHistory(previous); // rollback on failure
      show(err instanceof ApiError ? err.message : 'Could not clear history', 'error');
    }
  }

  function selectHistory(item: HistoryItem) {
    const mergedContext = { ...EMPTY_CONTEXT, ...item.context };
    setTurns([{
      id: item.id,
      query: item.query,
      language: item.language,
      context: mergedContext,
      status: 'done',
      rating: item.rating,
      // Reopening a chat must not spend model calls. The plan is restored so
      // the cards reappear, but `restored` keeps them idle until the teacher
      // presses Generate on the one they want (D24).
      restored: true,
      response: {
        success: true,
        text: item.text,
        language: item.language,
        context: item.context,
        queryId: item.id,
        ...(item.classroom ? { classroom: item.classroom } : {}),
      },
    }]);
    setLanguage(item.language);
    setContext(mergedContext);
    setQuery('');
    if (isMobileViewport()) setSidebarOpen(false);
    scrollToBottom();
  }

  function setCtx(key: keyof QueryContext, value: string) {
    setContext((c) => ({ ...c, [key]: value }));
  }

  const activeHistoryId = turns.length === 1 ? turns[0].response?.queryId ?? null : null;
  const isEmpty = turns.length === 0;

  // The resize handle only exists on desktop/tablet, in the active-chat
  // state — never on mobile, and never over the empty welcome screen (which
  // uses its own natural-scroll layout on mobile and has nothing to resize
  // against on desktop either).
  const resizeEnabled = !isMobile && !isEmpty;

  // If the thread is cleared mid-drag (e.g. "New chat"), the handle unmounts
  // under the pointer — drop any in-flight drag state so a stray pointerup
  // on a since-removed element can't do anything.
  useEffect(() => {
    if (!resizeEnabled) resizeDragRef.current = null;
  }, [resizeEnabled]);

  function currentComposerHeight(): number {
    if (composerHeight != null) return composerHeight;
    return composerDockRef.current?.getBoundingClientRect().height ?? COMPOSER_MIN_HEIGHT;
  }

  function handleResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeEnabled) return;
    resizeDragRef.current = { pointerId: e.pointerId, startY: e.clientY, startHeight: currentComposerHeight() };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handleResizePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    // The handle sits above the composer, so dragging up (negative deltaY)
    // grows the composer and dragging down shrinks it.
    const deltaY = e.clientY - drag.startY;
    setComposerHeight(clampComposerHeight(drag.startHeight - deltaY));
  }

  function handleResizePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    resizeDragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleResizeKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!resizeEnabled) return;
    const current = currentComposerHeight();
    let next: number | null = null;
    if (e.key === 'ArrowUp') next = clampComposerHeight(current + COMPOSER_KEYBOARD_STEP);
    else if (e.key === 'ArrowDown') next = clampComposerHeight(current - COMPOSER_KEYBOARD_STEP);
    else if (e.key === 'Home') next = clampComposerHeight(COMPOSER_MIN_HEIGHT);
    else if (e.key === 'End') next = clampComposerHeight(window.innerHeight * COMPOSER_MAX_HEIGHT_RATIO);
    if (next == null) return;
    e.preventDefault();
    setComposerHeight(next);
  }

  return (
    <div className={`page coach-shell${isEmpty ? ' coach-empty' : ''}`}>
      <div className="coach-body">
        <Sidebar
          open={sidebarOpen}
          items={history}
          loading={historyLoading}
          activeId={activeHistoryId}
          isMobile={isMobile}
          isPinned={isPinned}
          titleFor={titleFor}
          pinnedIds={pinnedIds}
          togglePin={togglePin}
          rename={renameHistoryItem}
          forget={forgetHistoryItem}
          onClose={() => setSidebarOpen(false)}
          onOpen={() => setSidebarOpen(true)}
          onNewChat={handleNewChat}
          onSelect={selectHistory}
          onDelete={handleDeleteHistory}
          onClearAll={handleClearHistory}
          onSearchToggle={toggleHistorySearch}
          searchOpen={historySearchOpen}
        />

        <main className="coach-main-chat">
          {/* Scoped to THIS column, not the whole viewport — see the
              .coach-shell/.coach-body comment in index.css for why TopBar
              lives here instead of as a page-wide header above the sidebar.
              showProfileMenu=false: this page's account menu lives at the
              bottom of the Sidebar instead (see Sidebar.tsx). Brand/search/
              collapse also now live in the Sidebar's own header — this bar
              keeps only page nav, theme, and the teaching-context icon
              (extraControl). The one exception is onSidebarToggle: while the
              drawer is CLOSED on mobile it's off-canvas, so the button that
              reopens it can't live inside it — TopBar renders that single
              control itself in that case only (see TopBar.tsx), never at the
              same time as the Sidebar's own close/collapse button. */}
          <TopBar
            preferences={preferences}
            onSidebarToggle={() => setSidebarOpen(true)}
            sidebarOpen={sidebarOpen}
            isMobile={isMobile}
            showProfileMenu={false}
            extraControl={(
              <TeachingContextMenu language={language} onLanguageChange={setLanguage} context={context} onContextChange={setCtx} />
            )}
          />

          {/* Wraps the scroller ONLY, so the scroll-to-latest button below can
              be positioned against the answer area rather than against the
              whole column — pinned to the column it would sit on top of the
              composer's send button. */}
          <div className="chat-area">
          <div className="chat-scroll" ref={chatScrollRef}>
            <div className="chat-inner">
              {turns.length === 0 ? (
                <WelcomeScreen
                  name={displayName}
                  isAdmin={isAdmin}
                  isSuperAdmin={isSuperAdmin}
                  showIntro={showIntro}
                  onDismissIntro={handleDismissIntro}
                  onPickAction={pickPrompt}
                  onNavigate={navigate}
                />
              ) : (
                <MessageList
                  turns={turns}
                  onFeedback={handleFeedback}
                  onRetry={handleRetry}
                  onEdit={handleEditTurn}
                  bottomRef={bottomRef}
                />
              )}
            </div>
          </div>

          {/* Sits over the bottom of the answer area, not inside the scroller,
              so it stays put while the content moves under it. Only rendered
              in an active chat — the welcome screen scrolls with the page on a
              phone and has its own end. */}
          {/* Phone only. It belongs to the tall, mostly-answer phone layout,
              where a long answer no longer ends anywhere near the composer; on
              desktop the thread and the composer are visible together and the
              brief was explicitly to leave that layout alone. */}
          {!isEmpty && isPhoneLayout && (
            <ScrollToBottom
              scrollRef={chatScrollRef}
              watch={turns}
              onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
            />
          )}
          </div>

          {resizeEnabled && (
            <ChatResizeHandle
              height={composerHeight}
              min={COMPOSER_MIN_HEIGHT}
              max={window.innerHeight * COMPOSER_MAX_HEIGHT_RATIO}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={handleResizePointerUp}
              onKeyDown={handleResizeKeyDown}
            />
          )}

          <div
            className={`composer-dock${resizeEnabled && composerHeight != null ? ' composer-dock--resized' : ''}`}
            ref={composerDockRef}
            style={resizeEnabled && composerHeight != null ? { height: `${composerHeight}px` } : undefined}
          >
            <div className="composer-dock-inner">
              {router.pendingAsk?.action.ask && (
                <AiClarifyPrompt
                  question={router.pendingAsk.action.ask.question}
                  options={router.pendingAsk.action.ask.options}
                  onChoose={(value) => settleRouting(router.answerWithOption(value))}
                  onCancel={() => settleRouting(router.cancelAsk())}
                />
              )}
              {/* The banner that used to sit here — an orange pill announcing
                  that Classroom Mode was on — is gone. The Assistant Mode
                  control now shows its own state (active styling, and the
                  selected mode on hover), so the banner was a second copy of
                  the same fact taking a permanent strip of the screen above the
                  grade and subject. It also would not have survived a second
                  mode: one banner per active mode is not a layout. */}
              {/* First-visit tip for the Assistant Mode dropdown (P7). Shown
                  only while no mode is on: once a teacher has turned one on
                  they have found the control. Sits directly above the Composer
                  that holds the control it describes, the same placement
                  generator-intro uses. Copy points at the dropdown, not "+",
                  since "+" now opens Capture Photo / Upload File. */}
              {CLASSROOM_MODE_ENABLED && !classroomMode && classroomTip.visible && (
                <OnboardingTip icon={Sparkles} onDismiss={classroomTip.dismiss}>
                  Tap <strong>Assistant Mode</strong> below and turn on <strong>Classroom Mode</strong> to get a lesson
                  plan, worksheet, quiz, homework and exit ticket alongside your answer.
                </OnboardingTip>
              )}
              <Composer
                value={query}
                onChange={setQuery}
                onSubmit={handleSubmit}
                loading={isSubmitting || router.routing || (aiCooldownUntil != null && !aiCooldownReady)}
                voice={voice}
                attachments={attachments}
                textareaRef={textareaRef}
                classroomMode={classroomMode}
                onClassroomModeChange={setClassroomModeOn}
                cooldownMessage={aiCooldownUntil != null && !aiCooldownReady ? retryMessage(aiCooldownRemainingMs) : undefined}
              />
            </div>
          </div>

          {/* Positioned against .coach-main-chat (position: relative in
              index.css), so it covers only the main content column — never
              the sidebar next to it — matching the Claude-style reference
              this was built from rather than a full-viewport modal. */}
          <ChatSearchOverlay
            open={historySearchOpen}
            items={history}
            titleFor={titleFor}
            onClose={() => setHistorySearchOpen(false)}
            onSelect={selectHistory}
          />
        </main>
      </div>
    </div>
  );
}
