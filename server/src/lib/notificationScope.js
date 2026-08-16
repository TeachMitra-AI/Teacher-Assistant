// Who a sender may notify, reusing the EXACT scoping model
// routes/admin.js's schoolScope() already established:
//   super_admin      -> all schools
//   resource_person  -> all schools in the same district as their own school
//   school_admin     -> their own school only
//   teacher          -> nobody (never reaches routes/notifications.js's send
//                       route at all — requireRole rejects it before here)
//
// Duplicated rather than imported from routes/admin.js — that file doesn't
// export the function, and this codebase has a documented precedent for a
// small per-feature helper staying its own copy rather than forcing a shared
// import across features (see routes/adminSupport.js's comment on its own
// parseListQuery/NEWEST_FIRST duplication, and lib/roles.js's APP_ROLES).
// Editing routes/admin.js to export this is a change to a file this feature
// has no need to touch.
const { prisma } = require('./db');

/**
 * Returns an array of school ids in scope for `user`, or null meaning "every
 * school" (super_admin only).
 * @param {{ role: string, schoolId: string }} user
 * @returns {Promise<string[]|null>}
 */
async function schoolScope(user) {
  if (user.role === 'super_admin') return null;
  if (user.role === 'school_admin') return [user.schoolId];
  if (user.role === 'resource_person') {
    const school = await prisma.school.findUnique({ where: { id: user.schoolId } });
    if (!school || !school.district) return [user.schoolId];
    const schools = await prisma.school.findMany({
      where: { district: school.district },
      select: { id: true },
    });
    return schools.map((s) => s.id);
  }
  return [];
}

module.exports = { schoolScope };
