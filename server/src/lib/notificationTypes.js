// Closed vocabulary for Notification.type.
//
// CLIENT COUNTERPART: client/src/config.ts's NOTIFICATION_TYPE_META holds the
// same keys (with icon/label for display). Deliberate, documented duplication
// — same CHANGE-11 convention as LANGUAGES/GRADES/SUBJECTS (see config.ts) and
// lib/roles.js's APP_ROLES. CHANGE BOTH IN THE SAME COMMIT.
//
// 'announcement' is the only type an admin ever sends directly (see
// routes/notifications.js). The rest are system/AI-generated — written by
// lib/notificationService.js call sites elsewhere in the server, never by a
// value the client supplies to POST /api/notifications.
const NOTIFICATION_TYPES = Object.freeze([
  'announcement',
  'lesson_generated',
  'assessment_ready',
  'report_ready',
  'system_update',
  'reminder',
]);

// Types an admin's compose form (POST /api/notifications) may send directly.
// Everything else in NOTIFICATION_TYPES is system/AI-only, produced by a
// server-side call site, never chosen by a client request body.
const ADMIN_SENDABLE_TYPES = Object.freeze(['announcement', 'system_update', 'reminder']);

module.exports = { NOTIFICATION_TYPES, ADMIN_SENDABLE_TYPES };
