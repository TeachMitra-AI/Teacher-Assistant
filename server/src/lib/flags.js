// Feature-flag parsing. The helpers are pure (the caller passes the raw env string), and an invalid value falls back
// to a safe default with a warning rather than crashing; fail-fast is for required secrets only.
// Every flag defaults OFF, so forgetting to configure a feature can only under-enable it.
// The client is a PWA with service-worker caching, so a client-side flag changes on some later page load. The
// server-side flags (e.g. ASSISTANT_ENABLED) are therefore the only reliable incident controls.

const { parseIntEnv } = require('./config');

// Accepted spellings. Anything else non-empty is treated as a typo: it warns and uses the default rather than
// being coerced, so "ASSISTANT_ENABLED=ture" surfaces instead of silently reading as false.
const TRUE_VALUES = ['true', '1', 'yes', 'on'];
const FALSE_VALUES = ['false', '0', 'no', 'off'];

/**
 * Parse an environment variable as a boolean: missing/empty gives the default (no warning),
 * a recognized spelling gives its value, anything else gives the default plus a warning.
 *
 * @param {string|undefined} rawValue the raw env string
 * @param {object} opts
 * @param {string} opts.name env var name, for warning messages
 * @param {boolean} opts.defaultValue
 * @param {(msg: string) => void} [opts.warn=console.warn]
 * @returns {boolean}
 */
function parseBoolEnv(rawValue, { name, defaultValue, warn = console.warn }) {
  if (rawValue == null || String(rawValue).trim() === '') {
    return defaultValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (TRUE_VALUES.includes(normalized)) return true;
  if (FALSE_VALUES.includes(normalized)) return false;

  warn(
    `[flags] ${name}="${rawValue}" is not a recognized boolean ` +
      `(${TRUE_VALUES.join('/')} or ${FALSE_VALUES.join('/')}); using default ${defaultValue}.`
  );
  return defaultValue;
}

/**
 * Parse an environment variable as a comma-separated list; entries are trimmed and empties dropped.
 * Unset and explicitly empty both yield the default; for allow-lists, an empty list means "no restriction".
 *
 * @param {string|undefined} rawValue
 * @param {object} opts
 * @param {string} opts.name
 * @param {string[]} opts.defaultValue
 * @returns {string[]}
 */
function parseListEnv(rawValue, { name: _name, defaultValue }) {
  if (rawValue == null || String(rawValue).trim() === '') {
    return [...defaultValue];
  }
  return String(rawValue)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Is a single named flag on? Each action descriptor names its own env var in `featureFlag`, so this
 * needs no knowledge of the registry. Defaults to false.
 *
 * @param {Record<string, string|undefined>} env
 * @param {string} flagName
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {boolean}
 */
function isFlagEnabled(env, flagName, { warn = console.warn } = {}) {
  if (!flagName) return false;
  return parseBoolEnv(env[flagName], { name: flagName, defaultValue: false, warn });
}

// Defaults live in one place so .env.example and the tests can be checked against them.
const ASSISTANT_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  // Which roles may use the assistant at all. Coarse rollout control that
  // reuses the roles the app already has, rather than new infrastructure.
  allowedRoles: Object.freeze(['teacher']),
  // Tenant rollout by school code. EMPTY MEANS ALL SCHOOLS — it is a filter,
  // not a gate, and `enabled` is the gate.
  allowedSchoolCodes: Object.freeze([]),
  // Interpret calls per user per day. Bounds a single account's cost.
  dailyBudgetPerUser: 100,
});

const DAILY_BUDGET_BOUNDS = Object.freeze({ min: 1, max: 100000 });

/**
 * Read the assistant's global flags from an env object (passed in, not process.env, to stay pure).
 * Per-action flags are read by isFlagEnabled.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedRoles: string[], allowedSchoolCodes: string[], dailyBudgetPerUser: number}}
 */
function readAssistantFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.ASSISTANT_ENABLED, {
      name: 'ASSISTANT_ENABLED',
      defaultValue: ASSISTANT_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedRoles: parseListEnv(env.ASSISTANT_ALLOWED_ROLES, {
      name: 'ASSISTANT_ALLOWED_ROLES',
      defaultValue: ASSISTANT_FLAG_DEFAULTS.allowedRoles,
    }),
    allowedSchoolCodes: parseListEnv(env.ASSISTANT_ALLOWED_SCHOOL_CODES, {
      name: 'ASSISTANT_ALLOWED_SCHOOL_CODES',
      defaultValue: ASSISTANT_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
    dailyBudgetPerUser: parseIntEnv(env.ASSISTANT_DAILY_BUDGET_PER_USER, {
      name: 'ASSISTANT_DAILY_BUDGET_PER_USER',
      defaultValue: ASSISTANT_FLAG_DEFAULTS.dailyBudgetPerUser,
      min: DAILY_BUDGET_BOUNDS.min,
      max: DAILY_BUDGET_BOUNDS.max,
      warn,
    }),
  };
}

// Multimodal attachments. Same defaults as above; ATTACHMENTS_ENABLED is the reliable kill switch and
// the school allow-list is a filter, not a gate.

const ATTACHMENT_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  allowedSchoolCodes: Object.freeze([]),
  // Attachments are the most expensive call in the product, so the daily ceiling is lower than the router's.
  dailyBudgetPerUser: 20,
  maxFileSizeMb: 8,
  maxPdfPages: 30,
  // Batch limits. maxTotalSizeMb is a separate guard from maxFileSizeMb x maxFiles (see
  // validateAttachmentBatch): 15MB raw stays under Gemini's ~20MB inline ceiling after ~33% base64 overhead.
  maxFiles: 5,
  maxTotalSizeMb: 15,
});

const ATTACHMENT_BUDGET_BOUNDS = Object.freeze({ min: 1, max: 100000 });
const ATTACHMENT_FILE_SIZE_BOUNDS = Object.freeze({ min: 1, max: 20 });
const ATTACHMENT_PDF_PAGES_BOUNDS = Object.freeze({ min: 1, max: 500 });
const ATTACHMENT_MAX_FILES_BOUNDS = Object.freeze({ min: 1, max: 10 });
const ATTACHMENT_TOTAL_SIZE_BOUNDS = Object.freeze({ min: 1, max: 40 });

/**
 * Read the attachment feature's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{
 *   enabled: boolean,
 *   allowedSchoolCodes: string[],
 *   dailyBudgetPerUser: number,
 *   maxFileSizeMb: number,
 *   maxPdfPages: number,
 *   maxFiles: number,
 *   maxTotalSizeMb: number,
 * }}
 */
function readAttachmentFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.ATTACHMENTS_ENABLED, {
      name: 'ATTACHMENTS_ENABLED',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.ATTACHMENT_ALLOWED_SCHOOL_CODES, {
      name: 'ATTACHMENT_ALLOWED_SCHOOL_CODES',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
    dailyBudgetPerUser: parseIntEnv(env.ATTACHMENT_DAILY_BUDGET_PER_USER, {
      name: 'ATTACHMENT_DAILY_BUDGET_PER_USER',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.dailyBudgetPerUser,
      min: ATTACHMENT_BUDGET_BOUNDS.min,
      max: ATTACHMENT_BUDGET_BOUNDS.max,
      warn,
    }),
    maxFileSizeMb: parseIntEnv(env.ATTACHMENT_MAX_FILE_SIZE_MB, {
      name: 'ATTACHMENT_MAX_FILE_SIZE_MB',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.maxFileSizeMb,
      min: ATTACHMENT_FILE_SIZE_BOUNDS.min,
      max: ATTACHMENT_FILE_SIZE_BOUNDS.max,
      warn,
    }),
    maxPdfPages: parseIntEnv(env.ATTACHMENT_MAX_PDF_PAGES, {
      name: 'ATTACHMENT_MAX_PDF_PAGES',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.maxPdfPages,
      min: ATTACHMENT_PDF_PAGES_BOUNDS.min,
      max: ATTACHMENT_PDF_PAGES_BOUNDS.max,
      warn,
    }),
    maxFiles: parseIntEnv(env.ATTACHMENT_MAX_FILES, {
      name: 'ATTACHMENT_MAX_FILES',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.maxFiles,
      min: ATTACHMENT_MAX_FILES_BOUNDS.min,
      max: ATTACHMENT_MAX_FILES_BOUNDS.max,
      warn,
    }),
    maxTotalSizeMb: parseIntEnv(env.ATTACHMENT_MAX_TOTAL_SIZE_MB, {
      name: 'ATTACHMENT_MAX_TOTAL_SIZE_MB',
      defaultValue: ATTACHMENT_FLAG_DEFAULTS.maxTotalSizeMb,
      min: ATTACHMENT_TOTAL_SIZE_BOUNDS.min,
      max: ATTACHMENT_TOTAL_SIZE_BOUNDS.max,
      warn,
    }),
  };
}

// Help & Support. Makes no LLM call, so there's no daily budget; the shared per-IP limiter bounds abuse.

const HELP_SUPPORT_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  // Tenant rollout by school code, same "empty means all schools" contract as
  // ATTACHMENT_FLAG_DEFAULTS.allowedSchoolCodes above — a filter, not a gate.
  allowedSchoolCodes: Object.freeze([]),
});

/**
 * Read the Help & Support feature's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedSchoolCodes: string[]}}
 */
function readHelpSupportFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.HELP_SUPPORT_ENABLED, {
      name: 'HELP_SUPPORT_ENABLED',
      defaultValue: HELP_SUPPORT_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.HELP_SUPPORT_ALLOWED_SCHOOL_CODES, {
      name: 'HELP_SUPPORT_ALLOWED_SCHOOL_CODES',
      defaultValue: HELP_SUPPORT_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
  };
}

// AI Learning Representation. Up to two Gemini calls per request (classify, then render), so the default
// daily ceiling sits between the assistant's and the attachments'. No `allowedRoles`, matching /api/coach.

const LEARNING_REPRESENTATION_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  allowedSchoolCodes: Object.freeze([]),
  dailyBudgetPerUser: 50,
});

const LEARNING_REPRESENTATION_BUDGET_BOUNDS = Object.freeze({ min: 1, max: 100000 });

/**
 * Read the AI Learning Representation feature's global flags from an
 * environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedSchoolCodes: string[], dailyBudgetPerUser: number}}
 */
function readLearningRepresentationFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.LEARNING_REPRESENTATION_ENABLED, {
      name: 'LEARNING_REPRESENTATION_ENABLED',
      defaultValue: LEARNING_REPRESENTATION_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES, {
      name: 'LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES',
      defaultValue: LEARNING_REPRESENTATION_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
    dailyBudgetPerUser: parseIntEnv(env.LEARNING_REPRESENTATION_DAILY_BUDGET_PER_USER, {
      name: 'LEARNING_REPRESENTATION_DAILY_BUDGET_PER_USER',
      defaultValue: LEARNING_REPRESENTATION_FLAG_DEFAULTS.dailyBudgetPerUser,
      min: LEARNING_REPRESENTATION_BUDGET_BOUNDS.min,
      max: LEARNING_REPRESENTATION_BUDGET_BOUNDS.max,
      warn,
    }),
  };
}

// Classroom Mode (docs/classroom-mode.md). One teacher action costs several model calls, so
// CLASSROOM_MODE_ENABLED is a spend control as well as the kill switch; VITE_CLASSROOM_MODE_ENABLED only
// decides whether the "+" button renders. No daily budget yet: the pilot is uncapped with usage measured first,
// and allowedSchoolCodes bounds exposure.

const CLASSROOM_MODE_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  // Tenant rollout by school code, same "empty means all schools" contract as
  // ATTACHMENT_FLAG_DEFAULTS.allowedSchoolCodes — a filter, not a gate.
  allowedSchoolCodes: Object.freeze([]),
});

/**
 * Read Classroom Mode's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedSchoolCodes: string[]}}
 */
function readClassroomModeFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.CLASSROOM_MODE_ENABLED, {
      name: 'CLASSROOM_MODE_ENABLED',
      defaultValue: CLASSROOM_MODE_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.CLASSROOM_MODE_ALLOWED_SCHOOL_CODES, {
      name: 'CLASSROOM_MODE_ALLOWED_SCHOOL_CODES',
      defaultValue: CLASSROOM_MODE_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
  };
}

// Notifications. NOTIFICATIONS_ENABLED gates both the REST routes (routes/notifications.js) and the
// Socket.IO handshake (lib/socketServer.js); VITE_NOTIFICATIONS_ENABLED only decides whether the bell renders.

const NOTIFICATIONS_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
});

/**
 * Read the Notifications feature's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean}}
 */
function readNotificationsFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.NOTIFICATIONS_ENABLED, {
      name: 'NOTIFICATIONS_ENABLED',
      defaultValue: NOTIFICATIONS_FLAG_DEFAULTS.enabled,
      warn,
    }),
  };
}

// Classroom Management (docs/classroom-feature-plan.md), the class/student/attendance/fee workspace. Not
// Classroom Mode above (an AI chat feature); the env var names are kept distinct.
// Master kill switch: when false every /api/classroom/* route returns 503 and touches no table.
// No LLM call, so no daily budget; the school-code filter (empty = all schools) and classroomLimiter bound it.

const CLASSROOM_MANAGEMENT_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  allowedSchoolCodes: Object.freeze([]),
});

/**
 * Read Classroom Management's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedSchoolCodes: string[]}}
 */
function readClassroomManagementFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.CLASSROOM_MANAGEMENT_ENABLED, {
      name: 'CLASSROOM_MANAGEMENT_ENABLED',
      defaultValue: CLASSROOM_MANAGEMENT_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.CLASSROOM_MANAGEMENT_ALLOWED_SCHOOL_CODES, {
      name: 'CLASSROOM_MANAGEMENT_ALLOWED_SCHOOL_CODES',
      defaultValue: CLASSROOM_MANAGEMENT_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
  };
}

// Structured Question Model (docs/generator-v2-plan.md). One master switch, no allow-list yet. It gates only
// the three new question types (descriptive/fill_blank/match) and the structured-questions re-render rule in
// routes/resources.js; the existing types are never gated.

const STRUCTURED_QUESTIONS_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
});

/**
 * Read the Structured Question Model feature's global flags from an
 * environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean}}
 */
function readStructuredQuestionsFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.STRUCTURED_QUESTIONS_ENABLED, {
      name: 'STRUCTURED_QUESTIONS_ENABLED',
      defaultValue: STRUCTURED_QUESTIONS_FLAG_DEFAULTS.enabled,
      warn,
    }),
  };
}

// Mobile push. A separate gate layered on NOTIFICATIONS_ENABLED: that one controls whether a notification is
// created at all, this one controls only the extra Expo push dispatch and the device-token routes
// (routes/notifications.js). That lets push be switched independently of in-app notifications.

const MOBILE_PUSH_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
});

/**
 * Read the Mobile Push feature's global flags from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean}}
 */
function readMobilePushFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.MOBILE_PUSH_ENABLED, {
      name: 'MOBILE_PUSH_ENABLED',
      defaultValue: MOBILE_PUSH_FLAG_DEFAULTS.enabled,
      warn,
    }),
  };
}

// Teacher Attendance (docs/feature-teacher-attendance-implementation-plan.md). Master kill switch: when false
// every /api/teacher-attendance/* route returns 503 and touches no table. A separate env var from Classroom
// Management, which is student attendance. No LLM call, so no daily budget; the school-code filter bounds rollout.

const TEACHER_ATTENDANCE_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
  allowedSchoolCodes: Object.freeze([]),
});

/**
 * Read the Teacher Attendance feature's global flags from an environment
 * object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean, allowedSchoolCodes: string[]}}
 */
function readTeacherAttendanceFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.TEACHER_ATTENDANCE_ENABLED, {
      name: 'TEACHER_ATTENDANCE_ENABLED',
      defaultValue: TEACHER_ATTENDANCE_FLAG_DEFAULTS.enabled,
      warn,
    }),
    allowedSchoolCodes: parseListEnv(env.TEACHER_ATTENDANCE_ALLOWED_SCHOOL_CODES, {
      name: 'TEACHER_ATTENDANCE_ALLOWED_SCHOOL_CODES',
      defaultValue: TEACHER_ATTENDANCE_FLAG_DEFAULTS.allowedSchoolCodes,
    }),
  };
}

// Schedule a Call (demo booking). Master kill switch: when false every /api/schedule-demo/* route returns 503
// and touches no table. No allowedSchoolCodes, since visitors haven't signed up. Availability settings
// (timezone, hours, slot length) are configuration and live in lib/demoBookingConfig.js.

const DEMO_BOOKING_FLAG_DEFAULTS = Object.freeze({
  enabled: false,
});

/**
 * Read the Schedule a Call feature's global flag from an environment object.
 * @param {Record<string, string|undefined>} env
 * @param {{warn?: (msg: string) => void}} [opts]
 * @returns {{enabled: boolean}}
 */
function readDemoBookingFlags(env, { warn = console.warn } = {}) {
  return {
    enabled: parseBoolEnv(env.DEMO_BOOKING_ENABLED, {
      name: 'DEMO_BOOKING_ENABLED',
      defaultValue: DEMO_BOOKING_FLAG_DEFAULTS.enabled,
      warn,
    }),
  };
}

module.exports = {
  parseBoolEnv,
  parseListEnv,
  isFlagEnabled,
  readDemoBookingFlags,
  DEMO_BOOKING_FLAG_DEFAULTS,
  readAssistantFlags,
  ASSISTANT_FLAG_DEFAULTS,
  readAttachmentFlags,
  ATTACHMENT_FLAG_DEFAULTS,
  readHelpSupportFlags,
  HELP_SUPPORT_FLAG_DEFAULTS,
  readLearningRepresentationFlags,
  LEARNING_REPRESENTATION_FLAG_DEFAULTS,
  readClassroomModeFlags,
  CLASSROOM_MODE_FLAG_DEFAULTS,
  readNotificationsFlags,
  NOTIFICATIONS_FLAG_DEFAULTS,
  readClassroomManagementFlags,
  CLASSROOM_MANAGEMENT_FLAG_DEFAULTS,
  readStructuredQuestionsFlags,
  STRUCTURED_QUESTIONS_FLAG_DEFAULTS,
  readMobilePushFlags,
  MOBILE_PUSH_FLAG_DEFAULTS,
  readTeacherAttendanceFlags,
  TEACHER_ATTENDANCE_FLAG_DEFAULTS,
};
