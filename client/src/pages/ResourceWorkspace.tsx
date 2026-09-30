import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Save, Printer, Pencil, Eye, Wand2, Puzzle,
  ClipboardCheck, GraduationCap, X, Loader2,
  TrendingDown, TrendingUp, ListPlus, Type, ChevronDown,
} from 'lucide-react';
import TopBar from '../components/TopBar';
import ExamHeader from '../components/ExamHeader';
import ExamHeaderEditor from '../components/ExamHeaderEditor';
import OnboardingTip from '../components/OnboardingTip';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth';
import { useDismissable } from '../hooks/useDismissable';
import { usePreferences } from '../hooks/usePreferences';
import { useOnboardingTip } from '../hooks/useOnboardingTip';
import { formatResponse } from '../lib/format';
import { buildInitialExamMeta, mergeExamMeta, parseExamMeta } from '../lib/examMeta';
import { getResource, updateResource, runAiAction, type AiActionId, type Question } from '../lib/resources';
import { splitAnswerKey, stripAssessmentPreamble } from '../lib/assessment';
import {
  buildStructuredPayload,
  parseStructuredDocument,
  validateQuestions,
} from '../lib/structuredQuestions';
import QuestionListEditor from '../components/QuestionListEditor';
import { RESOURCE_TYPES, RESOURCE_TYPE_META, LANGUAGES, GRADES, SUBJECTS } from '../config';
import { ApiError } from '../api';
import { useRetryCountdown } from '../hooks/useRetryCountdown';
import { retryMessage } from '../lib/retryCountdown';
import type { ExamPaperMeta, LibraryResource, ResourceType } from '../types';

// How the print document should render an assessment.
type PrintMode = 'full' | 'student' | 'teacher';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// The editable slice of a resource the workspace owns, kept apart from the loaded resource to diff against a baseline for unsaved-change tracking.
interface FormState {
  title: string;
  type: ResourceType;
  grade: string;
  subject: string;
  language: string;
  content: string;
}

function toForm(r: LibraryResource): FormState {
  return {
    title: r.title,
    type: r.type,
    grade: r.grade ?? '',
    subject: r.subject ?? '',
    language: r.language || 'en',
    content: r.content ?? '',
  };
}

// AI assist actions, each mapping to a server action id. The key stays server-side, the result is never persisted, and a full
// revised document comes back so applying is a content replace. `adapt_grade` shows a grade picker first.
interface AiActionDef {
  id: AiActionId;
  label: string;
  icon: typeof Wand2;
  needsGrade?: boolean;
  assessmentOnly?: boolean;
}

const AI_ACTIONS: AiActionDef[] = [
  { id: 'simplify', label: 'Make it simpler', icon: Wand2 },
  { id: 'add_activities', label: 'Add classroom activities', icon: Puzzle },
  { id: 'add_assessment', label: 'Add assessment questions', icon: ClipboardCheck },
  { id: 'adapt_grade', label: 'Adapt for another grade', icon: GraduationCap, needsGrade: true },
  // Assessment-only (quiz / worksheet) follow-ups.
  { id: 'make_easier', label: 'Make easier', icon: TrendingDown, assessmentOnly: true },
  { id: 'make_harder', label: 'Make harder', icon: TrendingUp, assessmentOnly: true },
  { id: 'more_questions', label: 'Generate more questions', icon: ListPlus, assessmentOnly: true },
  { id: 'simplify_wording', label: 'Simplify wording', icon: Type, assessmentOnly: true },
];

export default function ResourceWorkspace({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { show } = useToast();
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;
  const workspaceTip = useOnboardingTip('workspace-intro');
  const aiAssistTip = useOnboardingTip('ai-assist-intro');

  const [resource, setResource] = useState<LibraryResource | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [baseline, setBaseline] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  // Exam-paper letterhead, kept apart from FormState since it lives in the opaque `structured` JSON column. A resource never
  // customized loads with prefilled values (school/teacher identity + site defaults) rather than blank, and `examMetaBaseline`
  // gets the same value so that alone isn't an unsaved change.
  const [examMeta, setExamMeta] = useState<ExamPaperMeta>({});
  const [examMetaBaseline, setExamMetaBaseline] = useState<ExamPaperMeta>({});

  // Structured Question Model (docs/generator-v2-plan.md). `structuredQuestions === null` means no native structured questions
  // (legacy, or a non-assessment type) and the page uses the flat content/textarea flow. `structuredDoc` keeps the rest of the
  // parsed document (format/topic/grade/subject/difficulty/questionType/questionCount) so a save round-trips it.
  const [structuredQuestions, setStructuredQuestions] = useState<Question[] | null>(null);
  const [structuredBaseline, setStructuredBaseline] = useState<Question[] | null>(null);
  const [docInstructions, setDocInstructions] = useState('');
  const [docInstructionsBaseline, setDocInstructionsBaseline] = useState('');
  const [structuredConfig, setStructuredConfig] = useState<{
    format?: string; topic?: string; grade?: string; subject?: string; difficulty?: string;
  }>({});
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  // AI assist state.
  const [aiBusy, setAiBusy] = useState<AiActionId | null>(null);
  // Every Gemini API key exhausted (ApiError.retryAt): a persistent inline message rather than a toast (which auto-dismisses long
  // before an hours-long cooldown ends), auto-cleared when the countdown reaches zero.
  const [aiCooldownUntil, setAiCooldownUntil] = useState<number | null>(null);
  const { remainingMs: aiCooldownRemainingMs, ready: aiCooldownReady } = useRetryCountdown(aiCooldownUntil);
  useEffect(() => {
    if (aiCooldownUntil != null && aiCooldownReady) setAiCooldownUntil(null);
  }, [aiCooldownUntil, aiCooldownReady]);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptGrade, setAdaptGrade] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestionStructured, setSuggestionStructured] = useState<string | null>(null);

  // Print state. `printReq` bumps a counter to call window.print() after the print document re-renders in the chosen mode (student omits the key).
  const [printMode, setPrintMode] = useState<PrintMode>('full');
  const [printReq, setPrintReq] = useState(0);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const printMenuRef = useRef<HTMLDivElement>(null);
  useDismissable(printMenuOpen, printMenuRef, () => setPrintMenuOpen(false));

  const dirty = useMemo(
    () =>
      (!!form && !!baseline && (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== baseline[k])) ||
      JSON.stringify(examMeta) !== JSON.stringify(examMetaBaseline) ||
      JSON.stringify(structuredQuestions) !== JSON.stringify(structuredBaseline) ||
      docInstructions !== docInstructionsBaseline,
    [form, baseline, examMeta, examMetaBaseline, structuredQuestions, structuredBaseline, docInstructions, docInstructionsBaseline]
  );

  // Load the resource. A 404 (missing or not owned) gets its own state so we never imply another user's resource exists.
  // `userRef` (not `user`) is read in the effect so an unrelated user update (e.g. Settings saving another preference) can't
  // re-trigger it and wipe in-progress edits; only a different resource id reloads.
  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    setLoading(true);
    setError('');
    setNotFound(false);
    getResource(id)
      .then((r) => {
        if (cancelled) return;
        setResource(r);
        const f = toForm(r);
        setForm(f);
        setBaseline(f);
        const savedExamMeta = parseExamMeta(r.structured);
        const currentUser = userRef.current;
        const initialExamMeta = Object.keys(savedExamMeta).length > 0
          ? savedExamMeta
          : currentUser
            ? buildInitialExamMeta(currentUser, currentUser.preferences.examPaperDefaults)
            : {};
        setExamMeta(initialExamMeta);
        setExamMetaBaseline(initialExamMeta);

        // Only assessments carry structured.questions; anything else (or a legacy assessment with no schemaVersion) leaves
        // structuredQuestions null and uses the flat editor.
        const parsedDoc = r.type === 'assessment' ? parseStructuredDocument(r.structured) : null;
        setStructuredQuestions(parsedDoc ? parsedDoc.questions : null);
        setStructuredBaseline(parsedDoc ? parsedDoc.questions : null);
        setDocInstructions(parsedDoc ? parsedDoc.instructions : '');
        setDocInstructionsBaseline(parsedDoc ? parsedDoc.instructions : '');
        setStructuredConfig(parsedDoc ? {
          format: parsedDoc.format, topic: parsedDoc.topic, grade: parsedDoc.grade,
          subject: parsedDoc.subject, difficulty: parsedDoc.difficulty,
        } : {});
        setQuestionErrors({});
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError('Could not load this resource.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // Warn before a full-page unload (refresh/close/URL change) with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }, []);

  // Answer-key split for printing: the student version renders only the questions half, and the key never enters the print DOM.
  const isAssessment = form?.type === 'assessment';
  const answerSplit = useMemo(() => splitAnswerKey(form?.content || ''), [form?.content]);
  const hasAnswerKey = !!isAssessment && answerSplit.hasAnswerKey;

  // Fire the print dialog only after the document re-renders in the chosen mode, so a student print can't contain the answer key.
  useEffect(() => {
    if (printReq === 0) return;
    const raf = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(raf);
  }, [printReq]);

  // Fails closed: if "Student version" is requested but no answer-key heading was found, nothing could be hidden (an unrecognized
  // heading may still hold a key), so require explicit confirmation rather than silently printing the full document.
  function startPrint(mode: PrintMode) {
    if (mode === 'student' && isAssessment && !hasAnswerKey) {
      const ok = window.confirm(
        "No answer-key section was detected in this document, so nothing could be hidden — the student version will include everything exactly as shown in Edit. Please check it for answers before printing. Continue?"
      );
      if (!ok) return;
    }
    setPrintMode(mode);
    setPrintMenuOpen(false);
    setPrintReq((n) => n + 1);
  }

  // An assessment always gets the Student / Teacher choice, a deliberate checkpoint even if no answer key was detected (see
  // startPrint). Non-assessments have no split and print directly.
  function onPrintClick() {
    if (isAssessment) setPrintMenuOpen((o) => !o);
    else startPrint('full');
  }

  // Guarded in-app navigation: react-router here isn't a data router, so we confirm on the explicit Back/Cancel controls, not useBlocker.
  function leave(to: string) {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    navigate(to);
  }

  async function handleSave() {
    if (!form || !baseline || !resource || saving) return;
    const cleanTitle = form.title.trim();
    if (!cleanTitle) {
      show('Please enter a title', 'error');
      return;
    }

    const examMetaChanged = JSON.stringify(examMeta) !== JSON.stringify(examMetaBaseline);
    const structuredQuestionsChanged =
      JSON.stringify(structuredQuestions) !== JSON.stringify(structuredBaseline) || docInstructions !== docInstructionsBaseline;

    // Validate before saving: a UX nicety, the server's schema is the authority (docs/generator-v2-plan.md).
    if (structuredQuestions !== null && structuredQuestionsChanged) {
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

    // Send only changed fields (PATCH requires at least one).
    const patch: Record<string, string> = {};
    if (cleanTitle !== baseline.title) patch.title = cleanTitle;
    if (form.type !== baseline.type) patch.type = form.type;
    if (form.grade !== baseline.grade) patch.grade = form.grade.trim();
    if (form.subject !== baseline.subject) patch.subject = form.subject.trim();
    if (form.language !== baseline.language) patch.language = form.language;
    // In structured mode `content` is server-rendered from `structured` on save, never sent, and no textarea renders (docs/generator-v2-plan.md).
    if (structuredQuestions === null && form.content !== baseline.content) patch.content = form.content;

    if (structuredQuestions !== null && (structuredQuestionsChanged || examMetaChanged)) {
      // Always resend the full structured document: the server accepts and re-renders only from the whole `questions` array, and
      // examMeta travels in the same JSON blob (one `structured` column).
      patch.structured = buildStructuredPayload({
        instructions: docInstructions,
        questions: structuredQuestions,
        format: structuredConfig.format as never,
        topic: structuredConfig.topic,
        grade: structuredConfig.grade,
        subject: structuredConfig.subject,
        difficulty: structuredConfig.difficulty as never,
        examMeta,
      });
    } else if (examMetaChanged) {
      patch.structured = mergeExamMeta(resource.structured, examMeta);
    }

    if (Object.keys(patch).length === 0) {
      show('No changes to save', 'info');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateResource(resource.id, patch);
      setResource(updated);
      const f = toForm(updated);
      setForm(f);
      setBaseline(f);
      if ('structured' in patch) {
        setExamMetaBaseline(examMeta);
        if (structuredQuestions !== null) {
          setStructuredBaseline(structuredQuestions);
          setDocInstructionsBaseline(docInstructions);
        }
      }
      show('Changes saved', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not save changes', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action: AiActionId) {
    if (!resource || aiBusy) return;
    if (action === 'adapt_grade' && !adaptGrade) {
      show('Choose a target grade first', 'error');
      return;
    }
    setAiBusy(action);
    try {
      const result = await runAiAction(resource.id, action, { targetGrade: adaptGrade || undefined });
      setSuggestion(result.suggestion);
      setSuggestionStructured(result.structured ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED' && err.retryAt != null) {
        setAiCooldownUntil(err.retryAt);
      } else {
        show(err instanceof ApiError ? err.message : 'AI action failed. Please try again.', 'error');
      }
    } finally {
      setAiBusy(null);
    }
  }

  function applySuggestion() {
    if (suggestion == null) return;
    // For a structured resource the ai-action response also carries an updated `structured` string (docs/generator-v2-plan.md);
    // apply both together so structuredQuestions can't go stale against the shown suggestion. `content` is still set for
    // display/legacy safety; the next Save re-renders it from structured anyway.
    if (structuredQuestions !== null && suggestionStructured) {
      const parsedDoc = parseStructuredDocument(suggestionStructured);
      if (parsedDoc) {
        setStructuredQuestions(parsedDoc.questions);
        setDocInstructions(parsedDoc.instructions);
        setQuestionErrors({});
      }
    }
    setField('content', suggestion);
    setSuggestion(null);
    setSuggestionStructured(null);
    setTab('edit');
    setAdaptOpen(false);
    show('Suggestion applied — review and Save', 'success');
  }

  const isLessonPlan = form?.type === 'lesson_plan';
  const workspaceLabel = isLessonPlan ? 'Lesson Plan Workspace' : 'Resource Workspace';

  return (
    <div className="page workspace-page">
      <TopBar preferences={preferences} />

      {/* Sticky action toolbar (hidden when printing). */}
      <div className="workspace-toolbar no-print">
        <div className="workspace-toolbar-inner">
          <button type="button" className="btn-text workspace-back" onClick={() => leave(id ? `/library/${id}` : '/library')}>
            <ArrowLeft size={16} aria-hidden="true" /> Back
          </button>
          <span className="workspace-toolbar-title">{workspaceLabel}</span>
          <div className="workspace-toolbar-actions">
            <div className="workspace-print-wrap" ref={printMenuRef}>
              <button
                type="button"
                className="btn-text workspace-print"
                onClick={onPrintClick}
                disabled={loading || notFound || !!error}
                aria-haspopup={isAssessment ? 'menu' : undefined}
                aria-expanded={isAssessment ? printMenuOpen : undefined}
              >
                <Printer size={16} aria-hidden="true" /> <span className="workspace-btn-label">Print / Export</span>
                {isAssessment && <ChevronDown size={14} aria-hidden="true" />}
              </button>
              {isAssessment && printMenuOpen && (
                <div className="workspace-print-menu" role="menu">
                  <button type="button" role="menuitem" className="workspace-print-menu-item" onClick={() => startPrint('student')}>
                    Student version
                    <span className="workspace-print-menu-hint">
                      {hasAnswerKey ? 'Questions only — no answers' : 'No answer key detected — asks before printing'}
                    </span>
                  </button>
                  <button type="button" role="menuitem" className="workspace-print-menu-item" onClick={() => startPrint('teacher')}>
                    Teacher version
                    <span className="workspace-print-menu-hint">
                      {hasAnswerKey ? 'Includes answer key' : 'Prints the document as-is'}
                    </span>
                  </button>
                  {/* The browser's printed URL/date header and footer can only be turned off in the print dialog, so tell the teacher where. */}
                  <p className="workspace-print-menu-note">
                    For a clean paper, turn off “Headers and footers” under More&nbsp;settings in the print dialog.
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn-primary workspace-save"
              onClick={handleSave}
              disabled={saving || loading || !dirty}
            >
              {saving ? <Loader2 size={16} aria-hidden="true" className="spin" /> : <Save size={16} aria-hidden="true" />}
              <span className="workspace-btn-label">{saving ? 'Saving…' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>

      <main className="workspace-main no-print">
        {loading && (
          <div className="response-loading"><div className="spinner" /><p>Loading…</p></div>
        )}

        {!loading && notFound && (
          <div className="resource-error">
            <p className="auth-error">This resource no longer exists.</p>
            <button type="button" className="btn-primary" onClick={() => navigate('/library')}>Back to Library</button>
          </div>
        )}

        {!loading && error && !notFound && (
          <div className="resource-error">
            <p className="auth-error">{error}</p>
            <button type="button" className="btn-primary" onClick={() => navigate('/library')}>Back to Library</button>
          </div>
        )}

        {!loading && !error && !notFound && form && resource && (
          <>
            {workspaceTip.visible && (
              <OnboardingTip onDismiss={workspaceTip.dismiss}>
                This is your Workspace — edit the text and details here, then{' '}
                <strong>Save Changes</strong> to keep your edits. Nothing saves automatically.
              </OnboardingTip>
            )}

            <article className="workspace-doc">
              <label className="workspace-title-field">
                <span className="ws-label">Title</span>
                <input
                  type="text"
                  className="workspace-title-input"
                  value={form.title}
                  maxLength={200}
                  onChange={(e) => setField('title', e.target.value)}
                  placeholder="Untitled resource"
                  aria-label="Resource title"
                />
              </label>

              <div className="workspace-meta-row">
                <label className="ws-field">
                  <span className="ws-label">Type</span>
                  <select value={form.type} onChange={(e) => setField('type', e.target.value as ResourceType)}>
                    {RESOURCE_TYPES.map((t) => (
                      <option key={t} value={t}>{RESOURCE_TYPE_META[t].label}</option>
                    ))}
                  </select>
                </label>
                <label className="ws-field">
                  <span className="ws-label">Grade</span>
                  <input
                    type="text"
                    list="ws-grades"
                    value={form.grade}
                    maxLength={80}
                    onChange={(e) => setField('grade', e.target.value)}
                    placeholder="e.g. Class 3-5"
                  />
                </label>
                <label className="ws-field">
                  <span className="ws-label">Subject</span>
                  <input
                    type="text"
                    list="ws-subjects"
                    value={form.subject}
                    maxLength={80}
                    onChange={(e) => setField('subject', e.target.value)}
                    placeholder="e.g. Science"
                  />
                </label>
                <label className="ws-field">
                  <span className="ws-label">Language</span>
                  <select value={form.language} onChange={(e) => setField('language', e.target.value)}>
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </label>
                <datalist id="ws-grades">{GRADES.map((g) => <option key={g} value={g} />)}</datalist>
                <datalist id="ws-subjects">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist>
              </div>

              {isAssessment && <ExamHeaderEditor value={examMeta} onChange={setExamMeta} />}

              <div className="workspace-content">
                <div className="workspace-tabs" role="tablist" aria-label="Editor mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'edit'}
                    className={`workspace-tab${tab === 'edit' ? ' active' : ''}`}
                    onClick={() => setTab('edit')}
                  >
                    <Pencil size={15} aria-hidden="true" /> Edit
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'preview'}
                    className={`workspace-tab${tab === 'preview' ? ' active' : ''}`}
                    onClick={() => setTab('preview')}
                  >
                    <Eye size={15} aria-hidden="true" /> Preview
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
                          onChange={(e) => setDocInstructions(e.target.value)}
                          placeholder="e.g. Answer all questions carefully."
                        />
                      </label>
                      <QuestionListEditor
                        questions={structuredQuestions}
                        editable
                        errors={questionErrors}
                        onChange={(next) => { setStructuredQuestions(next); setQuestionErrors({}); }}
                      />
                    </>
                  ) : (
                    <div className="response-body workspace-preview exam-paper">
                      <ExamHeader meta={examMeta} fallbackTitle={form.title} subject={form.subject} grade={form.grade} />
                      {docInstructions && <p className="question-list-instructions-display">{docInstructions}</p>}
                      <QuestionListEditor questions={structuredQuestions} editable={false} />
                    </div>
                  )
                ) : tab === 'edit' ? (
                  <textarea
                    className="workspace-editor"
                    value={form.content}
                    onChange={(e) => setField('content', e.target.value)}
                    placeholder="Write your lesson plan here…"
                    aria-label="Resource content"
                    spellCheck
                  />
                ) : (
                  <div className={`response-body workspace-preview${isAssessment ? ' exam-paper' : ''}`}>
                    {isAssessment && (
                      <ExamHeader meta={examMeta} fallbackTitle={form.title} subject={form.subject} grade={form.grade} />
                    )}
                    {/* For an assessment the letterhead shows the title/metadata, so the generated preamble is stripped from display (never from stored content). */}
                    <div dangerouslySetInnerHTML={{ __html: formatResponse((isAssessment ? stripAssessmentPreamble(form.content) : form.content) || '_Nothing to preview yet._') }} />
                  </div>
                )}
              </div>

              {/* AI assist. Suggestions never overwrite silently. */}
              <section className="workspace-ai" aria-label="AI assist">
                <h2 className="workspace-ai-title">AI Assist</h2>
                <p className="workspace-ai-hint">Generate a suggested revision — you preview and apply it yourself.</p>
                {aiCooldownUntil != null && !aiCooldownReady && (
                  <p className="workspace-ai-hint" role="alert">{retryMessage(aiCooldownRemainingMs)}</p>
                )}
                {aiAssistTip.visible && (
                  <OnboardingTip icon={Wand2} onDismiss={aiAssistTip.dismiss}>
                    AI Assist won&rsquo;t change your resource until you <strong>Apply</strong> a preview — and
                    applied changes still need <strong>Save Changes</strong> to keep.
                  </OnboardingTip>
                )}
                <div className="workspace-ai-actions">
                  {AI_ACTIONS.filter((a) => !a.assessmentOnly || isAssessment).map((a) => {
                    const Icon = a.icon;
                    const busy = aiBusy === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className="ai-action-btn"
                        disabled={!!aiBusy || (aiCooldownUntil != null && !aiCooldownReady)}
                        onClick={() => (a.needsGrade ? setAdaptOpen((o) => !o) : runAction(a.id))}
                      >
                        {busy ? <Loader2 size={15} aria-hidden="true" className="spin" /> : <Icon size={15} aria-hidden="true" />}
                        {a.label}
                      </button>
                    );
                  })}
                </div>

                {adaptOpen && (
                  <div className="workspace-adapt">
                    <label className="ws-field">
                      <span className="ws-label">Target grade</span>
                      <select value={adaptGrade} onChange={(e) => setAdaptGrade(e.target.value)}>
                        <option value="">Choose a grade…</option>
                        {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!adaptGrade || !!aiBusy}
                      onClick={() => runAction('adapt_grade')}
                    >
                      {aiBusy === 'adapt_grade' ? 'Generating…' : 'Generate'}
                    </button>
                  </div>
                )}
              </section>
            </article>

            {/* AI suggestion preview — explicit Apply / Cancel. */}
            {suggestion != null && (
              <div className="ai-preview-overlay no-print" role="dialog" aria-modal="true" aria-label="AI suggestion preview">
                <div className="ai-preview">
                  <header className="ai-preview-header">
                    <h2>Suggested revision</h2>
                    <button type="button" className="icon-btn" onClick={() => { setSuggestion(null); setSuggestionStructured(null); }} aria-label="Dismiss suggestion">
                      <X size={17} aria-hidden="true" />
                    </button>
                  </header>
                  <p className="ai-preview-note">Review this suggestion. Applying replaces the editor content (not saved until you click Save Changes).</p>
                  <div
                    className="response-body ai-preview-body"
                    dangerouslySetInnerHTML={{ __html: formatResponse(suggestion) }}
                  />
                  <footer className="ai-preview-actions">
                    <button type="button" className="btn-text" onClick={() => { setSuggestion(null); setSuggestionStructured(null); }}>Cancel</button>
                    <button type="button" className="btn-primary" onClick={applySuggestion}>Apply to editor</button>
                  </footer>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Print-only document, rendered from live form state so the teacher can print what they see even before saving. A student
          print of an assessment puts only the questions half in the DOM; the key is never present. An assessment prints as a
          clean exam paper: the ExamHeader letterhead is the header, so the app-document furniture (brand line, title, metadata,
          updated date, version badge) is omitted (it made the export look like a printed webpage) and the generated preamble
          is stripped. Other resource types keep the document-style header. */}
      {form && resource && !loading && !notFound && !error && (() => {
        const rawPrintContent = hasAnswerKey && printMode === 'student' ? answerSplit.questions : form.content || '';
        return isAssessment ? (
          <div className="print-doc print-doc--exam" aria-hidden="true">
            <ExamHeader meta={examMeta} fallbackTitle={form.title} subject={form.subject} grade={form.grade} />
            <div className="response-body print-body" dangerouslySetInnerHTML={{ __html: formatResponse(stripAssessmentPreamble(rawPrintContent)) }} />
          </div>
        ) : (
          <div className="print-doc" aria-hidden="true">
            <div className="print-brand">Teacher Assistant</div>
            <h1 className="print-title">{form.title || 'Untitled resource'}</h1>
            <p className="print-meta">
              {[
                RESOURCE_TYPE_META[form.type].label,
                form.grade && `Grade: ${form.grade}`,
                form.subject && `Subject: ${form.subject}`,
                `Language: ${LANGUAGES.find((l) => l.value === form.language)?.label ?? form.language}`,
              ].filter(Boolean).join('  ·  ')}
            </p>
            <p className="print-date">Updated {formatDate(resource.updatedAt)}</p>
            <hr className="print-rule" />
            <div className="response-body print-body" dangerouslySetInnerHTML={{ __html: formatResponse(rawPrintContent) }} />
          </div>
        );
      })()}
    </div>
  );
}
