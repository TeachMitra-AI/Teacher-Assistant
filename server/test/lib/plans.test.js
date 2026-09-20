// Billing (Phase 1) — the plan list and its settings.
//
// Pure functions: the environment is passed in, so nothing here touches
// process.env. The rule under test is the same one every other setting in the
// app follows: a wrong value warns and falls back, it never crashes.

const {
  PLAN_KEYS,
  GRANTABLE_PLAN_KEYS,
  BILLING_CONFIG_DEFAULTS,
  readBillingConfig,
  getPlanDefinition,
} = require('../../src/lib/plans');

function withWarn() {
  const warnings = [];
  return { warn: (m) => warnings.push(m), warnings };
}

describe('plans.readBillingConfig', () => {
  test('an empty environment gives the decided defaults, with no warning', () => {
    const { warn, warnings } = withWarn();
    expect(readBillingConfig({}, { warn })).toEqual({
      graceDays: 3,
      exemptRoles: ['super_admin'],
      basicLimits: { classes: 2, questionsPerMonth: 50, imagesPerMonth: 10, pdfsPerMonth: 5 },
    });
    expect(warnings).toHaveLength(0);
  });

  test('the documented defaults match what is actually returned', () => {
    const config = readBillingConfig({});
    expect(config.graceDays).toBe(BILLING_CONFIG_DEFAULTS.graceDays);
    expect(config.basicLimits.classes).toBe(BILLING_CONFIG_DEFAULTS.basicMaxClasses);
    expect(config.basicLimits.questionsPerMonth).toBe(BILLING_CONFIG_DEFAULTS.basicQuestionsPerMonth);
    expect(config.basicLimits.imagesPerMonth).toBe(BILLING_CONFIG_DEFAULTS.basicImagesPerMonth);
    expect(config.basicLimits.pdfsPerMonth).toBe(BILLING_CONFIG_DEFAULTS.basicPdfsPerMonth);
  });

  test('environment values override the defaults', () => {
    const config = readBillingConfig({
      BILLING_GRACE_DAYS: '5',
      BILLING_BASIC_MAX_CLASSES: '3',
      BILLING_BASIC_QUESTIONS_PER_MONTH: '75',
      BILLING_BASIC_IMAGES_PER_MONTH: '20',
      BILLING_BASIC_PDFS_PER_MONTH: '8',
    });
    expect(config.graceDays).toBe(5);
    expect(config.basicLimits).toEqual({ classes: 3, questionsPerMonth: 75, imagesPerMonth: 20, pdfsPerMonth: 8 });
  });

  test('zero is a valid limit (a feature the free plan does not get)', () => {
    const { warn, warnings } = withWarn();
    expect(readBillingConfig({ BILLING_BASIC_MAX_CLASSES: '0' }, { warn }).basicLimits.classes).toBe(0);
    expect(warnings).toHaveLength(0);
  });

  test('not a number: warns and keeps the default', () => {
    const { warn, warnings } = withWarn();
    const config = readBillingConfig({ BILLING_BASIC_QUESTIONS_PER_MONTH: 'fifty' }, { warn });
    expect(config.basicLimits.questionsPerMonth).toBe(50);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('BILLING_BASIC_QUESTIONS_PER_MONTH');
  });

  test('out of range: warns and clamps', () => {
    const { warn, warnings } = withWarn();
    const config = readBillingConfig({ BILLING_GRACE_DAYS: '999', BILLING_BASIC_MAX_CLASSES: '-4' }, { warn });
    expect(config.graceDays).toBe(30);
    expect(config.basicLimits.classes).toBe(0);
    expect(warnings).toHaveLength(2);
  });

  test('exempt roles: a list is parsed and trimmed', () => {
    const config = readBillingConfig({ BILLING_EXEMPT_ROLES: 'super_admin, school_admin' });
    expect(config.exemptRoles).toEqual(['super_admin', 'school_admin']);
  });

  test('exempt roles: an unknown role is ignored with a warning', () => {
    const { warn, warnings } = withWarn();
    const config = readBillingConfig({ BILLING_EXEMPT_ROLES: 'super_admin,wizard' }, { warn });
    expect(config.exemptRoles).toEqual(['super_admin']);
    expect(warnings.some((w) => w.includes('wizard'))).toBe(true);
  });

  test('exempt roles: a list of only typos falls back to the default, never to nobody', () => {
    const { warn } = withWarn();
    expect(readBillingConfig({ BILLING_EXEMPT_ROLES: 'wizard' }, { warn }).exemptRoles).toEqual(['super_admin']);
  });

  test('the defaults are frozen and the returned lists are copies', () => {
    expect(Object.isFrozen(BILLING_CONFIG_DEFAULTS)).toBe(true);
    const config = readBillingConfig({});
    config.exemptRoles.push('teacher');
    expect(readBillingConfig({}).exemptRoles).toEqual(['super_admin']);
  });
});

describe('plans.getPlanDefinition', () => {
  const config = readBillingConfig({});

  test('the plan keys and the grantable list', () => {
    expect(PLAN_KEYS).toEqual({ BASIC: 'teacher_basic', PRO: 'teacher_pro' });
    // Basic is the absence of a row, so it can never be granted.
    expect(GRANTABLE_PLAN_KEYS).toEqual(['teacher_pro']);
  });

  test('Basic: the free limits, and no Pro-only features', () => {
    expect(getPlanDefinition(PLAN_KEYS.BASIC, config)).toEqual({
      planKey: 'teacher_basic',
      features: { reportDownloads: false, classroomMode: false, lessonPlans: false },
      limits: { classes: 2, questionsPerMonth: 50, imagesPerMonth: 10, pdfsPerMonth: 5 },
    });
  });

  test('Pro: everything unlimited, every feature on', () => {
    expect(getPlanDefinition(PLAN_KEYS.PRO, config)).toEqual({
      planKey: 'teacher_pro',
      features: { reportDownloads: true, classroomMode: true, lessonPlans: true },
      limits: { classes: null, questionsPerMonth: null, imagesPerMonth: null, pdfsPerMonth: null },
    });
  });

  test('an unknown key is treated as Basic, never as Pro', () => {
    expect(getPlanDefinition('platinum', config).planKey).toBe('teacher_basic');
  });

  test('each call returns fresh objects that cannot corrupt a later call', () => {
    const first = getPlanDefinition(PLAN_KEYS.BASIC, config);
    first.limits.classes = 999;
    first.features.classroomMode = true;
    const second = getPlanDefinition(PLAN_KEYS.BASIC, config);
    expect(second.limits.classes).toBe(2);
    expect(second.features.classroomMode).toBe(false);
    expect(config.basicLimits.classes).toBe(2);
  });
});
