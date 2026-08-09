// Admin Settings — runtime override layer on top of existing env-var
// configuration (lib/flags.js). Covers both setting kinds: boolean feature
// flags (Learning Representation) and role-list access controls (Assistant
// allowed roles).
//
// What's under test: the precedence (override row wins; no row falls back to
// the caller's env default; a DB error, or an unparseable row, also falls
// back to the env default, never throws) and the registry-driven helpers the
// admin route and the session-bootstrap responses build on.
const { prisma } = require('../helpers/testApp');
const {
  resolveBoolSetting,
  setBoolSetting,
  resolveRoleListSetting,
  setRoleListSetting,
  listAdminSettings,
  setAdminSetting,
  getEffectiveFeatureFlags,
  ADMIN_SETTINGS_REGISTRY,
  LEARNING_REPRESENTATION_SETTING_KEY,
  ASSISTANT_ALLOWED_ROLES_SETTING_KEY,
} = require('../../src/lib/systemSettings');

const TEST_KEY = 'systemSettingsTest_flag';
const ALL_TEST_KEYS = [TEST_KEY, LEARNING_REPRESENTATION_SETTING_KEY, ASSISTANT_ALLOWED_ROLES_SETTING_KEY];

afterEach(async () => {
  await prisma.systemSetting.deleteMany({ where: { key: { in: ALL_TEST_KEYS } } });
});

describe('resolveBoolSetting', () => {
  test('falls back to the given default when no row exists', async () => {
    expect(await resolveBoolSetting(TEST_KEY, true)).toEqual({ enabled: true, source: 'env-default', updatedAt: null });
    expect(await resolveBoolSetting(TEST_KEY, false)).toEqual({ enabled: false, source: 'env-default', updatedAt: null });
  });

  test('an override row wins over the default, in both directions', async () => {
    await setBoolSetting(TEST_KEY, true, 'tester');
    let resolved = await resolveBoolSetting(TEST_KEY, false);
    expect(resolved.enabled).toBe(true);
    expect(resolved.source).toBe('override');

    await setBoolSetting(TEST_KEY, false, 'tester');
    resolved = await resolveBoolSetting(TEST_KEY, true);
    expect(resolved.enabled).toBe(false);
    expect(resolved.source).toBe('override');
  });

  test('setBoolSetting upserts in place rather than creating a second row', async () => {
    await setBoolSetting(TEST_KEY, true, 'tester');
    await setBoolSetting(TEST_KEY, false, 'tester');
    const rows = await prisma.systemSetting.findMany({ where: { key: TEST_KEY } });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('false');
  });

  test('a DB error while reading falls back to the default rather than throwing', async () => {
    // A direct, manually-restored swap rather than vi.spyOn: Prisma's model
    // delegates (prisma.systemSetting) are Proxy-backed, and vi.spyOn /
    // restoreAllMocks do not reliably restore a property on them — leaving
    // a broken findUnique for the rest of this file if left to that path.
    const original = prisma.systemSetting.findUnique;
    prisma.systemSetting.findUnique = () => Promise.reject(new Error('connection lost'));
    try {
      const resolved = await resolveBoolSetting(TEST_KEY, true);
      expect(resolved).toEqual({ enabled: true, source: 'env-default', updatedAt: null });
    } finally {
      prisma.systemSetting.findUnique = original;
    }
  });
});

describe('resolveRoleListSetting / setRoleListSetting', () => {
  test('falls back to the given default when no row exists', async () => {
    expect(await resolveRoleListSetting(TEST_KEY, ['teacher'])).toEqual({
      roles: ['teacher'],
      source: 'env-default',
      updatedAt: null,
    });
  });

  test('an override row wins over the default, widening it', async () => {
    await setRoleListSetting(TEST_KEY, ['teacher', 'resource_person'], 'tester');
    const resolved = await resolveRoleListSetting(TEST_KEY, ['teacher']);
    expect(resolved.roles.sort()).toEqual(['resource_person', 'teacher']);
    expect(resolved.source).toBe('override');
  });

  test('an override row wins over the default, narrowing it (removing a role the env allowed)', async () => {
    await setRoleListSetting(TEST_KEY, ['school_admin'], 'tester');
    const resolved = await resolveRoleListSetting(TEST_KEY, ['teacher']);
    expect(resolved.roles).toEqual(['school_admin']);
    expect(resolved.roles).not.toContain('teacher');
  });

  test('an explicit empty override is a valid, distinct state — "no role allowed" — not treated as "no override"', async () => {
    await setRoleListSetting(TEST_KEY, [], 'tester');
    const resolved = await resolveRoleListSetting(TEST_KEY, ['teacher']);
    expect(resolved).toEqual({ roles: [], source: 'override', updatedAt: expect.any(Date) });
  });

  test('setRoleListSetting dedupes before persisting', async () => {
    await setRoleListSetting(TEST_KEY, ['teacher', 'teacher', 'school_admin'], 'tester');
    const row = await prisma.systemSetting.findUnique({ where: { key: TEST_KEY } });
    expect(JSON.parse(row.value).sort()).toEqual(['school_admin', 'teacher']);
  });

  test('setRoleListSetting upserts in place rather than creating a second row', async () => {
    await setRoleListSetting(TEST_KEY, ['teacher'], 'tester');
    await setRoleListSetting(TEST_KEY, ['super_admin'], 'tester');
    const rows = await prisma.systemSetting.findMany({ where: { key: TEST_KEY } });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].value)).toEqual(['super_admin']);
  });

  test('a row that is not valid JSON falls back to the default rather than throwing', async () => {
    await prisma.systemSetting.create({ data: { key: TEST_KEY, value: 'not-json', updatedById: 'tester' } });
    const resolved = await resolveRoleListSetting(TEST_KEY, ['teacher']);
    expect(resolved).toEqual({ roles: ['teacher'], source: 'env-default', updatedAt: null });
  });

  test('a row that is valid JSON but not an array falls back to the default rather than throwing', async () => {
    await prisma.systemSetting.create({ data: { key: TEST_KEY, value: JSON.stringify({ not: 'an array' }), updatedById: 'tester' } });
    const resolved = await resolveRoleListSetting(TEST_KEY, ['teacher']);
    expect(resolved).toEqual({ roles: ['teacher'], source: 'env-default', updatedAt: null });
  });

  test('a DB error while reading falls back to the default rather than throwing', async () => {
    const original = prisma.systemSetting.findUnique;
    prisma.systemSetting.findUnique = () => Promise.reject(new Error('connection lost'));
    try {
      const resolved = await resolveRoleListSetting(TEST_KEY, ['teacher']);
      expect(resolved).toEqual({ roles: ['teacher'], source: 'env-default', updatedAt: null });
    } finally {
      prisma.systemSetting.findUnique = original;
    }
  });
});

describe('listAdminSettings / setAdminSetting (registry-driven)', () => {
  test('every registered setting id resolves to a descriptor matching its declared type', async () => {
    const settings = await listAdminSettings();
    const ids = settings.map((s) => s.id);
    expect(ids).toEqual(Object.keys(ADMIN_SETTINGS_REGISTRY));
    for (const setting of settings) {
      expect(typeof setting.label).toBe('string');
      expect(['override', 'env-default']).toContain(setting.source);
      if (setting.type === 'boolean') {
        expect(typeof setting.enabled).toBe('boolean');
      } else if (setting.type === 'role_list') {
        expect(Array.isArray(setting.roles)).toBe(true);
      }
    }
  });

  test('setAdminSetting returns null for an unknown id', async () => {
    expect(await setAdminSetting('not-a-real-setting', true, 'tester')).toBeNull();
  });

  test('setAdminSetting persists a boolean override and the next list reflects it, regardless of the env baseline', async () => {
    const enabled = await setAdminSetting('learning-representation', true, 'tester');
    expect(enabled).toMatchObject({ enabled: true, source: 'override' });
    expect((await listAdminSettings()).find((s) => s.id === 'learning-representation').enabled).toBe(true);

    const disabled = await setAdminSetting('learning-representation', false, 'tester');
    expect(disabled).toMatchObject({ enabled: false, source: 'override' });
    expect((await listAdminSettings()).find((s) => s.id === 'learning-representation').enabled).toBe(false);
  });

  test('setAdminSetting persists a role_list override and the next list reflects it', async () => {
    const updated = await setAdminSetting('assistant-allowed-roles', ['teacher', 'super_admin'], 'tester');
    expect(updated.source).toBe('override');
    expect(updated.roles.sort()).toEqual(['super_admin', 'teacher']);
    expect((await listAdminSettings()).find((s) => s.id === 'assistant-allowed-roles').roles.sort()).toEqual([
      'super_admin', 'teacher',
    ]);
  });
});

describe('getEffectiveFeatureFlags (session-bootstrap shape)', () => {
  test('mirrors the env default when no override exists', async () => {
    const savedEnv = process.env.LEARNING_REPRESENTATION_ENABLED;
    process.env.LEARNING_REPRESENTATION_ENABLED = 'true';
    try {
      expect(await getEffectiveFeatureFlags()).toEqual({ learningRepresentationEnabled: true });
    } finally {
      if (savedEnv === undefined) delete process.env.LEARNING_REPRESENTATION_ENABLED;
      else process.env.LEARNING_REPRESENTATION_ENABLED = savedEnv;
    }
  });

  test('an override beats the env default', async () => {
    const savedEnv = process.env.LEARNING_REPRESENTATION_ENABLED;
    process.env.LEARNING_REPRESENTATION_ENABLED = 'false';
    try {
      await setBoolSetting(LEARNING_REPRESENTATION_SETTING_KEY, true, 'tester');
      expect(await getEffectiveFeatureFlags()).toEqual({ learningRepresentationEnabled: true });
    } finally {
      if (savedEnv === undefined) delete process.env.LEARNING_REPRESENTATION_ENABLED;
      else process.env.LEARNING_REPRESENTATION_ENABLED = savedEnv;
    }
  });

  test('never carries an assistant-roles field — the Assistant has no client-side gate to feed', async () => {
    expect(await getEffectiveFeatureFlags()).not.toHaveProperty('assistantAllowedRoles');
  });
});
