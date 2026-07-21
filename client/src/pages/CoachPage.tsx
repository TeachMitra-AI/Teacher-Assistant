import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import TopBar from '../components/TopBar';
import Sidebar from '../components/Sidebar';
import WelcomeScreen from '../components/WelcomeScreen';
import MessageList from '../components/MessageList';
import ContextBar from '../components/ContextBar';
import Composer from '../components/Composer';
import { useToast } from '../components/Toast';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { usePreferences } from '../hooks/usePreferences';
import { useAuth } from '../auth';
import { api, ApiError } from '../api';
import { buildSuffixedQuery } from '../lib/followUp';
import { SPEECH_LOCALE, type FollowUpAction } from '../config';
import type { CoachResponse, HistoryItem, QueryContext, Turn } from '../types';

const EMPTY_CONTEXT: QueryContext = { grade: '', subject: '', classroomType: '', issueType: '' };

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 768px)').matches;
}

function newTurnId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random()}`;
}

export default function CoachPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { show } = useToast();
  const { user } = useAuth();
  const prefs = user?.preferences ?? {};
  const displayName = user?.displayName || user?.name || '';

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
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error', error: message } : t)));
    } finally {
      scrollToBottom();
    }
  }

  async function submitTurn(queryText: string, lang: string, ctx: QueryContext) {
    const id = newTurnId();
    setTurns((ts) => [...ts, { id, query: queryText, language: lang, context: ctx, status: 'pending', rating: null }]);
    scrollToBottom();
    await runTurn(id, queryText, lang, ctx);
  }

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      show('Please enter a question', 'error');
      return;
    }
    setQuery('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    submitTurn(trimmed, language, context);
  }

  async function handleRetry(turn: Turn) {
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

  return (
    <div className="page coach-shell">
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
                <WelcomeScreen name={displayName} onPickAction={pickPrompt} />
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
              <ContextBar language={language} onLanguageChange={setLanguage} context={context} onContextChange={setCtx} />
              <Composer
                value={query}
                onChange={setQuery}
                onSubmit={handleSubmit}
                loading={isSubmitting}
                voice={voice}
                textareaRef={textareaRef}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
