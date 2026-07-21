// Wraps an async Express route handler so a rejected promise is forwarded to
// next(err) instead of becoming an unhandled promise rejection. Express 4
// does not do this automatically for async handlers — without this wrapper,
// an error thrown after an `await` (e.g. a Prisma/database error) crashes
// the whole process on Node 18+, which defaults to terminating on unhandled
// rejections.
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
