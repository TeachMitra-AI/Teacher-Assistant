import { GraduationCap } from 'lucide-react';
import ResponseCard from './ResponseCard';
import RunStatus from './RunStatus';
import ClassroomSet from './ClassroomSet';
import FollowUpChips from './FollowUpChips';
import AttachmentTray from './AttachmentTray';
import LearningRepresentationPanel from './LearningRepresentationPanel';
import { useHelpSupport } from './HelpSupport';
import { useAuth } from '../auth';
import { resolveFeatureFlag } from '../lib/featureFlags';
import { HELP_SUPPORT_ENABLED, LEARNING_REPRESENTATION_ENABLED, type FollowUpAction } from '../config';
import type { Turn } from '../types';

interface MessageBubbleProps {
  turn: Turn;
  onFeedback: (turnId: string, rating: 'helpful' | 'not_helpful') => void;
  onFollowUp: (turn: Turn, action: FollowUpAction) => void;
  onRetry: (turn: Turn) => void;
}

export default function MessageBubble({ turn, onFeedback, onFollowUp, onRetry }: MessageBubbleProps) {
  const hasAttachments = !!turn.attachments && turn.attachments.length > 0;
  const { openBugReport } = useHelpSupport();
  // Live, admin-toggleable value from session bootstrap wins when present;
  // falls back to the build-time env constant otherwise (e.g. featureFlags
  // still null right after mount) — see lib/featureFlags.ts.
  const { featureFlags } = useAuth();
  const learningRepresentationEnabled = resolveFeatureFlag(
    featureFlags?.learningRepresentationEnabled,
    LEARNING_REPRESENTATION_ENABLED
  );

  return (
    <div className="message-group">
      <div className="message message-user">
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
            <span aria-hidden="true">⚠️</span> {turn.error}
            <button type="button" className="btn-text retry-btn" onClick={() => onRetry(turn)}>Try again</button>
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
            {!hasAttachments && (
              <FollowUpChips language={turn.response.language} onAction={(action) => onFollowUp(turn, action)} />
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
