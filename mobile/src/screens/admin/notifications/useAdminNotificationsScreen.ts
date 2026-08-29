// Logic for AdminNotificationsScreen — native port of
// AdminNotificationsPage.tsx's compose/broadcast form state.
import { useState } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { sendNotification } from '../../../api/notifications';
import { ApiError } from '../../../api/client';
import { ADMIN_SENDABLE_NOTIFICATION_TYPES } from '../../../config';
import type { NotificationTarget, NotificationType, Role } from '../../../types';

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 2000;

export function useAdminNotificationsScreen() {
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<NotificationType>(ADMIN_SENDABLE_NOTIFICATION_TYPES[0]);
  const [link, setLink] = useState('');
  const [scope, setScope] = useState<'all' | 'role'>('all');
  const [roles, setRoles] = useState<Role[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState('');

  const reachDescription =
    user?.role === 'super_admin'
      ? 'Every teacher and admin, across every school.'
      : user?.role === 'resource_person'
        ? 'Everyone in every school in your district.'
        : 'Everyone in your school.';

  function toggleRole(role: Role) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  const canSubmit = title.trim().length > 0 && message.trim().length > 0 && (scope === 'all' || roles.length > 0) && !submitting;

  async function submit() {
    if (!canSubmit) return;

    const trimmedLink = link.trim();
    if (trimmedLink && !trimmedLink.startsWith('/')) {
      setSubmitError('Link must be a relative path starting with "/" (e.g. /library/abc123).');
      return;
    }

    const target: NotificationTarget = scope === 'all' ? { scope: 'all' } : { scope: 'role', roles };
    setSubmitError('');
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
      setTitle('');
      setMessage('');
      setLink('');
      setRoles([]);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not send the notification. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return {
    title, setTitle, message, setMessage, type, setType, link, setLink,
    scope, setScope, roles, toggleRole, submitting, lastResult, submitError,
    canSubmit, reachDescription, submit,
    maxTitleLength: MAX_TITLE_LENGTH, maxMessageLength: MAX_MESSAGE_LENGTH,
  };
}
