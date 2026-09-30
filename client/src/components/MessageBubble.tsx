import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GraduationCap, Pencil, Copy, Check } from 'lucide-react';
import ResponseCard from './ResponseCard';
import RunStatus from './RunStatus';
import ClassroomSet from './ClassroomSet';
import AttachmentTray from './AttachmentTray';
import LearningRepresentationPanel from './LearningRepresentationPanel';
import { useHelpSupport } from './HelpSupport';
import { useToast } from './Toast';
import { useAuth } from '../auth';
import { resolveFeatureFlag } from '../lib/featureFlags';
import { useRetryCountdown } from '../hooks/useRetryCountdown';
import { retryMessage } from '../lib/retryCountdown';
import { HELP_SUPPORT_ENABLED, LEARNING_REPRESENTATION_ENABLED } from '../config';
import type { Turn } from '../types';

// Max height of the edit textarea before it scrolls; the same ceiling as Composer.tsx.
const MAX_EDIT_TEXTAREA_HEIGHT = 200;

interface MessageBubbleProps {
  turn: Turn;
  onFeedback: (turnId: string, rating: 'helpful' | 'not_helpful') => void;
  onRetry: (turn: Turn) => void;
  onEdit: (turnId: string, query: string) => void;
}

export default function MessageBubble({ turn, onFeedback, onRetry, onEdit }: MessageBubbleProps) {
  const hasAttachments = !!turn.attachments && turn.attachments.length > 0;
  const { openBugReport } = useHelpSupport();
  const { show } = useToast();
  // The live admin-toggleable value from session bootstrap wins; otherwise the build-time env constant (e.g. featureFlags
  // is still null right after mount). See lib/featureFlags.ts.
  const { featureFlags } = useAuth();
  const learningRepresentationEnabled = resolveFeatureFlag(
    featureFlags?.learningRepresentationEnabled,
    LEARNING_REPRESENTATION_ENABLED
  );
  // No-op (ready stays true) unless this turn failed because every Gemini API key is exhausted (turn.retryAt).
  const { remainingMs: retryRemainingMs, ready: retryReady } = useRetryCountdown(turn.retryAt);

  // Editing an already-sent prompt, local to this bubble: the draft never touches `turn.query` until Save, so Cancel just
  // discards it. Not offered mid-flight (`status === 'pending'`) or on an attachment turn, since resubmitting text only would
  // drop the file(s) (see runTurnWithAttachments in CoachPage).
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(turn.query);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Copy the sent prompt, like ResponseCard's copy() (a check in place of the icon, no toast). Always offered; unlike Edit it doesn't depend on status or attachments.
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  async function copyQuery() {
    try {
      await navigator.clipboard.writeText(turn.query);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      show('Could not copy', 'error');
    }
  }

  useLayoutEffect(() => {
    const el = editTextareaRef.current;
    if (!isEditing || !el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_EDIT_TEXTAREA_HEIGHT)}px`;
    el.focus();
    el.selectionStart = el.selectionEnd = el.value.length;
  }, [isEditing, draft]);

  function startEdit() {
    setDraft(turn.query);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setIsEditing(false);
    onEdit(turn.id, trimmed);
  }

  const canEdit = turn.status !== 'pending' && !hasAttachments;

  return (
    <div className="message-group">
      <div className="message message-user">
        {isEditing ? (
          <div className="user-edit-box">
            <textarea
              ref={editTextareaRef}
              className="user-edit-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
              }}
              rows={1}
              aria-label="Edit your question"
            />
            <div className="user-edit-actions">
              <button type="button" className="btn-text" onClick={cancelEdit}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveEdit} disabled={!draft.trim()}>Save</button>
            </div>
          </div>
        ) : (
          <>
            {/* Hidden until the row is hovered or focused (see .message-user-actions), like other reveal-on-hover controls
                (e.g. HistoryItemMenu's button), and always visible on touch (@media (hover: none)). Tooltips are the CSS-only
                `.has-tooltip` + `data-tooltip` pair, since native `title` is unstyled and inconsistent. */}
            <div className="message-user-actions">
              <button
                type="button"
                className="message-action-btn has-tooltip"
                onClick={copyQuery}
                aria-label={copied ? 'Copied' : 'Copy message'}
                data-tooltip={copied ? 'Copied' : 'Copy message'}
              >
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="message-action-btn has-tooltip"
                  onClick={startEdit}
                  aria-label="Edit message"
                  data-tooltip="Edit message"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="message-bubble user-bubble">
              {hasAttachments && (
                <div className="user-bubble-attachments">
                  {/* Read-only: with no onRemove/onClearAll the tray shows plain chips (see AttachmentTray). */}
                  <AttachmentTray
                    attachments={turn.attachments!.map((a, i) => ({ id: `${turn.id}-${i}`, name: a.name, kind: a.kind }))}
                  />
                </div>
              )}
              {turn.query}
            </div>
          </>
        )}
      </div>

      <div className="message message-assistant">
        {turn.status === 'pending' && (
          // `startedAt` is absent only on a turn built before the field existed; fall back to the plain line, not a timer counting from 1970.
          turn.startedAt ? (
            <RunStatus startedAt={turn.startedAt} />
          ) : (
            <div className="message-bubble assistant-pending" role="status" aria-live="polite">
              <span className="spinner spinner-sm" aria-hidden="true" />
              Preparing practical advice for you…
            </div>
          )
        )}

        {turn.status === 'error' && (
          <div className="message-bubble assistant-error" role="alert">
            <span aria-hidden="true">⚠️</span> {turn.retryAt != null ? retryMessage(retryRemainingMs) : turn.error}
            {/* Retrying while every key is exhausted would fail the same way; the button returns once retryReady flips (or at once for other errors). */}
            {retryReady && (
              <button type="button" className="btn-text retry-btn" onClick={() => onRetry(turn)}>Try again</button>
            )}
            {/* Only for a network failure, not a validation/upstream error the teacher can act on. */}
            {turn.errorIsNetwork && HELP_SUPPORT_ENABLED && (
              <button
                type="button"
                className="btn-text retry-btn"
                onClick={() => openBugReport({ category: 'connection_issue' })}
              >
                Report
              </button>
            )}
          </div>
        )}

        {turn.status === 'done' && turn.response && (
          <>
            <ResponseCard
              query={turn.query}
              text={turn.response.text}
              language={turn.response.language}
              context={turn.response.context}
              queryId={turn.response.queryId}
              rating={turn.rating}
              onFeedback={(rating) => onFeedback(turn.id, rating)}
            />
            {/* Suppressed for attachment turns: follow-ups resubmit the (suffixed/translated) question as plain text through
                /coach without the original file(s) (docs/multimodal-attachments-architecture.md, "single-turn only"). */}
            {/* Classroom Mode ran but found nothing to make. Told rather than hidden, since the teacher switched a mode on and is
                entitled to know it looked. Only when the mode ran (`classroomMode` without `classroom`); a normal chat stays silent
                (see CoachResponse in types.ts). */}
            {turn.response.classroomMode && !turn.response.classroom && (
              <p className="classroom-empty-note">
                <GraduationCap size={14} aria-hidden="true" />
                No classroom materials for this one. Ask about a topic and I&rsquo;ll create them.
              </p>
            )}
            {/* The chat path's whole footprint for Classroom Mode: one conditional line; generation, queuing, preview and saving live in ClassroomSet. */}
            {turn.response.classroom && (
              <ClassroomSet
                plan={turn.response.classroom}
                restored={turn.restored === true}
                queryId={turn.response.queryId ?? undefined}
              />
            )}
            {learningRepresentationEnabled && (
              <LearningRepresentationPanel query={turn.query} answer={turn.response.text} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
