// Local dev/test tool: clear Teacher Attendance check-in/out rows without opening Prisma Studio. Not wired into any
// route or job, and unlike tools/pruneAssistantEvents.js it has no retention policy; it resets a developer's sandbox.
// Review rows reference an attendance row by foreign key (TeacherAttendanceReview -> TeacherAttendance), so they
// are cleared first, in the two steps Prisma requires.
// Usage:
//   npm run attendance:clear-test-data                  # today (IST) only
//   npm run attendance:clear-test-data -- --date 2026-08-29
//   npm run attendance:clear-test-data -- --all          # every date
//   npm run attendance:clear-test-data -- --email teacher@example.com   # one teacher, every date (combine with --date to narrow further)
//   npm run attendance:clear-test-data -- --dry-run      # show what would be deleted, delete nothing

const { prisma } = require('../src/lib/db');
const { istDateString } = require('../src/lib/teacherAttendance');

function parseArgs(argv) {
  const args = { date: null, all: false, dryRun: false, email: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--date' && argv[i + 1]) args.date = argv[i + 1];
    if (argv[i] === '--all') args.all = true;
    if (argv[i] === '--dry-run') args.dryRun = true;
    if (argv[i] === '--email' && argv[i + 1]) args.email = argv[i + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // --email alone means "this teacher, every date", since a single teacher's test history is what's being reset. --all
  // means every date whether or not --email narrows it to one teacher.
  const targetDate = args.date || (args.all || args.email ? null : istDateString(new Date()));
  const where = {
    ...(targetDate ? { date: targetDate } : {}),
    ...(args.email ? { user: { email: args.email } } : {}),
  };

  const rows = await prisma.teacherAttendance.findMany({
    where,
    select: { id: true, date: true, user: { select: { name: true, email: true } } },
    orderBy: { date: 'asc' },
  });

  console.log('\nTeacher Attendance — clear local test data');
  console.log('─'.repeat(64));
  console.log(`Scope            ${targetDate ?? 'every date'}${args.email ? `, ${args.email}` : ''}`);
  console.log(`Rows to delete   ${rows.length}`);
  for (const r of rows) console.log(`  ${r.date}  ${r.user.name} (${r.user.email})`);

  if (args.dryRun) {
    console.log('\n--dry-run: nothing deleted.\n');
    return;
  }
  if (rows.length === 0) {
    console.log('\nNothing to clear.\n');
    return;
  }

  const ids = rows.map((r) => r.id);
  const reviews = await prisma.teacherAttendanceReview.deleteMany({ where: { attendanceId: { in: ids } } });
  const { count } = await prisma.teacherAttendance.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nDeleted          ${count} attendance row(s), ${reviews.count} review row(s)\n`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('attendance:clear-test-data failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { parseArgs };
