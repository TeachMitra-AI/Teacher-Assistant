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

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const responseRef = useRef<HTMLDivElement>(null);

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
    try {
      const res = await api<CoachResponse>('/coach', {
        method: 'POST',
        body: { query: trimmed, language, context },
      });
      setResponse(res);
      responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      loadHistory();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Failed to get a response', 'error');
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
          <div className="panel-row">
            <label className="field">
              Response language
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </label>
          </div>

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

          <div className="query-input-wrap">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY_LENGTH))}
              onKeyDown={(e) => { if (e.ctrlKey && e.key === 'Enter') handleSubmit(); }}
              placeholder="Ask a teaching question… e.g. How do I explain fractions to Class 3?"
              rows={4}
            />
            <div className="input-footer">
              <span className="char-count">{query.length}/{MAX_QUERY_LENGTH}</span>
              {voice.supported && (
                <button
                  type="button"
                  className={`icon-btn voice-btn${voice.listening ? ' listening' : ''}`}
                  onClick={voice.toggle}
                  title="Voice input"
                  aria-label="Voice input"
                >
                  🎤
                </button>
              )}
            </div>
          </div>

          <div className="example-chips">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button type="button" key={q} className="chip" onClick={() => setQuery(q)}>{q}</button>
            ))}
          </div>

          <div className="query-actions">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Thinking…' : 'Get advice'}
            </button>
            <button type="button" className="btn-text" onClick={handleClear} disabled={loading}>Clear</button>
          </div>
        </form>

        <div className="response-area" ref={responseRef}>
          {loading && (
            <div className="response-loading">
              <div className="spinner" />
              <p>Preparing practical advice for you…</p>
            </div>
          )}
          {!loading && response && (
            <ResponseCard
              text={response.text}
              language={response.language}
              context={response.context}
              queryId={response.queryId}
              rating={rating}
              onFeedback={handleFeedback}
            />
          )}
          {!loading && !response && (
            <div className="empty-state">
              <span aria-hidden="true">💡</span>
              <h2>Ask anything about teaching</h2>
              <p>Get quick, practical classroom advice in your language. Try an example above to begin.</p>
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
      />
    </div>
  );
}
