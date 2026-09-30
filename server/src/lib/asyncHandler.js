// Wraps an async route handler so a rejected promise goes to next(err). Express 4 doesn't do this, and an
// error after an `await` (e.g. a Prisma error) would otherwise crash the process on Node 18+.
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
