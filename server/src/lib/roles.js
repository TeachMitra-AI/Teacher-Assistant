// The closed set of application roles, for validating an admin-supplied role list (see
// lib/systemSettings.js's 'assistant-allowed-roles'). It mirrors the same four strings declared in
// routes/admin.js, seed.js and the client (types.ts Role, config.ts ROLE_LABELS, ManagePage.tsx), kept as
// deliberate duplication; this file exists because that validation needs one importable copy.
const APP_ROLES = Object.freeze(['teacher', 'school_admin', 'resource_person', 'super_admin']);

module.exports = { APP_ROLES };
