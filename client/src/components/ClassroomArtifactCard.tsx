import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Save, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { formatResponse } from '../lib/format';
import { stripAssessmentPreamble } from '../lib/assessment';
import { ARTIFACT_META, artifactTitle } from '../lib/classroom';
import { createResource } from '../lib/resources';
import { useToast } from './Toast';
import { ApiError } from '../api';
import type { ArtifactState } from '../hooks/useClassroomQueue';
import type { ClassroomPlan } from '../types';

// One artifact in a Classroom Mode set: its progress, its preview, and its own
// Save button.
//
// COLLAPSED BY DEFAULT, and that is a requirement rather than a preference
// (D11). Up to five generated documents land in a chat thread; expanded, they
// bury the coaching answer the teacher was actually reading, and on a phone
// they turn one screen into a dozen. Collapsed, the set reads as a short list
// of what is ready.
//
// Saving is per-card and explicit. Nothing here writes to the Library on its
// own — the same rule the Generator follows, for the same reason: AI output
// becomes the teacher's saved work only when the teacher says so.

interface ClassroomArtifactCardProps {
  item: ArtifactState;
  plan: ClassroomPlan;
  onRetry: () => void;
}

export default function ClassroomArtifactCard({ item, plan, onRetry }: ClassroomArtifactCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const { show } = useToast();

  const meta = ARTIFACT_META[item.artifact];

  async function handleSave() {
    if (!item.content || saving || savedId) return;
    setSaving(true);
    try {
      const saved = await createResource({
        // D17: every question-shaped artifact is an `assessment`. No new
        // Library types — the format lives in `structured`, exactly as the
        // Generator records it.
        type: 'assessment',
        title: artifactTitle(item.artifact, plan),
        grade: plan.grade || undefined,
        subject: plan.subject || undefined,
        language: plan.language,
        content: item.content,
        structured: JSON.stringify({ format: item.artifact, topic: plan.topic, source: 'classroom_mode' }),
      });
      setSavedId(saved.id);
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
            disabled={saving || savedId !== null}
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
          {/* Same treatment the Generator's preview gives: the generated
              preamble restates the title and metadata the card already shows,
              so it is stripped from DISPLAY only — never from the content that
              gets saved. */}
          <div dangerouslySetInnerHTML={{ __html: formatResponse(stripAssessmentPreamble(item.content!) || '') }} />
        </div>
      )}
    </div>
  );
}

// Status as TEXT, not colour alone — the same accessibility rule the Generator's
// AI provenance markers follow.
function ClassroomCardStatus({ status }: { status: ArtifactState['status'] }) {
  if (status === 'generating') {
    return (
      <span className="classroom-card-status" role="status">
        <Loader2 size={13} aria-hidden="true" className="spin" /> Creating…
      </span>
    );
  }
  if (status === 'waiting') return <span className="classroom-card-status">Queued</span>;
  if (status === 'stopped') return <span className="classroom-card-status">Stopped</span>;
  if (status === 'failed') return <span className="classroom-card-status failed">Failed</span>;
  return <span className="classroom-card-status ready">Ready</span>;
}
