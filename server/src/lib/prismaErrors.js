// Predicates for Prisma's structured error codes. Routes keep their own try/catch and messages; only the
// repeated `err.code === 'P2002'` / `'P2025'` magic-string checks are shared.
function isUniqueConstraintError(err) {
  return !!err && err.code === 'P2002';
}

function isRecordNotFoundError(err) {
  return !!err && err.code === 'P2025';
}

module.exports = { isUniqueConstraintError, isRecordNotFoundError };
