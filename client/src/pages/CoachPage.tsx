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
// The page's only import from the AI Action Router: a single line keeps the feature deletable and this most-used file reviewable.
import { useAssistantRouting, type RoutingOutcome } from '../assistant/RouterProvider';
import { persistOnboarding } from '../lib/onboarding';
import { groupHistory } from '../lib/historyThreads';
import { ADMIN_ROLES, CLASSROOM_MODE_ENABLED, SPEECH_LOCALE } from '../config';
import type { AttachmentMeta, CoachResponse, HistoryItem, QueryContext, Turn } from '../types';

const EMPTY_CONTEXT: QueryContext = { grade: '', subject: '', classroomType: '', issueType: '' };

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 768px)').matches;
}

function newTurnId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random()}`;
}

// Chat/composer resize handle: keeps the composer usable at its smallest and stops a drag swallowing the viewport at its largest.
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
  // First-run onboarding intro: shown once, only in the empty welcome state, until dismissed. The flag lives on the account
  // (preferences.onboarding) so it follows the teacher across devices. `introReopened` is the "Getting Started" re-entry: it
  // re-shows the intro without touching the persisted gate.
  const showIntro = introReopened || !prefs.onboarding?.seenWelcomeIntro;

  const [language, setLanguage] = useState(prefs.defaultLanguage || 'en');
  const [query, setQuery] = useState('');
  const [context, setContext] = useState<QueryContext>({
    grade: prefs.defaultGrade ?? '',
    subject: prefs.defaultSubject ?? '',
    classroomType: prefs.defaultClassroomType ?? '',
    issueType: '',
  });

  // ---- Classroom Mode (docs/classroom-mode.md) ----
  // Plain component state, deliberately not persisted to user.preferences: it survives in-session navigation and resets to OFF on
  // reload. The risk is silent spend, since each question costs several model calls, and a mode remembered across sessions is one a
  // teacher stops noticing.
  const [classroomMode, setClassroomMode] = useState(false);
  // First-visit tip pointing at the "+" button.
  const classroomTip = useOnboardingTip('classroom-mode-intro');

  function setClassroomModeOn(on: boolean) {
    setClassroomMode(on);
    show(on ? 'Classroom Mode on' : 'Classroom Mode off', 'success');
  }

  const [turns, setTurns] = useState<Turn[]>([]);
  // The in-flight /coach (or /coach/attachment) request, if any, so "Stop generating" can cancel it. Only one request is
  // ever in flight at a time (Composer disables the input while isSubmitting, and a retry/edit first marks its own turn
  // pending, which already makes isSubmitting true), so a single ref is enough.
  const abortControllerRef = useRef<AbortController | null>(null);
  // The thread the on-screen turns belong to, sent with every turn so the server saves them as one chat. A ref, not state:
  // submitTurn can run from the router's async settle, and must see the id the previous turn set. Null until the first turn
  // is submitted; cleared with the thread (New chat) and set when a history entry is reopened.
  const conversationIdRef = useRef<string | null>(null);
  const isSubmitting = turns.some((t) => t.status === 'pending');

  // Every Gemini API key exhausted (ApiError.retryAt): blocks sending until the soonest key recovers, then clears itself (no
  // auto-resend of what was typed; see the countdown effect below).
  const [aiCooldownUntil, setAiCooldownUntil] = useState<number | null>(null);
  const { remainingMs: aiCooldownRemainingMs, ready: aiCooldownReady } = useRetryCountdown(aiCooldownUntil);
  useEffect(() => {
    if (aiCooldownUntil != null && aiCooldownReady) setAiCooldownUntil(null);
  }, [aiCooldownUntil, aiCooldownReady]);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Lifted from Sidebar so ChatSearchOverlay shows the same pin/rename state; two hook instances would keep disagreeing overrides.
  const {
    isPinned, titleFor, pinnedIds, togglePin,
    rename: renameHistoryItem, forget: forgetHistoryItem,
  } = useHistoryOverrides(history);
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobileViewport());
  // Chat-history search (TopBar's Search icon → ChatSearchOverlay, an overlay in the main column, not Sidebar). Only whether it's
  // open lives here; the query is local to the overlay. Independent of sidebarOpen except in toggleHistorySearch.
  const [historySearchOpen, setHistorySearchOpen] = useState(false);

  // null = the composer keeps its default content-sized height; a number is set only once the teacher drags the resize handle
  // (desktop/tablet, active chat only).
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());
  // A second, narrower breakpoint than `isMobile` (768px), matching the 640px where the stylesheet switches to the phone layout.
  // Decides when the scroll-to-latest button is needed.
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
      setHistory(groupHistory(data.queries));
    } catch {
      // History is non-critical; fail quietly.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Toggles the search overlay. On mobile the drawer is a fixed full-screen panel (z-index 1200, see .sidebar in index.css) that
  // would sit on top of the overlay (a lower stacking context) if both were open, so it's closed here. Desktop's inline sidebar
  // is a normal-flow column with no conflict.
  function toggleHistorySearch() {
    if (historySearchOpen) {
      setHistorySearchOpen(false);
      return;
    }
    if (isMobile && sidebarOpen) setSidebarOpen(false);
    setHistorySearchOpen(true);
  }

  // Escape closes the sidebar (as a mobile drawer). Skipped while search is open: ChatSearchOverlay closes itself on the same
  // Escape (useDismissable), and this would also collapse the desktop inline sidebar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || historySearchOpen) return;
      setSidebarOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historySearchOpen]);

  // Crossing from desktop to mobile turns the sidebar from an inline column into a fixed drawer, so close it rather than let it
  // cover the screen. Fires only on the transition, so it doesn't interfere with opening/closing the drawer on mobile.
  useEffect(() => {
    let wasMobile = isMobileViewport();
    function onResize() {
      const nowMobile = isMobileViewport();
      if (nowMobile && !wasMobile) {
        setSidebarOpen(false);
        // A composer height dragged on desktop/tablet means nothing on a phone; drop it so mobile gets the default content-sized composer.
        setComposerHeight(null);
      }
      setIsMobile(nowMobile);
      wasMobile = nowMobile;
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Swipe right from the left edge opens the drawer (mobile only; useSidebarSwipe.ts), on top of tap-to-open. Armed only while
  // the drawer is closed so it doesn't compete with Sidebar's swipe-to-close. It also closes search, the overlap toggleHistorySearch guards against.
  useEdgeSwipeToOpen(isMobile && !sidebarOpen, () => {
    setHistorySearchOpen(false);
    setSidebarOpen(true);
  });

  // "Getting Started" can be triggered from any page, even mid-conversation. The intro only lives in the empty welcome state, so
  // clear the thread to reveal it; the conversation is safe in history, like a new chat.
  useEffect(() => {
    if (!introReopened) return;
    setTurns([]);
    conversationIdRef.current = null;
    setQuery('');
    if (isMobileViewport()) setSidebarOpen(false);
  }, [introReopened]);

  function scrollToBottom() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }

  async function runTurn(id: string, queryText: string, lang: string, ctx: QueryContext, classroom: boolean, supersedes?: string) {
    const conversationId = conversationIdRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const res = await api<CoachResponse>('/coach', {
        method: 'POST',
        // `classroomMode` is sent only when on, so a teacher who never uses it sends the same request body as always.
        body: { query: queryText, language: lang, context: ctx, ...(conversationId ? { conversationId } : {}), ...(conversationId && supersedes ? { supersedes } : {}), ...(classroom ? { classroomMode: true } : {}) },
        signal: controller.signal,
      });
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'done', response: res, rating: null } : t)));
      loadHistory();
    } catch (err) {
      const cancelled = err instanceof ApiError && err.code === 'CANCELLED';
      const message = err instanceof ApiError ? err.message : 'Failed to get a response. Please try again.';
      const errorIsNetwork = !cancelled && err instanceof ApiError && err.status === 0;
      const retryAt = err instanceof ApiError && err.code === 'RATE_LIMITED' ? err.retryAt : undefined;
      if (retryAt != null) setAiCooldownUntil(retryAt);
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error', error: message, errorIsNetwork, cancelled, retryAt } : t)));
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      scrollToBottom();
    }
  }

  // "Stop generating" (Composer's Stop button): aborts the in-flight /coach or /coach/attachment request. The fetch
  // rejects with an AbortError, which api() turns into ApiError code 'CANCELLED', caught above (and in
  // runTurnWithAttachments) and rendered as a neutral "Stopped generating." banner, not a red error.
  function stopGenerating() {
    abortControllerRef.current?.abort();
  }

  // Persists the first-run intro as "seen" (idempotent, optimistic, non-blocking). Called on dismissal and on first engagement,
  // so a teacher who starts using the app without clicking "Got it" isn't shown it again next login.
  function markIntroSeen() {
    if (!user || user.preferences.onboarding?.seenWelcomeIntro) return;
    void persistOnboarding(user, updateUser, { ...user.preferences.onboarding, seenWelcomeIntro: true });
  }

  async function submitTurn(queryText: string, lang: string, ctx: QueryContext) {
    // Starting any turn means the user is done with the intro: hide it and persist the "seen" gate.
    closeIntro();
    markIntroSeen();
    const id = newTurnId();
    if (!conversationIdRef.current) conversationIdRef.current = crypto.randomUUID();
    // Snapshotted onto the turn at submit, like `language` and `context` (see types.ts): a retry mustn't read it live.
    const classroom = CLASSROOM_MODE_ENABLED && classroomMode;
    setTurns((ts) => [
      ...ts,
      { id, query: queryText, language: lang, context: ctx, status: 'pending', rating: null, classroomMode: classroom, startedAt: Date.now() },
    ]);
    scrollToBottom();
    await runTurn(id, queryText, lang, ctx, classroom);
  }

  // The multimodal-attachment sibling of runTurn/submitTurn: a separate path (POST /api/coach/attachment, multipart), so the text/voice
  // flow above is untouched (docs/multimodal-attachments-architecture.md). It bypasses the AI Action Router, since an
  // attachment-bearing message is Coach Q&A, not a navigation/prefill action.
  // All files go in one request (repeated 'files' entries) so the backend sends the whole set to Gemini together.
  async function runTurnWithAttachments(id: string, queryText: string, lang: string, files: File[]) {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const formData = new FormData();
      formData.append('query', queryText);
      formData.append('language', lang);
      for (const file of files) formData.append('files', file);
      const res = await api<CoachResponse>('/coach/attachment', { method: 'POST', body: formData, signal: controller.signal });
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'done', response: res, rating: null } : t)));
    } catch (err) {
      const cancelled = err instanceof ApiError && err.code === 'CANCELLED';
      const message = err instanceof ApiError ? err.message : 'Failed to get a response. Please try again.';
      const errorIsNetwork = !cancelled && err instanceof ApiError && err.status === 0;
      const retryAt = err instanceof ApiError && err.code === 'RATE_LIMITED' ? err.retryAt : undefined;
      if (retryAt != null) setAiCooldownUntil(retryAt);
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error', error: message, errorIsNetwork, cancelled, retryAt } : t)));
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      scrollToBottom();
    }
  }

  async function submitTurnWithAttachments(queryText: string, lang: string, selected: SelectedAttachment[]) {
    closeIntro();
    markIntroSeen();
    const id = newTurnId();
    const meta: AttachmentMeta[] = selected.map((a) => ({ name: a.file.name, kind: a.kind }));
    // No `context` is sent (the attachment endpoint has no grade/subject fields); EMPTY_CONTEXT only satisfies Turn's type.
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

  // Every router outcome ends in one of two places: the teacher is taken somewhere, or the message goes to the coach as always.
  // 'asked' needs nothing here: the question is on screen and the teacher's next action decides.
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
    // Clearing the text is enough: the Composer resizes from its value (one owner of the box's height), so nothing touches the textarea's style.
    setQuery('');

    // An attachment-bearing message skips the router and goes straight to Coach (see runTurnWithAttachments).
    if (pendingAttachments.length > 0) {
      attachments.clear();
      submitTurnWithAttachments(trimmed, language, pendingAttachments);
      return;
    }

    // The router's pre-pass. With the client flag off this is one boolean check and the original synchronous call below, with no await or request.
    if (!router.enabled) {
      submitTurn(trimmed, language, context);
      return;
    }
    // The live textarea value is the second half of the stale-response guard: a response landing after the teacher started typing again mustn't navigate them away.
    void router.submit(trimmed, () => (textareaRef.current?.value ?? '') === '').then(settleRouting);
  }

  async function handleRetry(turn: Turn) {
    // The files aren't kept after submit (see useAttachments/runTurnWithAttachments), only display metadata, so a blind retry would
    // ask Coach about "these files" with nothing attached. Ask the teacher to re-attach.
    if (turn.attachments && turn.attachments.length > 0) {
      show('To retry, please re-attach the file(s) and ask again.', 'error');
      return;
    }
    setTurns((ts) => ts.map((t) => (t.id === turn.id
      // startedAt is reset: a retry is a new wait, and inheriting the old elapsed time would open already saying "taking longer than usual".
      ? { ...t, status: 'pending', error: undefined, startedAt: Date.now() }
      : t)));
    // `turn.classroomMode ?? false`: the mode when the turn was first submitted, not now. Turns predating the field retry without it.
    await runTurn(turn.id, turn.query, turn.language, turn.context, turn.classroomMode ?? false);
  }

  // Edit-and-resubmit a sent prompt (MessageBubble's Edit). Updates the same turn in place (same `id` and snapshotted
  // language/context/classroomMode) so the thread gets no duplicate and the edited question gets a new answer. Like handleRetry
  // with the query also changing.
  async function handleEditTurn(turnId: string, newQuery: string) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn) return;
    setTurns((ts) => ts.map((t) => (t.id === turnId
      // `restored: false`: a fresh generation for the edited text, not the rebuilt-from-history state, so ClassroomSet mustn't treat its cards as idle.
      ? { ...t, query: newQuery, status: 'pending', error: undefined, response: undefined, rating: null, restored: false, startedAt: Date.now() }
      : t)));
    scrollToBottom();
    // `supersedes`: the saved row this edit replaces, so the server (with Coach memory on) swaps it in place and leaves it and
    // the turns after it out of the context sent to the model.
    await runTurn(turnId, newQuery, turn.language, turn.context, turn.classroomMode ?? false, turn.response?.queryId ?? undefined);
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
    conversationIdRef.current = null;
    setQuery('');
    setContext(EMPTY_CONTEXT);
    attachments.clear();
    // A new conversation mustn't inherit the last one's remembered grade, subject or topic; a stale slot yields a confident, wrong worksheet.
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

  // Dismisses the intro: clears the transient reopen flag, then marks it seen. On a "Getting Started" re-view the gate is already
  // set, so markIntroSeen is a no-op and reopening never resets the persisted state.
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
    // `item` is a whole thread (lib/historyThreads.ts); a raw one-turn item (no `turns`) restores as before.
    const mergedContext = { ...EMPTY_CONTEXT, ...item.context };
    conversationIdRef.current = item.conversationId || item.id;
    setTurns((item.turns ?? [item]).map((t) => ({
      id: t.id,
      query: t.query,
      language: t.language,
      context: { ...EMPTY_CONTEXT, ...t.context },
      status: 'done' as const,
      rating: t.rating,
      // Reopening a chat mustn't spend model calls: the plan is restored so the cards reappear, but `restored` keeps them idle until Generate is pressed.
      restored: true,
      response: {
        success: true,
        text: t.text,
        language: t.language,
        context: t.context,
        queryId: t.id,
        conversationId: conversationIdRef.current ?? undefined,
        ...(t.classroom ? { classroom: t.classroom } : {}),
      },
    })));
    setLanguage(item.language);
    setContext(mergedContext);
    setQuery('');
    if (isMobileViewport()) setSidebarOpen(false);
    scrollToBottom();
  }

  function setCtx(key: keyof QueryContext, value: string) {
    setContext((c) => ({ ...c, [key]: value }));
  }

  const openConversationId = turns[0]?.response?.conversationId;
  const activeHistoryId = openConversationId ? history.find((h) => h.conversationId === openConversationId)?.id ?? null : null;
  const isEmpty = turns.length === 0;

  // The resize handle exists only on desktop/tablet in the active-chat state: not on mobile, and not over the empty welcome screen.
  const resizeEnabled = !isMobile && !isEmpty;

  // If the thread clears mid-drag (e.g. "New chat"), the handle unmounts under the pointer; drop in-flight drag state so a stray pointerup can't act.
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
    // The handle sits above the composer, so dragging up (negative deltaY) grows it and dragging down shrinks it.
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
          {/* Scoped to this column, not the viewport (see .coach-shell/.coach-body in index.css). showProfileMenu=false: the
              account menu lives at the bottom of the Sidebar, and brand/search/collapse live in its header, so this bar keeps only
              page nav, theme and the teaching-context icon (extraControl). Exception: onSidebarToggle, since a closed mobile
              drawer is off-canvas and can't hold its own reopen button, so TopBar renders that one control then (see TopBar.tsx). */}
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

          {/* Wraps the scroller only, so the scroll-to-latest button is positioned against the answer area, not the column (where it would sit on the send button). */}
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

          {/* Over the bottom of the answer area, not inside the scroller, so it stays put as content moves. Only in an active chat,
              since the welcome screen scrolls with the page on a phone. */}
          {/* Phone only: it belongs to the tall phone layout where a long answer doesn't end near the composer; desktop shows both, and is left alone. */}
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
              {/* No banner for Classroom Mode being on: the Assistant Mode control shows its own state, so a banner would duplicate
                  it in a permanent strip (and wouldn't scale to a second mode). */}
              {/* First-visit tip for the Assistant Mode dropdown. Shown only while no mode is on (once one is, the teacher has found
                  it), directly above the Composer that holds the control, like generator-intro. The copy names the dropdown, not
                  "+", which now opens Capture Photo / Upload File. */}
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
                canStop={isSubmitting}
                onStop={stopGenerating}
                voice={voice}
                attachments={attachments}
                textareaRef={textareaRef}
                classroomMode={classroomMode}
                onClassroomModeChange={setClassroomModeOn}
                cooldownMessage={aiCooldownUntil != null && !aiCooldownReady ? retryMessage(aiCooldownRemainingMs) : undefined}
              />
            </div>
          </div>

          {/* Positioned against .coach-main-chat (position: relative in index.css), so it covers only the main column, not the sidebar. */}
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
