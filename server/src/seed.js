// Seed the database with demo schools and accounts for local testing.
// Run with: npm run seed
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

async function upsertUser({ schoolId, name, role, pin }) {
  const pinHash = await bcrypt.hash(pin, 10);
  return prisma.user.upsert({
    where: { schoolId_name: { schoolId, name } },
    update: { role, pinHash },
    create: { schoolId, name, role, pinHash },
  });
}

async function main() {
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

  const PIN = '123456';

  await upsertUser({ schoolId: rampur1.id, name: 'Super Admin', role: 'super_admin', pin: PIN });
  await upsertUser({ schoolId: rampur1.id, name: 'Rampur Admin', role: 'school_admin', pin: PIN });
  await upsertUser({ schoolId: rampur1.id, name: 'Rampur RP', role: 'resource_person', pin: PIN });
  await upsertUser({ schoolId: rampur1.id, name: 'Demo Teacher', role: 'teacher', pin: PIN });
  await upsertUser({ schoolId: rampur2.id, name: 'Sunita Devi', role: 'teacher', pin: PIN });
  await upsertUser({ schoolId: delhi1.id, name: 'Ravi Kumar', role: 'teacher', pin: PIN });

  console.log('Seed complete.');
  console.log('Schools:', [rampur1.code, rampur2.code, delhi1.code].join(', '));
  console.log(`All demo accounts use PIN ${PIN}.`);
  console.log('Try: school RAMPUR01, name "Demo Teacher", PIN 123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
