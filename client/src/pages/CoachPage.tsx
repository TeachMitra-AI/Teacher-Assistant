import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Sidebar from '../components/Sidebar';
import WelcomeScreen from '../components/WelcomeScreen';
import MessageList from '../components/MessageList';
import ContextBar from '../components/ContextBar';
import Composer from '../components/Composer';
import AiClarifyPrompt from '../components/AiClarifyPrompt';
import { useToast } from '../components/Toast';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useAttachments, type SelectedAttachment } from '../hooks/useAttachments';
import { usePreferences } from '../hooks/usePreferences';
import { useAuth } from '../auth';
import { useOnboarding } from '../onboarding';
import { api, ApiError } from '../api';
// This page's ONLY import from the AI Action Router (milestone M6). Keeping the
// coupling to a single line is what makes the feature deletable and what keeps
// this file — the most-used path in the product — reviewable.
import { useAssistantRouting, type RoutingOutcome } from '../assistant/RouterProvider';
import { buildSuffixedQuery } from '../lib/followUp';
import { persistOnboarding } from '../lib/onboarding';
import { ADMIN_ROLES, SPEECH_LOCALE, type FollowUpAction } from '../config';
import type { AttachmentMeta, CoachResponse, HistoryItem, QueryContext, Turn } from '../types';

const EMPTY_CONTEXT: QueryContext = { grade: '', subject: '', classroomType: '', issueType: '' };

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 768px)').matches;
}

function newTurnId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random()}`;
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

  const [turns, setTurns] = useState<Turn[]>([]);
  const isSubmitting = turns.some((t) => t.status === 'pending');

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobileViewport());

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Close the sidebar (acting as a mobile drawer) with Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSidebarOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // When the viewport crosses from desktop into mobile, the sidebar switches
  // from an inline column to a fixed drawer — close it so it doesn't
  // unexpectedly cover the screen. Only fires on the transition, so it never
  // interferes with the user opening/closing the drawer while on mobile.
  useEffect(() => {
    let wasMobile = isMobileViewport();
    function onResize() {
      const nowMobile = isMobileViewport();
      if (nowMobile && !wasMobile) setSidebarOpen(false);
      wasMobile = nowMobile;
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  async function runTurn(id: string, queryText: string, lang: string, ctx: QueryContext) {
    try {
      const res = await api<CoachResponse>('/coach', {
        method: 'POST',
        body: { query: queryText, language: lang, context: ctx },
      });
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'done', response: res, rating: null } : t)));
      loadHistory();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to get a response. Please try again.';
      const errorIsNetwork = err instanceof ApiError && err.status === 0;
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error', error: message, errorIsNetwork } : t)));
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
    setTurns((ts) => [...ts, { id, query: queryText, language: lang, context: ctx, status: 'pending', rating: null }]);
    scrollToBottom();
    await runTurn(id, queryText, lang, ctx);
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
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error', error: message, errorIsNetwork } : t)));
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
      { id, query: queryText, language: lang, context: EMPTY_CONTEXT, status: 'pending', rating: null, attachments: meta },
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
    setQuery('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

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
    setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, status: 'pending', error: undefined } : t)));
    await runTurn(turn.id, turn.query, turn.language, turn.context);
  }

  function handleFollowUp(turn: Turn, action: FollowUpAction) {
    if (action.kind === 'translate') {
      setLanguage(action.targetLanguage);
      submitTurn(turn.query, action.targetLanguage, turn.context);
    } else {
      const augmented = buildSuffixedQuery(turn.query, action.suffix);
      submitTurn(augmented, turn.language, turn.context);
    }
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
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
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
      response: {
        success: true,
        text: item.text,
        language: item.language,
        context: item.context,
        queryId: item.id,
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

  return (
    <div className={`page coach-shell${isEmpty ? ' coach-empty' : ''}`}>
      <TopBar preferences={preferences} onSidebarToggle={() => setSidebarOpen((o) => !o)} sidebarOpen={sidebarOpen} />

      <div className="coach-body">
        <Sidebar
          open={sidebarOpen}
          items={history}
          loading={historyLoading}
          activeId={activeHistoryId}
          onClose={() => setSidebarOpen(false)}
          onNewChat={handleNewChat}
          onSelect={selectHistory}
          onDelete={handleDeleteHistory}
          onClearAll={handleClearHistory}
        />

        <main className="coach-main-chat">
          <div className="chat-scroll">
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
                  onFollowUp={handleFollowUp}
                  onRetry={handleRetry}
                  bottomRef={bottomRef}
                />
              )}
            </div>
          </div>

          <div className="composer-dock">
            <div className="composer-dock-inner">
              {router.pendingAsk?.action.ask && (
                <AiClarifyPrompt
                  question={router.pendingAsk.action.ask.question}
                  options={router.pendingAsk.action.ask.options}
                  onChoose={(value) => settleRouting(router.answerWithOption(value))}
                  onCancel={() => settleRouting(router.cancelAsk())}
                />
              )}
              <ContextBar language={language} onLanguageChange={setLanguage} context={context} onContextChange={setCtx} />
              <Composer
                value={query}
                onChange={setQuery}
                onSubmit={handleSubmit}
                loading={isSubmitting || router.routing}
                voice={voice}
                attachments={attachments}
                textareaRef={textareaRef}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
