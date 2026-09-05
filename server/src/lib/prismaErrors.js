// Predicates for Prisma's structured error codes (see
// https://www.prisma.io/docs/orm/reference/error-reference). Route handlers
// keep their own try/catch and their own user-facing message per call site —
// only the repeated `err.code === 'P2002'` / `'P2025'` magic-string checks
// are shared here, the same way lib/asyncHandler.js shares the wrapping
// pattern without dictating what each route does with the error.
function isUniqueConstraintError(err) {
  return !!err && err.code === 'P2002';
}

function isRecordNotFoundError(err) {
  return !!err && err.code === 'P2025';
}

module.exports = { isUniqueConstraintError, isRecordNotFoundError };
