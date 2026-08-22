import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileQuestion, ClipboardList, Sparkles, Loader2, Pencil, Eye, Save, ArrowRight, Ticket, House,
  type LucideIcon,
} from 'lucide-react';
import TopBar from '../components/TopBar';
import ExamHeader from '../components/ExamHeader';
import ExamHeaderEditor from '../components/ExamHeaderEditor';
import OnboardingTip from '../components/OnboardingTip';
import AiPrefillBanner from '../components/AiPrefillBanner';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth';
import { usePreferences } from '../hooks/usePreferences';
import { useOnboardingTip } from '../hooks/useOnboardingTip';
import { formatResponse } from '../lib/format';
import { stripAssessmentPreamble } from '../lib/assessment';
import { buildInitialExamMeta } from '../lib/examMeta';
import { generateAssessment, createResource, type GenerateAssessmentInput } from '../lib/resources';
import {
  buildStructuredPayload,
  parseStructuredDocument,
  validateQuestions,
} from '../lib/structuredQuestions';
import QuestionListEditor from '../components/QuestionListEditor';
import {
  discardPrefill,
  loadPrefill,
  notePrefillEdit,
  notePrefillGeneration,
} from '../assistant/generatorPrefill';
import type { ProvenanceSource } from '../assistant/types';
import {
  ASSESSMENT_FORMATS, DIFFICULTIES, QUESTION_TYPES, LANGUAGES, GRADES, SUBJECTS,
  QUESTION_COUNT_MIN, QUESTION_COUNT_MAX, QUESTION_COUNT_DEFAULT, ASSISTANT_ENABLED,
  STRUCTURED_QUESTIONS_ENABLED,
} from '../config';
import { ApiError } from '../api';
import type { AssessmentFormat, Difficulty, Question, QuestionType } from '../lib/resources';
import type { ExamPaperMeta } from '../types';

// Display label per format. A map rather than a ternary: with three formats a
// `format === 'worksheet' ? … : …` silently titles an exit ticket "Quiz", and
// the compiler cannot warn about it. Adding a format to ASSESSMENT_FORMATS now
// makes this a type error until it is labelled.
const FORMAT_LABELS: Record<AssessmentFormat, string> = {
  quiz: 'Quiz',
  worksheet: 'Worksheet',
  exit_ticket: 'Exit Ticket',
  homework: 'Homework',
};

const FORMAT_ICONS: Record<AssessmentFormat, LucideIcon> = {
  quiz: FileQuestion,
  worksheet: ClipboardList,
  exit_ticket: Ticket,
  homework: House,
};

// Sensible default title for a generated assessment (editable before saving).
function defaultTitle(format: AssessmentFormat, topic: string, grade: string): string {
  const kind = FORMAT_LABELS[format];
  const t = topic.trim() || 'Untitled';
  const g = grade.trim() ? ` (${grade.trim()})` : '';
  return `${kind}: ${t}${g}`.slice(0, 200);
}

// The form's own starting values, in one place because two things now need
// them: the initial state below, and "Clear AI fields", which restores each
// AI-filled field to its DEFAULT rather than blanking it. Blanking would leave
// the required topic empty and the Generate button disabled, which reads as a
// broken page rather than as an undo.
//
// `instructions` is deliberately absent: it is not a router slot (there is no
// reliable way to tell extra instructions from the topic itself), so the router
// never fills it and undo has no business resetting what a teacher typed there.
const FORM_DEFAULTS = {
  format: 'quiz' as AssessmentFormat,
  grade: '',
  subject: '',
  topic: '',
  difficulty: 'medium' as Difficulty,
  questionType: 'mcq' as QuestionType,
  questionCount: QUESTION_COUNT_DEFAULT,
  language: 'en',
};

// Where a prefilled value came from, shown beside its label. The marker is
// TEXT, never colour alone (CHANGE-12), and sits inside the <span> that labels
// the field so a screen reader announces it as part of that label.
//
// Renders nothing where a marker would be noise rather than information:
//
//   - 'user'    — the teacher has since edited it; it is simply their value now.
//   - 'default' — difficulty, question type and count are ALWAYS filled, by the
//                 form itself, whether or not AI was involved. Flagging six
//                 fields as "guessed" reads as failure when it is just the form
//                 behaving normally.
function FieldNote({ source, uncertain }: { source: ProvenanceSource | undefined; uncertain: boolean }) {
  if (!source || source === 'user' || source === 'default') return null;

  // An ambiguous value the router chose not to guess at — "class 5-6" mapping
  // to two grade bands, typically. Worth a teacher's glance.
  if (uncertain) return <span className="ai-field-note uncertain">Check this</span>;

  const text = source === 'memory' ? 'Remembered' : source === 'profile' ? 'Your default' : 'AI';
  return <span className="ai-field-note">{text}</span>;
}

export default function GeneratorPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const navigate = useNavigate();
  const { show } = useToast();
  const { user } = useAuth();
  const generatorTip = useOnboardingTip('generator-intro');

  // Config form state.
  const [format, setFormat] = useState<AssessmentFormat>(FORM_DEFAULTS.format);
  const [grade, setGrade] = useState(FORM_DEFAULTS.grade);
  const [subject, setSubject] = useState(FORM_DEFAULTS.subject);
  const [topic, setTopic] = useState(FORM_DEFAULTS.topic);
  const [difficulty, setDifficulty] = useState<Difficulty>(FORM_DEFAULTS.difficulty);
  const [questionType, setQuestionType] = useState<QuestionType>(FORM_DEFAULTS.questionType);
  const [questionCount, setQuestionCount] = useState<number>(FORM_DEFAULTS.questionCount);
  const [language, setLanguage] = useState(FORM_DEFAULTS.language);
  const [instructions, setInstructions] = useState('');

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  // Synchronous twin of `generating`, checked and set before anything else in
  // handleGenerate. `generating` is React state: it is read from the closure
  // captured when THIS render happened, and `setGenerating(true)` only takes
  // effect once React commits the next render. A second rapid click on
  // Generate can invoke handleGenerate again before that commit lands, so
  // `if (generating) return;` alone reads a stale `false` and lets a second
  // real generation request through — confirmed via a network trace showing
  // two POST /api/resources/generate calls from one rapid-click burst. A ref
  // has no such gap: it is written and read immediately, same tick, same
  // guard the page already uses for `appliedDraftId` and `reportedGeneration`
  // above for the identical class of race.
  const generatingRef = useRef(false);

  // Result / preview state (present only after a successful generation).
  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  const [contentDirty, setContentDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Structured Question Model (Generator v2, docs/generator-v2-plan.md).
  // `structuredQuestions === null` means "this result has no native structured
  // questions" — either STRUCTURED_QUESTIONS_ENABLED is off, or the server
  // didn't return a parseable `structured` field — and the page falls back to
  // exactly the legacy content/textarea flow below, unchanged. `docInstructions`
  // is the document's own "Answer all questions…" line — NOT the same as the
  // `instructions` state above, which is the free-text prompt sent TO the AI.
  const [structuredQuestions, setStructuredQuestions] = useState<Question[] | null>(null);
  const [docInstructions, setDocInstructions] = useState('');
  const [structuredDirty, setStructuredDirty] = useState(false);
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});

  // Exam-paper letterhead (Phase 3) — deterministic teacher input, never sent
  // to Gemini. Initialized fresh on each successful generation, prefilled
  // from the teacher's site-wide defaults (Settings) and School/User identity.
  const [examMeta, setExamMeta] = useState<ExamPaperMeta>({});

  // ---- AI Action Router prefill (milestone M3) ----------------------------
  //
  // The entire integration is: seed the form state above, and show a banner.
  // Nothing below touches handleGenerate, handleSave, examMeta or the request
  // body — the Generate path stays byte-for-byte what it is for a teacher who
  // never uses the router.
  //
  // This page does NOT consume a router context and renders identically when
  // the assistant is absent or switched off. It imports three functions from
  // one module, which is the whole of its coupling to the feature.
  const [searchParams, setSearchParams] = useSearchParams();
  const [provenance, setProvenance] = useState<Record<string, ProvenanceSource>>({});
  const [lowConfidence, setLowConfidence] = useState<string[]>([]);
  const [aiUtterance, setAiUtterance] = useState('');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Latched for the whole visit, so clearing the AI fields does not suddenly
  // pop the onboarding tip into the space the banner just left (CHANGE-10).
  const [routedVisit, setRoutedVisit] = useState(false);

  // Flag off ⇒ the handle is ignored and no router code path is reachable.
  const draftId = ASSISTANT_ENABLED ? searchParams.get('ai') ?? '' : '';

  // Which draft has already been applied. Without this, the effect below would
  // re-apply the same values over the teacher's edits on every re-render.
  const appliedDraftId = useRef<string | null>(null);

  // Keyed on the handle, NOT on mount (CHANGE-7). React Router does not remount
  // this component when only the search parameter changes — the path is still
  // /generator — so a mount-only read silently does nothing the second time a
  // teacher routes here. The sequence that exposes it: coach → prefill → back →
  // coach → new command → nothing happens, and the feature looks broken.
  useEffect(() => {
    if (!draftId || appliedDraftId.current === draftId) return;

    // Recorded before the null check so an unusable handle is not retried on
    // every render. Missing, expired, cleared, wrong-action and storage-failure
    // all land here and leave the form exactly as it would have been.
    appliedDraftId.current = draftId;

    const prefill = loadPrefill(draftId);
    if (!prefill) return;

    const { values } = prefill;
    if (values.format !== undefined) setFormat(values.format);
    if (values.grade !== undefined) setGrade(values.grade);
    if (values.subject !== undefined) setSubject(values.subject);
    if (values.topic !== undefined) setTopic(values.topic);
    if (values.difficulty !== undefined) setDifficulty(values.difficulty);
    if (values.questionType !== undefined) setQuestionType(values.questionType);
    if (values.questionCount !== undefined) setQuestionCount(values.questionCount);
    if (values.language !== undefined) setLanguage(values.language);

    setProvenance(prefill.provenance);
    setLowConfidence(prefill.lowConfidenceFields);
    setAiUtterance(prefill.utterance);
    setBannerDismissed(false);
    setRoutedVisit(true);
    // A new draft is a new session, so it gets its own outcome (M8). Without
    // this, routing a second time in the same mounted page — the CHANGE-7
    // sequence — would silently report nothing.
    reportedGeneration.current = false;
    // No generation request fires here. The teacher reviews, then presses
    // Generate — that review step is what makes prefilling safe at all.
  }, [draftId]);

  // Whether this visit's prefill has already been reported as generated. The
  // latch lives here as well as in the transport because the cheapest place to
  // not fire an event is before calling anything at all.
  const reportedGeneration = useRef(false);

  // The `generated` outcome (M8) — the half of the field-edit rate that says the
  // routing actually worked.
  //
  // ─── WHY THIS IS AN OBSERVER AND NOT A LINE IN handleGenerate ────────────
  // `handleGenerate` is a protected area (README §6 #1), and spec §6.7 is
  // explicit: "Router concepts inside handleGenerate, handleSave or any request
  // body mean the integration has overreached." So the fact is established from
  // OUTSIDE instead. `content` becomes non-null only when a generation
  // succeeded, and AI provenance being present means those fields came from a
  // prefill. Together they are exactly the event, and the generation path gains
  // zero lines and zero router imports.
  //
  // Latched per visit, so pressing Regenerate does not report a second outcome —
  // which is also what keeps the two-rows-per-session ceiling true.
  useEffect(() => {
    if (reportedGeneration.current) return;
    if (content === null) return;
    if (Object.keys(provenance).length === 0) return;

    reportedGeneration.current = true;
    notePrefillGeneration();
  }, [content, provenance]);

  // A field the router filled has been edited by hand. Its provenance becomes
  // 'user' (so undo leaves it alone — undo reverses the AI, not the teacher),
  // its marker disappears, and a correction event records the field NAME and
  // where the value had come from. Never the value itself.
  function noteEdit(field: string) {
    const from = provenance[field];
    if (!from || from === 'user') return;
    notePrefillEdit(field, from);
    setProvenance((prev) => ({ ...prev, [field]: 'user' }));
    setLowConfidence((prev) => prev.filter((f) => f !== field));
  }

  // "Clear AI fields".
  function handleClearAiFields() {
    const toReset = Object.entries(provenance)
      .filter(([, source]) => source !== 'user')
      .map(([field]) => field);

    for (const field of toReset) {
      if (field === 'format') setFormat(FORM_DEFAULTS.format);
      if (field === 'grade') setGrade(FORM_DEFAULTS.grade);
      if (field === 'subject') setSubject(FORM_DEFAULTS.subject);
      if (field === 'topic') setTopic(FORM_DEFAULTS.topic);
      if (field === 'difficulty') setDifficulty(FORM_DEFAULTS.difficulty);
      if (field === 'questionType') setQuestionType(FORM_DEFAULTS.questionType);
      if (field === 'questionCount') setQuestionCount(FORM_DEFAULTS.questionCount);
      if (field === 'language') setLanguage(FORM_DEFAULTS.language);
    }

    if (draftId) discardPrefill(draftId, toReset.length);
    setProvenance({});
    setLowConfidence([]);
    setAiUtterance('');

    // Drop the handle with a REPLACE navigation: no new history entry, so Back
    // still returns to wherever the teacher came from rather than re-entering
    // the page they just cleared.
    const next = new URLSearchParams(searchParams);
    next.delete('ai');
    setSearchParams(next, { replace: true });
  }

  const aiFieldCount = Object.keys(provenance).length;
  // Auto-dismissed once a result exists — at that point the banner describes a
  // form the teacher has already acted on.
  const showAiBanner = aiFieldCount > 0 && !bannerDismissed && content === null;

  async function handleGenerate(e?: FormEvent) {
    e?.preventDefault();
    if (generatingRef.current) return;
    if (!topic.trim()) {
      show('Please enter a topic', 'error');
      return;
    }
    if (content !== null && (contentDirty || structuredDirty)) {
      const ok = window.confirm('Regenerating will replace your edited preview. Continue?');
      if (!ok) return;
    }

    generatingRef.current = true;
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

      // Structured Question Model (Generator v2) — only enters structured
      // mode behind the flag, matching docs/generator-v2-plan.md's own
      // staged rollout ("web Generator behind the client flag, turned on
      // only in dev"). With the flag off, `result.structured` is simply
      // never looked at, and the page behaves byte-for-byte as it did
      // before this feature existed.
      const parsedDoc = STRUCTURED_QUESTIONS_ENABLED ? parseStructuredDocument(result.structured) : null;
      setStructuredQuestions(parsedDoc ? parsedDoc.questions : null);
      setDocInstructions(parsedDoc ? parsedDoc.instructions : '');
      setStructuredDirty(false);
      setQuestionErrors({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate. Please try again.');
    } finally {
      generatingRef.current = false;
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

    // Structured Question Model (Generator v2): validate every question
    // before saving — a UX nicety only, the server's own schema is always
    // the final authority (docs/generator-v2-plan.md §8).
    if (structuredQuestions !== null) {
      if (structuredQuestions.length === 0) {
        show('Add at least one question before saving', 'error');
        return;
      }
      const errors = validateQuestions(structuredQuestions);
      if (Object.keys(errors).length > 0) {
        setQuestionErrors(errors);
        show('Fix the highlighted questions before saving', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const structuredPayload = structuredQuestions !== null
        ? buildStructuredPayload({
            instructions: docInstructions,
            questions: structuredQuestions,
            format, difficulty, questionType, questionCount, topic: topic.trim(), examMeta,
          })
        : JSON.stringify({ format, difficulty, questionType, questionCount, topic: topic.trim(), examMeta });

      const saved = await createResource({
        type: 'assessment',
        title: cleanTitle.slice(0, 200),
        grade: grade.trim() || undefined,
        subject: subject.trim() || undefined,
        language,
        // In structured mode the server re-renders `content` itself from
        // `structured.questions` (docs/generator-v2-plan.md §2c) — the
        // client never computes the printable Markdown, so `content` is
        // simply omitted rather than sent stale.
        ...(structuredQuestions !== null ? {} : { content }),
        structured: structuredPayload,
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

  // Same reasoning as FORMAT_LABELS: a Record makes a new format a compile
  // error here rather than silently inheriting the quiz icon.
  const FormatIcon = FORMAT_ICONS[format];

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

        {showAiBanner && (
          <AiPrefillBanner
            fieldCount={aiFieldCount}
            lowConfidenceCount={lowConfidence.length}
            utterance={aiUtterance}
            onUndo={handleClearAiFields}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}

        {/* The AI banner takes precedence over the first-visit tip (CHANGE-10).
            Two stacked callouts plus a form pushes the form below the fold on a
            phone, and of the two the banner is the one describing what just
            happened and carrying the undo. The tip is NOT marked dismissed, so
            it still appears on a later manual visit. */}
        {generatorTip.visible && !routedVisit && (
          <OnboardingTip onDismiss={generatorTip.dismiss}>
            Pick a format and topic to generate a printable quiz or worksheet with an answer key. Your school
            letterhead comes from your <strong>Settings</strong> paper defaults.
          </OnboardingTip>
        )}

        <form className="generator-form" onSubmit={handleGenerate}>
          <fieldset className="generator-fieldset">
            <legend className="ws-label">
              Format
              <FieldNote source={provenance.format} uncertain={lowConfidence.includes('format')} />
            </legend>
            <div className="generator-format-row" role="radiogroup" aria-label="Format">
              {ASSESSMENT_FORMATS.map((f) => (
                <button
                  type="button"
                  key={f.value}
                  role="radio"
                  aria-checked={format === f.value}
                  className={`generator-format-card${format === f.value ? ' active' : ''}`}
                  onClick={() => { setFormat(f.value); noteEdit('format'); }}
                >
                  <span className="generator-format-label">
                    {(() => { const Icon = FORMAT_ICONS[f.value]; return <Icon size={16} aria-hidden="true" />; })()}
                    {f.label}
                  </span>
                  <span className="generator-format-hint">{f.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="generator-grid">
            <label className="ws-field">
              <span className="ws-label">
                Topic <span className="generator-req" aria-hidden="true">*</span>
                <FieldNote source={provenance.topic} uncertain={lowConfidence.includes('topic')} />
              </span>
              <input
                type="text"
                value={topic}
                onChange={(e) => { setTopic(e.target.value); noteEdit('topic'); }}
                maxLength={200}
                required
                placeholder="e.g. Fractions, Water cycle, Parts of speech"
                aria-label="Topic (required)"
              />
            </label>
            <label className="ws-field">
              <span className="ws-label">
                Grade
                <FieldNote source={provenance.grade} uncertain={lowConfidence.includes('grade')} />
              </span>
              <input type="text" list="gen-grades" value={grade} maxLength={80} onChange={(e) => { setGrade(e.target.value); noteEdit('grade'); }} placeholder="e.g. Class 3-5" />
            </label>
            <label className="ws-field">
              <span className="ws-label">
                Subject
                <FieldNote source={provenance.subject} uncertain={lowConfidence.includes('subject')} />
              </span>
              <input type="text" list="gen-subjects" value={subject} maxLength={80} onChange={(e) => { setSubject(e.target.value); noteEdit('subject'); }} placeholder="e.g. Mathematics" />
            </label>
            <label className="ws-field">
              <span className="ws-label">
                Difficulty
                <FieldNote source={provenance.difficulty} uncertain={lowConfidence.includes('difficulty')} />
              </span>
              <select value={difficulty} onChange={(e) => { setDifficulty(e.target.value as Difficulty); noteEdit('difficulty'); }}>
                {DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
            <label className="ws-field">
              <span className="ws-label">
                Question type
                <FieldNote source={provenance.questionType} uncertain={lowConfidence.includes('questionType')} />
              </span>
              <select value={questionType} onChange={(e) => { setQuestionType(e.target.value as QuestionType); noteEdit('questionType'); }}>
                {QUESTION_TYPES.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </label>
            <label className="ws-field">
              <span className="ws-label">
                Number of questions ({QUESTION_COUNT_MIN}–{QUESTION_COUNT_MAX})
                <FieldNote source={provenance.questionCount} uncertain={lowConfidence.includes('questionCount')} />
              </span>
              <input
                type="number"
                min={QUESTION_COUNT_MIN}
                max={QUESTION_COUNT_MAX}
                value={questionCount}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setQuestionCount(Number.isNaN(n) ? QUESTION_COUNT_MIN : Math.min(QUESTION_COUNT_MAX, Math.max(QUESTION_COUNT_MIN, n)));
                  noteEdit('questionCount');
                }}
              />
            </label>
            <label className="ws-field">
              <span className="ws-label">
                Language
                <FieldNote source={provenance.language} uncertain={lowConfidence.includes('language')} />
              </span>
              <select value={language} onChange={(e) => { setLanguage(e.target.value); noteEdit('language'); }}>
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

              {structuredQuestions !== null ? (
                tab === 'edit' ? (
                  <>
                    <label className="ws-field question-list-instructions">
                      <span className="ws-label">Instructions for students</span>
                      <input
                        type="text"
                        value={docInstructions}
                        maxLength={500}
                        onChange={(e) => { setDocInstructions(e.target.value); setStructuredDirty(true); }}
                        placeholder="e.g. Answer all questions carefully."
                      />
                    </label>
                    <QuestionListEditor
                      questions={structuredQuestions}
                      editable
                      errors={questionErrors}
                      onChange={(next) => {
                        setStructuredQuestions(next);
                        setStructuredDirty(true);
                        setQuestionErrors({});
                      }}
                    />
                  </>
                ) : (
                  <div className="response-body workspace-preview exam-paper">
                    <ExamHeader meta={examMeta} fallbackTitle={title} subject={subject} grade={grade} />
                    {docInstructions && <p className="question-list-instructions-display">{docInstructions}</p>}
                    <QuestionListEditor questions={structuredQuestions} editable={false} />
                  </div>
                )
              ) : tab === 'edit' ? (
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
