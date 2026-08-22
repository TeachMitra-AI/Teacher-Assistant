// Seed the database with demo schools and accounts for local testing.
// Run with: npm run seed
//
// Demo accounts are created `active` so they can sign in immediately. Real
// signups go through POST /auth/register and start `pending` until a
// school_admin or super_admin approves them — see server/src/routes/auth.js.
// The addresses below are all @example.com, which is reserved for
// documentation and can never receive real mail.
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { prisma } = require('./lib/db');

async function upsertSchool({ name, code, district, state }) {
  return prisma.school.upsert({
    where: { code },
    update: { name, district, state },
    create: { name, code, district, state },
  });
}

async function upsertUser({ schoolId, name, email, role, password }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { schoolId_email: { schoolId, email } },
    update: { name, role, passwordHash, status: 'active' },
    create: { schoolId, name, email, role, passwordHash, status: 'active' },
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: refusing to seed demo accounts (password "demo1234") against a production database.');
    process.exit(1);
  }

  const rampur1 = await upsertSchool({
    name: 'Govt Primary School, Rampur',
    code: 'RAMPUR01',
    district: 'Rampur',
    state: 'Uttar Pradesh',
  });
  const rampur2 = await upsertSchool({
    name: 'Govt Upper Primary School, Rampur',
    code: 'RAMPUR02',
    district: 'Rampur',
    state: 'Uttar Pradesh',
  });
  const delhi1 = await upsertSchool({
    name: 'Govt School, New Delhi',
    code: 'DELHI01',
    district: 'New Delhi',
    state: 'Delhi',
  });

  const PASSWORD = 'demo1234';

  await upsertUser({ schoolId: rampur1.id, name: 'Super Admin', email: 'superadmin@example.com', role: 'super_admin', password: PASSWORD });
  await upsertUser({ schoolId: rampur1.id, name: 'Rampur Admin', email: 'admin.rampur01@example.com', role: 'school_admin', password: PASSWORD });
  await upsertUser({ schoolId: rampur1.id, name: 'Rampur RP', email: 'rp.rampur01@example.com', role: 'resource_person', password: PASSWORD });
  await upsertUser({ schoolId: rampur1.id, name: 'Demo Teacher', email: 'teacher@example.com', role: 'teacher', password: PASSWORD });
  await upsertUser({ schoolId: rampur2.id, name: 'Sunita Devi', email: 'sunita@example.com', role: 'teacher', password: PASSWORD });
  await upsertUser({ schoolId: delhi1.id, name: 'Ravi Kumar', email: 'ravi@example.com', role: 'teacher', password: PASSWORD });

  console.log('Seed complete.');
  console.log('Schools:', [rampur1.code, rampur2.code, delhi1.code].join(', '));
  console.log(`All demo accounts use password "${PASSWORD}".`);
  console.log(`Try signing in with teacher@example.com / ${PASSWORD} — no school code needed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
