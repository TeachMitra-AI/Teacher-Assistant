import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileQuestion, ClipboardList, Sparkles, Loader2, Pencil, Eye, Save, ArrowRight, Ticket, House, ChevronDown,
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
import { useDismissable } from '../hooks/useDismissable';
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
import { useRetryCountdown } from '../hooks/useRetryCountdown';
import { retryMessage } from '../lib/retryCountdown';
import type { AssessmentFormat, Difficulty, Question, QuestionType, QuestionTypeSelection } from '../lib/resources';
import type { ExamPaperMeta } from '../types';

// Display label per format. A map rather than a ternary, which would silently title an exit ticket "Quiz"; a new format in
// ASSESSMENT_FORMATS is a type error until labelled.
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

// Keeps the question count inside [QUESTION_COUNT_MIN, QUESTION_COUNT_MAX]. Used on blur and again before a generate/save
// request, so the bound holds even if blur never fires (e.g. Enter submitting mid-edit).
function clampQuestionCount(n: number): number {
  if (Number.isNaN(n)) return QUESTION_COUNT_MIN;
  return Math.min(QUESTION_COUNT_MAX, Math.max(QUESTION_COUNT_MIN, n));
}

// Collapses the picker's array to a bare value when one type is selected, the single-select shape the server has always seen
// (see buildGeneratorPrompt's "types.length === 1" branch).
function questionTypePayload(types: QuestionType[]): QuestionTypeSelection {
  return types.length === 1 ? types[0] : types;
}

// The form's starting values, shared by the initial state and "Clear AI fields", which restores each AI-filled field to its
// default rather than blanking it (a blank required topic disables Generate and reads as a broken page).
// `instructions` is absent on purpose: it isn't a router slot (extra instructions can't be reliably told from the topic), so
// undo shouldn't reset what a teacher typed there.
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

// Where a prefilled value came from, shown beside its label. The marker is text, never colour alone, and sits inside the label
// <span> so a screen reader announces it as part of the label. It renders nothing where it would be noise: 'user' (the teacher
// has edited it, so it's their value) and 'default' (difficulty, question type and count are always filled by the form, so
// flagging them reads as failure).
function FieldNote({ source, uncertain }: { source: ProvenanceSource | undefined; uncertain: boolean }) {
  if (!source || source === 'user' || source === 'default') return null;

  // An ambiguous value the router chose not to guess at (e.g. "class 5-6" mapping to two grade bands); worth a glance.
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
  // A teacher can tick several specific types in the dropdown below. The array can go empty (deselecting the last one);
  // handleGenerate validates that like a blank topic. On submit it collapses to a bare value when only one is picked, so the
  // request the server sees for that common case is unchanged (buildGeneratorPrompt's "types.length === 1" branch).
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([FORM_DEFAULTS.questionType]);
  // Whether the question-type popover is open; closed by outside click or Escape like the other popovers (ClassroomModeMenu, ProfileMenu).
  const [questionTypeOpen, setQuestionTypeOpen] = useState(false);
  const questionTypeRef = useRef<HTMLDivElement>(null);
  useDismissable(questionTypeOpen, questionTypeRef, () => setQuestionTypeOpen(false));
  const [questionCount, setQuestionCount] = useState<number>(FORM_DEFAULTS.questionCount);
  // The number input's displayed text, separate from `questionCount` so a teacher can clear and retype (e.g. "10" to "25")
  // without each keystroke snapping to QUESTION_COUNT_MIN. Clamped on blur, like FeeStatusBoard.tsx's amount inputs.
  const [questionCountInput, setQuestionCountInput] = useState(String(FORM_DEFAULTS.questionCount));
  const [language, setLanguage] = useState(FORM_DEFAULTS.language);
  const [instructions, setInstructions] = useState('');

  // Reflects `questionCount` into the input when it changes from outside (AI prefill, undo); see questionCountInput above.
  useEffect(() => {
    setQuestionCountInput(String(questionCount));
  }, [questionCount]);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  // Every Gemini API key exhausted (ApiError.retryAt): shown in place of `error` and auto-clears; see the effect below.
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const { remainingMs: retryRemainingMs, ready: retryReady } = useRetryCountdown(retryAt);
  useEffect(() => {
    if (retryAt != null && retryReady) setRetryAt(null);
  }, [retryAt, retryReady]);
  // Synchronous twin of `generating`, set before anything else in handleGenerate. State is read from the render's closure and
  // updates only on commit, so a rapid second click could pass `if (generating) return;` and send a second request (seen as two
  // POST /api/resources/generate calls from one burst). A ref has no such gap, like `appliedDraftId` and `reportedGeneration` above.
  const generatingRef = useRef(false);

  // Result / preview state (present only after a successful generation).
  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  const [contentDirty, setContentDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Structured Question Model (docs/generator-v2-plan.md). `structuredQuestions === null` means the result has no native
  // structured questions (flag off, or no parseable `structured` field), and the page uses the legacy content/textarea flow.
  // `docInstructions` is the document's "Answer all questions…" line, not the `instructions` state above (the prompt sent to the AI).
  const [structuredQuestions, setStructuredQuestions] = useState<Question[] | null>(null);
  const [docInstructions, setDocInstructions] = useState('');
  const [structuredDirty, setStructuredDirty] = useState(false);
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});

  // Exam-paper letterhead: teacher input, never sent to Gemini. Re-initialized on each generation from the site-wide defaults (Settings) and School/User identity.
  const [examMeta, setExamMeta] = useState<ExamPaperMeta>({});

  // ---- AI Action Router prefill ----
  // The integration is only: seed the form state above and show a banner. Nothing below touches handleGenerate, handleSave,
  // examMeta or the request body, so the Generate path is unchanged for teachers who never use the router. The page consumes no
  // router context and renders the same when the assistant is absent or off; it imports three functions from one module.
  const [searchParams, setSearchParams] = useSearchParams();
  const [provenance, setProvenance] = useState<Record<string, ProvenanceSource>>({});
  const [lowConfidence, setLowConfidence] = useState<string[]>([]);
  const [aiUtterance, setAiUtterance] = useState('');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Latched for the visit, so clearing the AI fields doesn't pop the onboarding tip into the banner's space.
  const [routedVisit, setRoutedVisit] = useState(false);

  // Flag off ⇒ the handle is ignored and no router code path is reachable.
  const draftId = ASSISTANT_ENABLED ? searchParams.get('ai') ?? '' : '';

  // Which draft was already applied; otherwise the effect below would re-apply values over the teacher's edits on every render.
  const appliedDraftId = useRef<string | null>(null);

  // Keyed on the handle, not mount: React Router doesn't remount when only the search param changes (the path stays
  // /generator), so a mount-only read did nothing the second time a teacher routed here (coach → prefill → back → coach → new command).
  useEffect(() => {
    if (!draftId || appliedDraftId.current === draftId) return;

    // Recorded before the null check so an unusable handle isn't retried each render. Missing, expired, cleared, wrong-action
    // and storage-failure all land here and leave the form as it was.
    appliedDraftId.current = draftId;

    const prefill = loadPrefill(draftId);
    if (!prefill) return;

    const { values } = prefill;
    if (values.format !== undefined) setFormat(values.format);
    if (values.grade !== undefined) setGrade(values.grade);
    if (values.subject !== undefined) setSubject(values.subject);
    if (values.topic !== undefined) setTopic(values.topic);
    if (values.difficulty !== undefined) setDifficulty(values.difficulty);
    if (values.questionType !== undefined) setQuestionTypes([values.questionType]);
    if (values.questionCount !== undefined) setQuestionCount(values.questionCount);
    if (values.language !== undefined) setLanguage(values.language);

    setProvenance(prefill.provenance);
    setLowConfidence(prefill.lowConfidenceFields);
    setAiUtterance(prefill.utterance);
    setBannerDismissed(false);
    setRoutedVisit(true);
    // A new draft is a new session with its own outcome; otherwise a second routing in the same mounted page would report nothing.
    reportedGeneration.current = false;
    // No generation request fires here: the teacher reviews, then presses Generate, which is what makes prefilling safe.
  }, [draftId]);

  // Whether this visit's prefill was already reported as generated. The transport latches too, but not calling at all is cheapest.
  const reportedGeneration = useRef(false);

  // The `generated` outcome: the half of the field-edit rate that says the routing worked.
  // An observer, not a line in handleGenerate: that function is off limits to router concepts, so the fact is established from
  // outside. `content` becomes non-null only on a successful generation, and AI provenance means those fields came from a
  // prefill, so together they are the event and the generation path gains no lines or router imports.
  // Latched per visit, so Regenerate doesn't report a second outcome (which keeps the two-rows-per-session ceiling).
  useEffect(() => {
    if (reportedGeneration.current) return;
    if (content === null) return;
    if (Object.keys(provenance).length === 0) return;

    reportedGeneration.current = true;
    notePrefillGeneration();
  }, [content, provenance]);

  // A router-filled field was edited by hand. Its provenance becomes 'user' (undo reverses the AI, not the teacher), its
  // marker disappears, and a correction event records the field name and where the value came from, never the value.
  function noteEdit(field: string) {
    const from = provenance[field];
    if (!from || from === 'user') return;
    notePrefillEdit(field, from);
    setProvenance((prev) => ({ ...prev, [field]: 'user' }));
    setLowConfidence((prev) => prev.filter((f) => f !== field));
  }

  // Toggles one question type in the popover. "Mixed" is exclusive: ticking it replaces the selection and leaves it the only
  // enabled row; ticking a specific type while "Mixed" is on starts a fresh selection. The result can go empty (unticking the
  // last); handleGenerate validates that like a blank topic instead of the picker refusing.
  function toggleQuestionType(value: QuestionType) {
    setQuestionTypes((prev) => {
      if (value === 'mixed') return prev.includes('mixed') ? [] : ['mixed'];
      if (prev.includes(value)) return prev.filter((t) => t !== value);
      if (prev.includes('mixed')) return [value];
      return [...prev, value];
    });
    noteEdit('questionType');
  }

  // What the closed dropdown shows: the selected labels, or a placeholder once all are unticked (handleGenerate blocks submitting that).
  const questionTypeSummary = questionTypes.length === 0
    ? 'Select question types'
    : questionTypes.map((t) => QUESTION_TYPES.find((q) => q.value === t)?.label ?? t).join(', ');

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
      if (field === 'questionType') setQuestionTypes([FORM_DEFAULTS.questionType]);
      if (field === 'questionCount') setQuestionCount(FORM_DEFAULTS.questionCount);
      if (field === 'language') setLanguage(FORM_DEFAULTS.language);
    }

    if (draftId) discardPrefill(draftId, toReset.length);
    setProvenance({});
    setLowConfidence([]);
    setAiUtterance('');

    // Drop the handle with a REPLACE navigation, so Back returns to where the teacher came from instead of the page they cleared.
    const next = new URLSearchParams(searchParams);
    next.delete('ai');
    setSearchParams(next, { replace: true });
  }

  const aiFieldCount = Object.keys(provenance).length;
  // Auto-dismissed once a result exists, since the banner then describes a form already acted on.
  const showAiBanner = aiFieldCount > 0 && !bannerDismissed && content === null;

  async function handleGenerate(e?: FormEvent) {
    e?.preventDefault();
    if (generatingRef.current) return;
    if (!topic.trim()) {
      show('Please enter a topic', 'error');
      return;
    }
    if (questionTypes.length === 0) {
      show('Please select at least one question type', 'error');
      return;
    }
    if (content !== null && (contentDirty || structuredDirty)) {
      const ok = window.confirm('Regenerating will replace your edited preview. Continue?');
      if (!ok) return;
    }

    // Normally clamped on blur; this matters only if Enter submitted first. Committed to state so a later Save writes the requested metadata.
    const count = clampQuestionCount(questionCount);
    if (count !== questionCount) {
      setQuestionCount(count);
      setQuestionCountInput(String(count));
    }

    generatingRef.current = true;
    setGenerating(true);
    setError('');
    setRetryAt(null);
    const input: GenerateAssessmentInput = {
      format,
      grade: grade.trim() || undefined,
      subject: subject.trim() || undefined,
      topic: topic.trim(),
      difficulty,
      questionType: questionTypePayload(questionTypes),
      questionCount: count,
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

      // Structured mode only behind the flag (docs/generator-v2-plan.md staged rollout); with it off, `result.structured` is
      // never read and the page behaves as before.
      const parsedDoc = STRUCTURED_QUESTIONS_ENABLED ? parseStructuredDocument(result.structured) : null;
      setStructuredQuestions(parsedDoc ? parsedDoc.questions : null);
      setDocInstructions(parsedDoc ? parsedDoc.instructions : '');
      setStructuredDirty(false);
      setQuestionErrors({});
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED' && err.retryAt != null) {
        setRetryAt(err.retryAt);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not generate. Please try again.');
      }
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

    // Validate every question before saving: a UX nicety, the server's schema is the authority (docs/generator-v2-plan.md).
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
      const questionType = questionTypePayload(questionTypes);
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
        // In structured mode the server re-renders `content` from `structured.questions`, so it's omitted rather than sent stale.
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

  // Like FORMAT_LABELS: a Record makes a new format a compile error instead of silently inheriting the quiz icon.
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

        {/* The AI banner takes precedence over the first-visit tip: two stacked callouts plus the form would push the form below
            the fold on a phone, and the banner describes what just happened and carries the undo. The tip isn't marked
            dismissed, so it still appears on a later manual visit. */}
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
              <select value={grade} onChange={(e) => { setGrade(e.target.value); noteEdit('grade'); }}>
                <option value="">Select grade</option>
                {/* Covers a prefilled/remembered value outside the canonical list (e.g. from AI routing) so it's never silently dropped. */}
                {grade && !GRADES.includes(grade) && <option value={grade}>{grade}</option>}
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="ws-field">
              <span className="ws-label">
                Subject
                <FieldNote source={provenance.subject} uncertain={lowConfidence.includes('subject')} />
              </span>
              <select value={subject} onChange={(e) => { setSubject(e.target.value); noteEdit('subject'); }}>
                <option value="">Select subject</option>
                {subject && !SUBJECTS.includes(subject) && <option value={subject}>{subject}</option>}
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
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
              <div className="generator-type-select" ref={questionTypeRef}>
                <button
                  type="button"
                  className="generator-type-select-btn"
                  aria-haspopup="listbox"
                  aria-expanded={questionTypeOpen}
                  aria-label="Question type"
                  onClick={() => setQuestionTypeOpen((o) => !o)}
                >
                  <span className="generator-type-select-value">{questionTypeSummary}</span>
                  <ChevronDown size={14} aria-hidden="true" className="generator-type-select-caret" />
                </button>
                {questionTypeOpen && (
                  <div className="generator-type-popover" role="listbox" aria-label="Question type" aria-multiselectable="true">
                    {QUESTION_TYPES.filter((q) => q.value !== 'mixed').map((q) => {
                      const active = questionTypes.includes(q.value);
                      // "Mixed" is exclusive: while ticked, other rows are disabled rather than hidden, so options stay visible.
                      const disabled = questionTypes.includes('mixed');
                      return (
                        <label key={q.value} className={`generator-type-option${disabled ? ' disabled' : ''}`}>
                          <input
                            type="checkbox"
                            checked={active}
                            disabled={disabled}
                            onChange={() => toggleQuestionType(q.value)}
                          />
                          {q.label}
                        </label>
                      );
                    })}
                    <div className="generator-type-divider" />
                    <label className="generator-type-option">
                      <input
                        type="checkbox"
                        checked={questionTypes.includes('mixed')}
                        onChange={() => toggleQuestionType('mixed')}
                      />
                      Mixed
                    </label>
                  </div>
                )}
              </div>
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
                value={questionCountInput}
                onChange={(e) => {
                  // Free typing: the box shows exactly what was typed (even empty or out of range); clamped on blur.
                  setQuestionCountInput(e.target.value);
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) setQuestionCount(n);
                  noteEdit('questionCount');
                }}
                onBlur={() => {
                  const clamped = clampQuestionCount(parseInt(questionCountInput, 10));
                  setQuestionCount(clamped);
                  setQuestionCountInput(String(clamped));
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
            <button
              type="submit"
              className="btn-primary generator-generate"
              disabled={generating || !topic.trim() || questionTypes.length === 0 || (retryAt != null && !retryReady)}
            >
              {generating ? <Loader2 size={16} aria-hidden="true" className="spin" /> : <Sparkles size={16} aria-hidden="true" />}
              {generating ? 'Generating…' : content !== null ? 'Regenerate' : 'Generate'}
            </button>
          </div>

          {retryAt != null && !retryReady ? (
            <p className="auth-error generator-error">{retryMessage(retryRemainingMs)}</p>
          ) : (
            error && <p className="auth-error generator-error">{error}</p>
          )}
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
                  {/* The letterhead already shows the title/metadata, so the generated preamble is stripped from display, never from the saved content. */}
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
