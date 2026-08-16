import { useState, type FormEvent } from 'react';
import { Loader2, Send } from 'lucide-react';
import TopBar from '../components/TopBar';
import AdminTabs from '../components/AdminTabs';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';
import { sendNotification } from '../lib/notifications';
import { ADMIN_SENDABLE_NOTIFICATION_TYPES, NOTIFICATION_TYPE_META, ROLE_LABELS } from '../config';
import type { NotificationType, NotificationTarget, Role } from '../types';

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 2000;

// Reachable roles for a "specific role" send. Every APP_ROLE, including
// teacher — an admin very often wants "every teacher", not every role.
const TARGET_ROLES: Role[] = ['teacher', 'school_admin', 'resource_person', 'super_admin'];

// Send/broadcast a notification (docs/notification-system-plan.md §2/§6). The
// scope picker below offers only two shapes on purpose:
//   - "Everyone I can reach" — always sends { scope: 'all' }. The backend
//     (lib/notificationService.js's resolveRecipients) clamps this to the
//     CALLER's own reach: truly everyone for super_admin, the caller's
//     district for resource_person, the caller's own school for
//     school_admin. The client never needs to know its own school/district
//     id list for this to be correct.
//   - "Specific role(s)" — { scope: 'role', roles }, ALSO clamped to the
//     caller's own school scope server-side.
// A school-by-school or user-by-user picker is a natural extension (the API
// already supports scope: 'school'/'users' — see routes/notifications.js)
// but is not built here; this page only exposes what a v1 compose screen
// needs. See the extension note at the bottom of this file.
export default function AdminNotificationsPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { user } = useAuth();
  const { show } = useToast();

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<NotificationType>('announcement');
  const [link, setLink] = useState('');
  const [scope, setScope] = useState<'all' | 'role'>('all');
  const [roles, setRoles] = useState<Role[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<number | null>(null);

  const reachDescription =
    user?.role === 'super_admin'
      ? 'Every teacher and admin, across every school.'
      : user?.role === 'resource_person'
        ? 'Everyone in every school in your district.'
        : 'Everyone in your school.';

  function toggleRole(role: Role) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  const canSubmit =
    title.trim().length > 0 &&
    message.trim().length > 0 &&
    (scope === 'all' || roles.length > 0) &&
    !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const target: NotificationTarget = scope === 'all' ? { scope: 'all' } : { scope: 'role', roles };
    const trimmedLink = link.trim();
    if (trimmedLink && !trimmedLink.startsWith('/')) {
      show('Link must be a relative path starting with "/" (e.g. /library/abc123).', 'error');
      return;
    }

    setSubmitting(true);
    setLastResult(null);
    try {
      const result = await sendNotification({
        title: title.trim(),
        message: message.trim(),
        type,
        link: trimmedLink || undefined,
        target,
      });
      setLastResult(result.recipientCount);
      show(`Sent to ${result.recipientCount} recipient${result.recipientCount === 1 ? '' : 's'}.`, 'success');
      setTitle('');
      setMessage('');
      setLink('');
      setRoles([]);
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not send the notification. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main">
        <h1 className="admin-title">Notifications</h1>
        <AdminTabs />

        <section className="settings-card">
          <h2>Send a Notification</h2>
          <p className="settings-hint">
            Delivered instantly to every recipient who is online, and waiting in their notification center either
            way. Enforced on the server — this form can never reach further than your own role allows.
          </p>

          <form onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="notif-title">Title</label>
            <input
              id="notif-title"
              className="text-input"
              maxLength={MAX_TITLE_LENGTH}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Term 2 timetable is now live"
            />

            <label className="field-label" htmlFor="notif-message">Message</label>
            <textarea
              id="notif-message"
              className="text-input"
              rows={4}
              maxLength={MAX_MESSAGE_LENGTH}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What do recipients need to know?"
            />

            <label className="field-label">Type</label>
            <div className="style-grid" role="radiogroup" aria-label="Notification type">
              {ADMIN_SENDABLE_NOTIFICATION_TYPES.map((t) => (
                <button
                  type="button"
                  key={t}
                  className={`style-option${type === t ? ' selected' : ''}`}
                  onClick={() => setType(t)}
                  aria-pressed={type === t}
                >
                  <span className="style-label">{NOTIFICATION_TYPE_META[t].label}</span>
                </button>
              ))}
            </div>

            <label className="field-label" htmlFor="notif-link">Link (optional)</label>
            <input
              id="notif-link"
              className="text-input"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/admin"
            />

            <label className="field-label">Send to</label>
            <div className="style-grid" role="radiogroup" aria-label="Send to">
              <button
                type="button"
                className={`style-option${scope === 'all' ? ' selected' : ''}`}
                onClick={() => setScope('all')}
                aria-pressed={scope === 'all'}
              >
                <span className="style-label">Everyone I can reach</span>
              </button>
              <button
                type="button"
                className={`style-option${scope === 'role' ? ' selected' : ''}`}
                onClick={() => setScope('role')}
                aria-pressed={scope === 'role'}
              >
                <span className="style-label">Specific role(s)</span>
              </button>
            </div>
            <p className="settings-hint">
              {scope === 'all' ? reachDescription : 'Within your own reach, limited to the role(s) you pick below.'}
            </p>

            {scope === 'role' && (
              <div className="role-access-grid">
                {TARGET_ROLES.map((role) => (
                  <label className="role-access-option" key={role}>
                    <input
                      type="checkbox"
                      checked={roles.includes(role)}
                      onChange={() => toggleRole(role)}
                      aria-label={`Send to ${ROLE_LABELS[role]}`}
                    />
                    <span>{ROLE_LABELS[role]}</span>
                  </label>
                ))}
              </div>
            )}

            <button className="btn-primary help-submit" type="submit" disabled={!canSubmit}>
              {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <><Send size={15} aria-hidden="true" /> Send</>}
            </button>

            {lastResult !== null && (
              <p className="settings-hint">Last send reached {lastResult} recipient{lastResult === 1 ? '' : 's'}.</p>
            )}
          </form>
        </section>
      </main>
    </div>
  );
}
