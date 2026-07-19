import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import TopBar from '../components/TopBar';
import ResponseCard from '../components/ResponseCard';
import HistoryDrawer from '../components/HistoryDrawer';
import { useToast } from '../components/Toast';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { usePreferences } from '../hooks/usePreferences';
import { useAuth } from '../auth';
import { api, ApiError } from '../api';
import {
  LANGUAGES, GRADES, SUBJECTS, CLASSROOM_TYPES, ISSUE_TYPES,
  EXAMPLE_QUESTIONS, MAX_QUERY_LENGTH, SPEECH_LOCALE,
} from '../config';
import type { CoachResponse, HistoryItem, QueryContext } from '../types';

const EMPTY_CONTEXT: QueryContext = { grade: '', subject: '', classroomType: '', issueType: '' };

export default function CoachPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { show } = useToast();
  const { user } = useAuth();
  const prefs = user?.preferences ?? {};

  const [language, setLanguage] = useState(prefs.defaultLanguage || 'en');
  const [query, setQuery] = useState('');
  const [context, setContext] = useState<QueryContext>({
    grade: prefs.defaultGrade ?? '',
    subject: prefs.defaultSubject ?? '',
    classroomType: prefs.defaultClassroomType ?? '',
    issueType: '',
  });
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CoachResponse | null>(null);
  const [rating, setRating] = useState<'helpful' | 'not_helpful' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const responseRef = useRef<HTMLDivElement>(null);
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

  // Close the drawer with Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      show('Please enter a question', 'error');
      return;
    }

    setLoading(true);
    setRating(null);
    setError(null);
    try {
      const res = await api<CoachResponse>('/coach', {
        method: 'POST',
        body: { query: trimmed, language, context },
      });
      setResponse(res);
      responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to get a response. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleFeedback(value: 'helpful' | 'not_helpful') {
    if (!response?.queryId) return;
    setRating(value);
    try {
      await api('/feedback', { method: 'POST', body: { queryId: response.queryId, rating: value } });
      show('Thanks for your feedback', 'success');
    } catch {
      show('Could not save feedback', 'error');
    }
  }

  function handleClear() {
    setQuery('');
    setContext(EMPTY_CONTEXT);
    setResponse(null);
    setRating(null);
    setError(null);
  }

  function pickExample(q: string) {
    setQuery(q);
    textareaRef.current?.focus();
    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function handleDeleteHistory(item: HistoryItem) {
    const previous = history;
    setHistory((h) => h.filter((x) => x.id !== item.id));
    // If the deleted item is the one currently shown, clear the response too.
    if (response?.queryId === item.id) {
      setResponse(null);
      setRating(null);
    }
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
    setQuery(item.query);
    setLanguage(item.language);
    setContext({ ...EMPTY_CONTEXT, ...item.context });
    setResponse({
      success: true,
      text: item.text,
      language: item.language,
      context: item.context,
      queryId: item.id,
    });
    setRating(item.rating);
    setError(null);
    setDrawerOpen(false);
    responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setCtx(key: keyof QueryContext, value: string) {
    setContext((c) => ({ ...c, [key]: value }));
  }

  return (
    <div className="page">
      <TopBar
        preferences={preferences}
        onHistoryToggle={() => setDrawerOpen((o) => !o)}
        historyCount={history.length}
      />

      <main className="coach-main">
        <form className="query-panel" onSubmit={handleSubmit}>
          <div className="panel-head">
            <h1 className="panel-title">Ask a question</h1>
            <p className="panel-subtitle">Add context for more tailored, classroom-ready advice.</p>
          </div>

          <label className="field">
            Response language
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>

          <div className="field-group">
            <span className="field-group-label">Context <em>(optional)</em></span>
            <div className="context-grid">
              <label className="field">
                Grade
                <select value={context.grade} onChange={(e) => setCtx('grade', e.target.value)}>
                  <option value="">Any</option>
                  {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label className="field">
                Subject
                <select value={context.subject} onChange={(e) => setCtx('subject', e.target.value)}>
                  <option value="">Any</option>
                  {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="field">
                Classroom
                <select value={context.classroomType} onChange={(e) => setCtx('classroomType', e.target.value)}>
                  <option value="">Any</option>
                  {CLASSROOM_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">
                Focus
                <select value={context.issueType} onChange={(e) => setCtx('issueType', e.target.value)}>
                  <option value="">Any</option>
                  {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="field question-field">
            <label htmlFor="query-input">Your question</label>
            <div className="query-input-wrap">
              <textarea
                id="query-input"
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY_LENGTH))}
                onKeyDown={(e) => { if (e.ctrlKey && e.key === 'Enter') handleSubmit(); }}
                placeholder="Ask a teaching question… e.g. How do I explain fractions to Class 3?"
                rows={4}
              />
              <div className="input-footer">
                <span className={`char-count${query.length > MAX_QUERY_LENGTH * 0.9 ? ' warn' : ''}`}>
                  {query.length}/{MAX_QUERY_LENGTH}
                </span>
                {voice.supported && (
                  <button
                    type="button"
                    className={`icon-btn voice-btn${voice.listening ? ' listening' : ''}`}
                    onClick={voice.toggle}
                    title="Voice input"
                    aria-label={voice.listening ? 'Stop voice input' : 'Start voice input'}
                    aria-pressed={voice.listening}
                  >
                    🎤
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="query-actions">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Thinking…' : 'Get advice'}
            </button>
            <button type="button" className="btn-text" onClick={handleClear} disabled={loading}>Clear</button>
          </div>
          <p className="query-hint">Tip: press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to submit.</p>
        </form>

        <div className="response-area" ref={responseRef}>
          {loading && (
            <div className="state-card loading-state" role="status" aria-live="polite">
              <div className="spinner" />
              <p>Preparing practical advice for you…</p>
            </div>
          )}
          {!loading && error && (
            <div className="state-card error-state" role="alert">
              <span className="state-icon" aria-hidden="true">⚠️</span>
              <h2>Couldn’t get a response</h2>
              <p>{error}</p>
              <button type="button" className="btn-primary" onClick={() => handleSubmit()}>Try again</button>
            </div>
          )}
          {!loading && !error && response && (
            <ResponseCard
              text={response.text}
              language={response.language}
              context={response.context}
              queryId={response.queryId}
              rating={rating}
              onFeedback={handleFeedback}
            />
          )}
          {!loading && !error && !response && (
            <div className="state-card empty-state">
              <div className="empty-hero">
                <span className="empty-icon" aria-hidden="true">💡</span>
                <h2>Ask anything about teaching</h2>
                <p>Get quick, practical advice in your language — lesson ideas, activities, classroom management, assessments, and more.</p>
              </div>
              <div className="suggestions">
                <span className="suggestions-label">Try one of these</span>
                <div className="suggestion-grid">
                  {EXAMPLE_QUESTIONS.map((q) => (
                    <button type="button" key={q} className="suggestion-card" onClick={() => pickExample(q)}>
                      <span className="suggestion-icon" aria-hidden="true">💬</span>
                      <span>{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <HistoryDrawer
        open={drawerOpen}
        items={history}
        loading={historyLoading}
        onClose={() => setDrawerOpen(false)}
        onSelect={selectHistory}
        onDelete={handleDeleteHistory}
        onClearAll={handleClearHistory}
      />
    </div>
  );
}
