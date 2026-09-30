import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Save, RefreshCw, AlertCircle, Check, Sparkles } from 'lucide-react';
import { formatResponse } from '../lib/format';
import { stripAssessmentPreamble } from '../lib/assessment';
import { ARTIFACT_META, artifactTitle } from '../lib/classroom';
import { createResource } from '../lib/resources';
import { useToast } from './Toast';
import { ApiError } from '../api';
import type { ArtifactState } from '../hooks/useClassroomQueue';
import type { ClassroomPlan } from '../types';

// One artifact in a Classroom Mode set: progress, preview and its own Save button.
// Collapsed by default: up to five documents land in a chat thread, and expanded they'd bury the coaching answer and turn a
// phone screen into a dozen.
// Saving is per-card and explicit; nothing writes to the Library on its own, as with the Generator.
// "Saved" survives a reload because the parent looks up what this turn already put in the Library and passes it down as
// `savedResourceId` (component state alone let a reopened set offer to save the same quiz again, with no server de-dupe).

interface ClassroomArtifactCardProps {
  item: ArtifactState;
  plan: ClassroomPlan;
  onRetry: () => void;
  /** The turn this artifact belongs to, recorded on the saved resource so a reopened set can tell what it already saved. */
  queryId?: string;
  /** Id of the Library resource this was already saved as, looked up by the parent. Undefined means "not saved", including while the lookup is in flight (hence the disabled button). */
  savedResourceId?: string;
  /** True until the parent knows what is already saved. */
  checkingSaved?: boolean;
}

export default function ClassroomArtifactCard({
  item,
  plan,
  onRetry,
  queryId,
  savedResourceId,
  checkingSaved = false,
}: ClassroomArtifactCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  // Saves made in this session; the prop covers earlier ones. Either makes the card saved.
  const [locallySavedId, setLocallySavedId] = useState<string | null>(null);
  const savedId = locallySavedId ?? savedResourceId ?? null;
  const { show } = useToast();

  const meta = ARTIFACT_META[item.artifact];

  async function handleSave() {
    if (!item.content || saving || savedId) return;
    setSaving(true);
    try {
      const saved = await createResource({
        // Every question-shaped artifact is an `assessment` (the format lives in `structured`, as the Generator records it), so
        // no new Library types. A lesson plan is the exception: `lesson_plan` already exists in RESOURCE_TYPES with its own
        // handling in ResourceWorkspace (isLessonPlan); saving it as an assessment would send a questionless document through
        // the answer-key split.
        type: item.artifact === 'lesson_plan' ? 'lesson_plan' : 'assessment',
        title: artifactTitle(item.artifact, plan),
        grade: plan.grade || undefined,
        subject: plan.subject || undefined,
        language: plan.language,
        content: item.content,
        structured: JSON.stringify({ format: item.artifact, topic: plan.topic, source: 'classroom_mode' }),
        // Provenance, and the key the "already saved?" lookup matches on; without it a save works but isn't recognised after a reload.
        sourceQueryId: queryId,
      });
      setLocallySavedId(saved.id);
      show('Saved to your library', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  }

  const isReady = item.status === 'ready' && !!item.content;

  return (
    <div className={`classroom-card classroom-card-${item.status}`}>
      <div className="classroom-card-head">
        <button
          type="button"
          className="classroom-card-toggle"
          onClick={() => isReady && setExpanded((e) => !e)}
          disabled={!isReady}
          aria-expanded={isReady ? expanded : undefined}
        >
          <span className="classroom-card-chevron" aria-hidden="true">
            {isReady ? (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="classroom-card-chevron-gap" />}
          </span>
          <span className="classroom-card-title">{meta.label}</span>
          <ClassroomCardStatus status={item.status} />
        </button>

        {isReady && (
          <button
            type="button"
            className="classroom-card-save"
            onClick={handleSave}
            // Also disabled while the parent checks what this turn already saved; pressing Save then is how a duplicate is made.
            disabled={saving || checkingSaved || savedId !== null}
          >
            {savedId ? <Check size={14} aria-hidden="true" /> : saving ? <Loader2 size={14} aria-hidden="true" className="spin" /> : <Save size={14} aria-hidden="true" />}
            {savedId ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        )}

        {item.status === 'failed' && (
          <button type="button" className="classroom-card-save" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        )}

        {/* `stopped` covers both Stop mid-queue and a set restored from history, which deliberately generated nothing. Both
            are "planned, not made", so the label is Generate rather than Retry. */}
        {item.status === 'stopped' && (
          <button type="button" className="classroom-card-save" onClick={onRetry}>
            <Sparkles size={14} aria-hidden="true" /> Generate
          </button>
        )}
      </div>

      {item.status === 'failed' && item.error && (
        <p className="classroom-card-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" /> {item.error}
        </p>
      )}

      {isReady && !expanded && (
        <p className="classroom-card-hint">{meta.hint}</p>
      )}

      {isReady && expanded && (
        <div className="classroom-card-body response-body">
          {/* As in the Generator's preview: the preamble restates the title and metadata the card shows, so it's stripped from display only, never from the saved content. */}
          <div dangerouslySetInnerHTML={{ __html: formatResponse(stripAssessmentPreamble(item.content!) || '') }} />
        </div>
      )}
    </div>
  );
}

// Status as text, not colour alone, like the Generator's AI provenance markers.
function ClassroomCardStatus({ status }: { status: ArtifactState['status'] }) {
  if (status === 'generating') {
    return (
      <span className="classroom-card-status" role="status">
        <Loader2 size={13} aria-hidden="true" className="spin" /> Creating…
      </span>
    );
  }
  if (status === 'waiting') return <span className="classroom-card-status">Queued</span>;
  // No label for `stopped`: the Generate button already says what the card is for, and "Stopped" reads as an error on a restored set never started.
  if (status === 'stopped') return null;
  if (status === 'failed') return <span className="classroom-card-status failed">Failed</span>;
  return <span className="classroom-card-status ready">Ready</span>;
}
