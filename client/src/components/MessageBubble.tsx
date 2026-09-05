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

// How tall the edit textarea may grow before it scrolls internally — same
// ceiling Composer.tsx uses for the same reason (see its comment).
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
  // Live, admin-toggleable value from session bootstrap wins when present;
  // falls back to the build-time env constant otherwise (e.g. featureFlags
  // still null right after mount) — see lib/featureFlags.ts.
  const { featureFlags } = useAuth();
  const learningRepresentationEnabled = resolveFeatureFlag(
    featureFlags?.learningRepresentationEnabled,
    LEARNING_REPRESENTATION_ENABLED
  );
  // No-ops (ready stays true) unless this turn failed because every Gemini
  // API key is currently exhausted (turn.retryAt — see api.ts's ApiError).
  const { remainingMs: retryRemainingMs, ready: retryReady } = useRetryCountdown(turn.retryAt);

  // Editing an already-sent prompt. Local to
  // this bubble — the draft never touches `turn.query` until Save, so Cancel
  // is always just "throw the draft away" and the original text is never at
  // risk. Not offered mid-flight (`status === 'pending'`, same reasoning as
  // the retry guard below) or on an attachment turn, since resubmitting text
  // only would silently drop the file(s) — see runTurnWithAttachments's
  // "single-turn only" comment in CoachPage.
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(turn.query);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Copy the sent prompt — identical pattern to ResponseCard's copy() (Check
  // in place of the icon for a moment, no toast on success). Always offered,
  // regardless of turn status or attachments: unlike Edit, copying the
  // question text has no dependency on either.
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
            {/* Hidden until the row is hovered/focused (opacity-0 by default,
                see .message-user-actions) — mirrors every other "reveal on
                hover" affordance in this app (HistoryItemMenu's three-dot
                button, etc.) rather than sitting permanently next to every
                message. Always visible on touch (@media (hover: none)),
                since there is no hover state to reveal them from. Tooltips
                are a CSS-only `.has-tooltip` + `data-tooltip` pair — no
                native `title`, which is unstyled and inconsistent across
                browsers. */}
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
                  {/* Read-only: no onRemove/onClearAll, so the tray reused from
                      Composer renders plain display chips here — see
                      AttachmentTray's own doc comment for why one component
                      covers both the editable and read-only cases. */}
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
          // `startedAt` is absent only on a turn built before this field
          // existed (a restored one never renders as pending anyway) — fall
          // back to the plain line rather than a timer counting from 1970.
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
            {/* Retrying while every key is still exhausted would just fail
                the same way — the button reappears once retryReady flips
                true (or immediately, for any other kind of error). */}
            {retryReady && (
              <button type="button" className="btn-text retry-btn" onClick={() => onRetry(turn)}>Try again</button>
            )}
            {/* Only offered for a network failure — not for a validation/upstream
                error a teacher can already act on themselves (see the design
                doc's error-integration table). */}
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
            {/* Suppressed for attachment turns: every follow-up resubmits the
                (suffixed/translated) question through plain-text /coach —
                without the original file(s), which Phase 1 never re-sends.
                See docs/multimodal-attachments-architecture.md's "single-turn
                only" limitation. */}
            {/* Classroom Mode ran for this turn but found nothing to make.
                Told, not hidden: the teacher deliberately switched a mode on
                and is entitled to know it looked. Rendered only when the mode
                actually ran — `classroomMode` without `classroom` — so a
                normal chat stays completely silent (see CoachResponse in
                types.ts for why both fields exist). */}
            {turn.response.classroomMode && !turn.response.classroom && (
              <p className="classroom-empty-note">
                <GraduationCap size={14} aria-hidden="true" />
                No classroom materials for this one. Ask about a topic and I&rsquo;ll create them.
              </p>
            )}
            {/* The whole of P3's footprint on the chat path: one conditional
                line. Everything about generating, queuing, previewing and
                saving lives inside ClassroomSet. */}
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
