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
import { getResource, updateResource, runAiAction, type AiActionId } from '../lib/resources';
import { splitAnswerKey, stripAssessmentPreamble } from '../lib/assessment';
import { RESOURCE_TYPES, RESOURCE_TYPE_META, LANGUAGES, GRADES, SUBJECTS } from '../config';
import { ApiError } from '../api';
import type { ExamPaperMeta, LibraryResource, ResourceType } from '../types';

// How the print document should render an assessment.
type PrintMode = 'full' | 'student' | 'teacher';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// The editable slice of a resource the workspace owns. Kept separate from the
// loaded resource so we can diff against a baseline for unsaved-change tracking.
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

// AI assist actions. Each maps to a server-side action id; the server keeps the
// key server-side, never persists the result, and returns a full revised
// document so applying is a simple content replace. `adapt_grade` needs a
// target grade, so it reveals a grade picker before generating.
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

  // Exam-paper letterhead (Phase 3) — kept separate from FormState since it
  // lives inside the opaque `structured` JSON column, not a first-class
  // resource field. A resource that's never had its letterhead customized
  // loads with sensible prefilled values (school/teacher identity + site
  // defaults) rather than a blank one; `examMetaBaseline` is set to the SAME
  // prefilled value so that alone doesn't count as an unsaved change.
  const [examMeta, setExamMeta] = useState<ExamPaperMeta>({});
  const [examMetaBaseline, setExamMetaBaseline] = useState<ExamPaperMeta>({});

  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  // AI assist state.
  const [aiBusy, setAiBusy] = useState<AiActionId | null>(null);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptGrade, setAdaptGrade] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);

  // Print state. `printReq` bumps a counter to trigger window.print() after the
  // print document has re-rendered in the chosen mode (student omits the key).
  const [printMode, setPrintMode] = useState<PrintMode>('full');
  const [printReq, setPrintReq] = useState(0);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const printMenuRef = useRef<HTMLDivElement>(null);
  useDismissable(printMenuOpen, printMenuRef, () => setPrintMenuOpen(false));

  const dirty = useMemo(
    () =>
      (!!form && !!baseline && (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== baseline[k])) ||
      JSON.stringify(examMeta) !== JSON.stringify(examMetaBaseline),
    [form, baseline, examMeta, examMetaBaseline]
  );

  // Load the resource. 404 (missing OR not owned) gets a dedicated state so we
  // never imply another user's resource exists.
  //
  // `userRef` (not `user` itself) is read inside the effect so an unrelated
  // user-object update elsewhere (e.g. Settings saving an unrelated
  // preference) can't re-trigger this effect and blow away any in-progress
  // local edits — only navigating to a different resource id should reload.
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

  // Assessment answer-key split for printing. The student version renders only
  // the questions half — the answer key is never inserted into the print DOM.
  const isAssessment = form?.type === 'assessment';
  const answerSplit = useMemo(() => splitAnswerKey(form?.content || ''), [form?.content]);
  const hasAnswerKey = !!isAssessment && answerSplit.hasAnswerKey;

  // Fire the browser print dialog only after the print document has re-rendered
  // in the chosen mode (so a student print can never contain the answer key).
  useEffect(() => {
    if (printReq === 0) return;
    const raf = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(raf);
  }, [printReq]);

  // Fails closed: if a "Student version" is requested but no answer-key
  // heading was found to split on, nothing could actually be hidden — rather
  // than silently printing the full document (which may still contain an
  // answer key under an unrecognized heading), require an explicit
  // confirmation so the teacher isn't caught off guard.
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

  // For any assessment, always offer the Student / Teacher choice — this is
  // a deliberate checkpoint even when no answer key was detected (see
  // startPrint above), rather than silently printing the full document.
  // Non-assessment resources have no such split and print directly.
  function onPrintClick() {
    if (isAssessment) setPrintMenuOpen((o) => !o);
    else startPrint('full');
  }

  // Guarded in-app navigation — react-router here isn't a data router, so we
  // confirm on the explicit Back/Cancel controls rather than via useBlocker.
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

    // Send only changed fields (PATCH requires at least one).
    const patch: Record<string, string> = {};
    if (cleanTitle !== baseline.title) patch.title = cleanTitle;
    if (form.type !== baseline.type) patch.type = form.type;
    if (form.grade !== baseline.grade) patch.grade = form.grade.trim();
    if (form.subject !== baseline.subject) patch.subject = form.subject.trim();
    if (form.language !== baseline.language) patch.language = form.language;
    if (form.content !== baseline.content) patch.content = form.content;
    if (JSON.stringify(examMeta) !== JSON.stringify(examMetaBaseline)) {
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
      if ('structured' in patch) setExamMetaBaseline(examMeta);
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
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'AI action failed. Please try again.', 'error');
    } finally {
      setAiBusy(null);
    }
  }

  function applySuggestion() {
    if (suggestion == null) return;
    setField('content', suggestion);
    setSuggestion(null);
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
                  {/* The browser's own printed URL/date header and footer can
                      only be turned off inside the print dialog — no web page
                      can disable it — so tell the teacher where the switch is. */}
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

                {tab === 'edit' ? (
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
                    {/* For an assessment the letterhead already presents the
                        title/metadata, so the generated preamble is stripped
                        from display (never from the stored content). */}
                    <div dangerouslySetInnerHTML={{ __html: formatResponse((isAssessment ? stripAssessmentPreamble(form.content) : form.content) || '_Nothing to preview yet._') }} />
                  </div>
                )}
              </div>

              {/* AI assist (Phase 4). Suggestions never overwrite silently. */}
              <section className="workspace-ai" aria-label="AI assist">
                <h2 className="workspace-ai-title">AI Assist</h2>
                <p className="workspace-ai-hint">Generate a suggested revision — you preview and apply it yourself.</p>
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
                        disabled={!!aiBusy}
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
                    <button type="button" className="icon-btn" onClick={() => setSuggestion(null)} aria-label="Dismiss suggestion">
                      <X size={17} aria-hidden="true" />
                    </button>
                  </header>
                  <p className="ai-preview-note">Review this suggestion. Applying replaces the editor content (not saved until you click Save Changes).</p>
                  <div
                    className="response-body ai-preview-body"
                    dangerouslySetInnerHTML={{ __html: formatResponse(suggestion) }}
                  />
                  <footer className="ai-preview-actions">
                    <button type="button" className="btn-text" onClick={() => setSuggestion(null)}>Cancel</button>
                    <button type="button" className="btn-primary" onClick={applySuggestion}>Apply to editor</button>
                  </footer>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Print-only document (Phase 3 + assessment student/teacher versions).
          Rendered from live form state so the teacher can print what they see,
          even before saving. For a student print of an assessment, ONLY the
          questions half is put into the DOM — the answer key is never present.

          An assessment prints as a clean exam paper: the letterhead
          (ExamHeader) IS the paper's header, so none of the app-document
          furniture (brand line, title, metadata row, updated date, version
          badge) is rendered — those made the export look like a printed
          webpage — and the generated Markdown preamble is stripped since the
          letterhead already carries the same information. Other resource
          types keep the original document-style header. */}
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
