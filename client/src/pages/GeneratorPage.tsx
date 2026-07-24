import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileQuestion, ClipboardList, Sparkles, Loader2, Pencil, Eye, Save, ArrowRight,
} from 'lucide-react';
import TopBar from '../components/TopBar';
import ExamHeader from '../components/ExamHeader';
import ExamHeaderEditor from '../components/ExamHeaderEditor';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth';
import { usePreferences } from '../hooks/usePreferences';
import { formatResponse } from '../lib/format';
import { stripAssessmentPreamble } from '../lib/assessment';
import { buildInitialExamMeta } from '../lib/examMeta';
import { generateAssessment, createResource, type GenerateAssessmentInput } from '../lib/resources';
import {
  ASSESSMENT_FORMATS, DIFFICULTIES, QUESTION_TYPES, LANGUAGES, GRADES, SUBJECTS,
  QUESTION_COUNT_MIN, QUESTION_COUNT_MAX, QUESTION_COUNT_DEFAULT,
} from '../config';
import { ApiError } from '../api';
import type { AssessmentFormat, Difficulty, QuestionType } from '../lib/resources';
import type { ExamPaperMeta } from '../types';

// Sensible default title for a generated assessment (editable before saving).
function defaultTitle(format: AssessmentFormat, topic: string, grade: string): string {
  const kind = format === 'worksheet' ? 'Worksheet' : 'Quiz';
  const t = topic.trim() || 'Untitled';
  const g = grade.trim() ? ` (${grade.trim()})` : '';
  return `${kind}: ${t}${g}`.slice(0, 200);
}

export default function GeneratorPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const navigate = useNavigate();
  const { show } = useToast();
  const { user } = useAuth();

  // Config form state.
  const [format, setFormat] = useState<AssessmentFormat>('quiz');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [questionType, setQuestionType] = useState<QuestionType>('mcq');
  const [questionCount, setQuestionCount] = useState<number>(QUESTION_COUNT_DEFAULT);
  const [language, setLanguage] = useState('en');
  const [instructions, setInstructions] = useState('');

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Result / preview state (present only after a successful generation).
  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  const [contentDirty, setContentDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Exam-paper letterhead (Phase 3) — deterministic teacher input, never sent
  // to Gemini. Initialized fresh on each successful generation, prefilled
  // from the teacher's site-wide defaults (Settings) and School/User identity.
  const [examMeta, setExamMeta] = useState<ExamPaperMeta>({});

  async function handleGenerate(e?: FormEvent) {
    e?.preventDefault();
    if (generating) return;
    if (!topic.trim()) {
      show('Please enter a topic', 'error');
      return;
    }
    if (content !== null && contentDirty) {
      const ok = window.confirm('Regenerating will replace your edited preview. Continue?');
      if (!ok) return;
    }

    setGenerating(true);
    setError('');
    const input: GenerateAssessmentInput = {
      format,
      grade: grade.trim() || undefined,
      subject: subject.trim() || undefined,
      topic: topic.trim(),
      difficulty,
      questionType,
      questionCount,
      language,
      instructions: instructions.trim() || undefined,
    };
    try {
      const result = await generateAssessment(input);
      setContent(result.content);
      setTitle(defaultTitle(format, topic, grade));
      setContentDirty(false);
      setTab('preview');
      if (user) setExamMeta(buildInitialExamMeta(user, user.preferences.examPaperDefaults));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (content === null || saving) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      show('Please enter a title', 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = await createResource({
        type: 'assessment',
        title: cleanTitle.slice(0, 200),
        grade: grade.trim() || undefined,
        subject: subject.trim() || undefined,
        language,
        content,
        structured: JSON.stringify({ format, difficulty, questionType, questionCount, topic: topic.trim(), examMeta }),
      });
      show('Saved to your library', 'success');
      // Continue into the full Workspace (edit / AI assist / student & teacher print).
      navigate(`/library/${saved.id}/edit`);
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  }

  const FormatIcon = format === 'worksheet' ? ClipboardList : FileQuestion;

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="generator-main">
        <header className="generator-header">
          <h1 className="generator-title">
            <FormatIcon size={22} aria-hidden="true" /> Quiz &amp; Worksheet Generator
          </h1>
          <p className="generator-subtitle">
            Generate a classroom-ready quiz or worksheet with AI, review it, then save it to your Library.
          </p>
        </header>

        <form className="generator-form" onSubmit={handleGenerate}>
          <fieldset className="generator-fieldset">
            <legend className="ws-label">Format</legend>
            <div className="generator-format-row" role="radiogroup" aria-label="Format">
              {ASSESSMENT_FORMATS.map((f) => (
                <button
                  type="button"
                  key={f.value}
                  role="radio"
                  aria-checked={format === f.value}
                  className={`generator-format-card${format === f.value ? ' active' : ''}`}
                  onClick={() => setFormat(f.value)}
                >
                  <span className="generator-format-label">
                    {f.value === 'worksheet' ? <ClipboardList size={16} aria-hidden="true" /> : <FileQuestion size={16} aria-hidden="true" />}
                    {f.label}
                  </span>
                  <span className="generator-format-hint">{f.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="generator-grid">
            <label className="ws-field">
              <span className="ws-label">Topic <span className="generator-req" aria-hidden="true">*</span></span>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={200}
                required
                placeholder="e.g. Fractions, Water cycle, Parts of speech"
                aria-label="Topic (required)"
              />
            </label>
            <label className="ws-field">
              <span className="ws-label">Grade</span>
              <input type="text" list="gen-grades" value={grade} maxLength={80} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. Class 3-5" />
            </label>
            <label className="ws-field">
              <span className="ws-label">Subject</span>
              <input type="text" list="gen-subjects" value={subject} maxLength={80} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Mathematics" />
            </label>
            <label className="ws-field">
              <span className="ws-label">Difficulty</span>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                {DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
            <label className="ws-field">
              <span className="ws-label">Question type</span>
              <select value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType)}>
                {QUESTION_TYPES.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </label>
            <label className="ws-field">
              <span className="ws-label">Number of questions ({QUESTION_COUNT_MIN}–{QUESTION_COUNT_MAX})</span>
              <input
                type="number"
                min={QUESTION_COUNT_MIN}
                max={QUESTION_COUNT_MAX}
                value={questionCount}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setQuestionCount(Number.isNaN(n) ? QUESTION_COUNT_MIN : Math.min(QUESTION_COUNT_MAX, Math.max(QUESTION_COUNT_MIN, n)));
                }}
              />
            </label>
            <label className="ws-field">
              <span className="ws-label">Language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </label>
            <datalist id="gen-grades">{GRADES.map((g) => <option key={g} value={g} />)}</datalist>
            <datalist id="gen-subjects">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist>
          </div>

          <label className="ws-field generator-instructions">
            <span className="ws-label">Additional instructions (optional)</span>
            <textarea
              value={instructions}
              maxLength={1000}
              rows={2}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Focus on real-life examples; suitable for a 20-minute class activity"
            />
          </label>

          <div className="generator-actions">
            <button type="submit" className="btn-primary generator-generate" disabled={generating || !topic.trim()}>
              {generating ? <Loader2 size={16} aria-hidden="true" className="spin" /> : <Sparkles size={16} aria-hidden="true" />}
              {generating ? 'Generating…' : content !== null ? 'Regenerate' : 'Generate'}
            </button>
          </div>

          {error && <p className="auth-error generator-error">{error}</p>}
        </form>

        {generating && content === null && (
          <div className="response-loading"><div className="spinner" /><p>Generating your {format}…</p></div>
        )}

        {content !== null && (
          <section className="generator-preview" aria-label="Generated result">
            <div className="generator-preview-head">
              <h2 className="generator-preview-title">Preview</h2>
              <p className="generator-preview-note">Review and edit below, then save. Nothing is saved until you click <strong>Save to Library</strong>.</p>
            </div>

            <label className="workspace-title-field">
              <span className="ws-label">Title</span>
              <input
                type="text"
                className="workspace-title-input"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Assessment title"
              />
            </label>

            <ExamHeaderEditor value={examMeta} onChange={setExamMeta} />

            <div className="workspace-content">
              <div className="workspace-tabs" role="tablist" aria-label="Preview mode">
                <button type="button" role="tab" aria-selected={tab === 'preview'} className={`workspace-tab${tab === 'preview' ? ' active' : ''}`} onClick={() => setTab('preview')}>
                  <Eye size={15} aria-hidden="true" /> Preview
                </button>
                <button type="button" role="tab" aria-selected={tab === 'edit'} className={`workspace-tab${tab === 'edit' ? ' active' : ''}`} onClick={() => setTab('edit')}>
                  <Pencil size={15} aria-hidden="true" /> Edit
                </button>
                <span className="workspace-content-hint">Markdown supported</span>
              </div>

              {tab === 'edit' ? (
                <textarea
                  className="workspace-editor"
                  value={content}
                  onChange={(e) => { setContent(e.target.value); setContentDirty(true); }}
                  aria-label="Generated content"
                  spellCheck
                />
              ) : (
                <div className="response-body workspace-preview exam-paper">
                  <ExamHeader meta={examMeta} fallbackTitle={title} subject={subject} grade={grade} />
                  {/* The letterhead already presents the title/metadata, so the
                      generated preamble is stripped from display (never from
                      the content that gets saved). */}
                  <div dangerouslySetInnerHTML={{ __html: formatResponse(stripAssessmentPreamble(content) || '') }} />
                </div>
              )}
            </div>

            <div className="generator-save-row">
              <button type="button" className="btn-primary generator-save" onClick={handleSave} disabled={saving || !title.trim()}>
                {saving ? <Loader2 size={16} aria-hidden="true" className="spin" /> : <Save size={16} aria-hidden="true" />}
                {saving ? 'Saving…' : 'Save to Library'}
              </button>
              <span className="generator-save-hint">
                <ArrowRight size={14} aria-hidden="true" /> Opens in the Workspace for editing, AI assist, and printing.
              </span>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
