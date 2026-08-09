// The closed set of application roles, for validating an admin-supplied role
// list (see lib/systemSettings.js's 'assistant-allowed-roles' setting).
//
// Mirrors — does not replace — the same four strings already inline-declared
// in routes/admin.js (USER_ROLES, and again in its own zod .enum()),
// seed.js, and the client's types.ts Role union / config.ts ROLE_LABELS /
// ManagePage.tsx's ROLES const. This codebase's established convention for a
// closed vocabulary like this one is deliberate duplication over a shared
// import (see config.ts's LANGUAGES/GRADES/SUBJECTS "CHANGE-11" comments) —
// this file exists only because THIS feature's runtime validation needs one
// importable copy, not because the existing copies are wrong.
const APP_ROLES = Object.freeze(['teacher', 'school_admin', 'resource_person', 'super_admin']);

module.exports = { APP_ROLES };
