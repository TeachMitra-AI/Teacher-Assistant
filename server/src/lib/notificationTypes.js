// Closed vocabulary for Notification.type.
// client/src/config.ts's NOTIFICATION_TYPE_META holds the same keys (with icon/label), as with LANGUAGES/GRADES/SUBJECTS
// and lib/roles.js's APP_ROLES. Change both together.
// Admins send only 'announcement' directly (routes/notifications.js); the rest are written by server-side call sites via
// lib/notificationService.js, never from a client-supplied value.
const NOTIFICATION_TYPES = Object.freeze([
  'announcement',
  'lesson_generated',
  'assessment_ready',
  'report_ready',
  'system_update',
  'reminder',
]);

// Types an admin's compose form may send directly; the rest are system/AI-only.
const ADMIN_SENDABLE_TYPES = Object.freeze(['announcement', 'system_update', 'reminder']);

module.exports = { NOTIFICATION_TYPES, ADMIN_SENDABLE_TYPES };
