// Milestone M0 — feature flags.
//
// The single most important property under test is that EVERY gate is closed by
// default. A deployment that sets none of these variables must ship a
// completely inert assistant: forgetting to configure the feature can only
// under-enable it, never over-enable it.
//
// The parsing helpers follow lib/config.js's clamp-and-warn philosophy rather
// than fail-fast — a typo in a feature flag must not take the server down, but
// it must be loud.

const {
  parseBoolEnv,
  parseListEnv,
  isFlagEnabled,
  readAssistantFlags,
  ASSISTANT_FLAG_DEFAULTS,
  readHelpSupportFlags,
  HELP_SUPPORT_FLAG_DEFAULTS,
  readLearningRepresentationFlags,
  LEARNING_REPRESENTATION_FLAG_DEFAULTS,
  readClassroomModeFlags,
  CLASSROOM_MODE_FLAG_DEFAULTS,
  readClassroomManagementFlags,
  CLASSROOM_MANAGEMENT_FLAG_DEFAULTS,
} = require('../../src/lib/flags');

function withWarn() {
  const warnings = [];
  return { warn: (m) => warnings.push(m), warnings };
}

const BOOL_OPTS = { name: 'TEST_FLAG', defaultValue: false };

describe('flags.parseBoolEnv', () => {
  test('missing or empty returns the default, with no warning', () => {
    const { warn, warnings } = withWarn();
    expect(parseBoolEnv(undefined, { ...BOOL_OPTS, warn })).toBe(false);
    expect(parseBoolEnv(null, { ...BOOL_OPTS, warn })).toBe(false);
    expect(parseBoolEnv('', { ...BOOL_OPTS, warn })).toBe(false);
    expect(parseBoolEnv('   ', { ...BOOL_OPTS, warn })).toBe(false);
    // Absence is normal — it must not generate log noise on every boot.
    expect(warnings).toHaveLength(0);
  });

  test('missing returns a true default when that is what the caller asked for', () => {
    const { warn } = withWarn();
    expect(parseBoolEnv(undefined, { name: 'T', defaultValue: true, warn })).toBe(true);
  });

  test('recognized true spellings all parse, case- and space-insensitively', () => {
    const { warn, warnings } = withWarn();
    for (const raw of ['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', '  true  ']) {
      expect(parseBoolEnv(raw, { ...BOOL_OPTS, warn }), raw).toBe(true);
    }
    expect(warnings).toHaveLength(0);
  });

  test('recognized false spellings all parse', () => {
    const { warn, warnings } = withWarn();
    for (const raw of ['false', 'FALSE', '0', 'no', 'off', '  off  ']) {
      expect(parseBoolEnv(raw, { name: 'T', defaultValue: true, warn }), raw).toBe(false);
    }
    expect(warnings).toHaveLength(0);
  });

  test('an unrecognized value falls back to the default AND warns', () => {
    const { warn, warnings } = withWarn();
    // The warning is the point: "ASSISTANT_ENABLED=ture" reading as false when
    // the author clearly meant true would otherwise be silent.
    expect(parseBoolEnv('ture', { ...BOOL_OPTS, warn })).toBe(false);
    expect(parseBoolEnv('enabled', { ...BOOL_OPTS, warn })).toBe(false);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/TEST_FLAG/);
  });

  test('an unrecognized value does not flip a true default to false', () => {
    const { warn } = withWarn();
    expect(parseBoolEnv('maybe', { name: 'T', defaultValue: true, warn })).toBe(true);
  });
});

describe('flags.parseListEnv', () => {
  const LIST_OPTS = { name: 'TEST_LIST', defaultValue: ['teacher'] };

  test('missing or empty returns a copy of the default', () => {
    const result = parseListEnv(undefined, LIST_OPTS);
    expect(result).toEqual(['teacher']);
    // A copy, not the shared default array — a caller mutating the result must
    // not corrupt the defaults for every subsequent read.
    result.push('super_admin');
    expect(parseListEnv(undefined, LIST_OPTS)).toEqual(['teacher']);
    expect(ASSISTANT_FLAG_DEFAULTS.allowedRoles).toEqual(['teacher']);
  });

  test('splits on commas and trims entries', () => {
    expect(parseListEnv('teacher,school_admin', LIST_OPTS)).toEqual(['teacher', 'school_admin']);
    expect(parseListEnv(' teacher , school_admin ', LIST_OPTS)).toEqual(['teacher', 'school_admin']);
  });

  test('drops empty entries so a trailing comma is harmless', () => {
    expect(parseListEnv('teacher,,school_admin,', LIST_OPTS)).toEqual(['teacher', 'school_admin']);
  });

  test('a single value parses as a one-entry list', () => {
    expect(parseListEnv('teacher', LIST_OPTS)).toEqual(['teacher']);
  });
});

describe('flags.isFlagEnabled', () => {
  test('an unset per-action flag is OFF', () => {
    const { warn } = withWarn();
    expect(isFlagEnabled({}, 'ASSISTANT_ACTION_GENERATE_ASSESSMENT', { warn })).toBe(false);
  });

  test('an explicitly enabled per-action flag is ON', () => {
    const { warn } = withWarn();
    const env = { ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'true' };
    expect(isFlagEnabled(env, 'ASSISTANT_ACTION_GENERATE_ASSESSMENT', { warn })).toBe(true);
  });

  test('a missing flag name is OFF rather than an error', () => {
    // A descriptor that forgot to declare `featureFlag` must fail closed, not
    // fail open or throw at startup.
    expect(isFlagEnabled({}, undefined)).toBe(false);
    expect(isFlagEnabled({}, '')).toBe(false);
  });
});

describe('flags.readAssistantFlags', () => {
  test('an empty environment produces a completely inert assistant', () => {
    const { warn, warnings } = withWarn();
    const flags = readAssistantFlags({}, { warn });

    // The headline guarantee of this milestone.
    expect(flags.enabled).toBe(false);
    expect(flags.allowedRoles).toEqual(['teacher']);
    expect(flags.allowedSchoolCodes).toEqual([]);
    expect(flags.dailyBudgetPerUser).toBe(100);
    expect(warnings).toHaveLength(0);
  });

  test('the documented defaults match what is actually returned', () => {
    const flags = readAssistantFlags({});
    expect(flags.enabled).toBe(ASSISTANT_FLAG_DEFAULTS.enabled);
    expect(flags.allowedRoles).toEqual([...ASSISTANT_FLAG_DEFAULTS.allowedRoles]);
    expect(flags.allowedSchoolCodes).toEqual([...ASSISTANT_FLAG_DEFAULTS.allowedSchoolCodes]);
    expect(flags.dailyBudgetPerUser).toBe(ASSISTANT_FLAG_DEFAULTS.dailyBudgetPerUser);
  });

  test('an explicitly configured environment is read through', () => {
    const { warn, warnings } = withWarn();
    const flags = readAssistantFlags(
      {
        ASSISTANT_ENABLED: 'true',
        ASSISTANT_ALLOWED_ROLES: 'teacher,school_admin',
        ASSISTANT_ALLOWED_SCHOOL_CODES: 'DPS001, KV002',
        ASSISTANT_DAILY_BUDGET_PER_USER: '250',
      },
      { warn }
    );

    expect(flags.enabled).toBe(true);
    expect(flags.allowedRoles).toEqual(['teacher', 'school_admin']);
    expect(flags.allowedSchoolCodes).toEqual(['DPS001', 'KV002']);
    expect(flags.dailyBudgetPerUser).toBe(250);
    expect(warnings).toHaveLength(0);
  });

  test('an empty school allow-list means "all schools", not "no schools"', () => {
    // It is a filter, not a gate — `enabled` is the gate. Reading it the other
    // way would make an enabled assistant reach nobody.
    expect(readAssistantFlags({}).allowedSchoolCodes).toEqual([]);
    expect(readAssistantFlags({ ASSISTANT_ALLOWED_SCHOOL_CODES: '' }).allowedSchoolCodes).toEqual([]);
  });

  test('a nonsense enable value leaves the assistant OFF and warns', () => {
    const { warn, warnings } = withWarn();
    const flags = readAssistantFlags({ ASSISTANT_ENABLED: 'probably' }, { warn });
    expect(flags.enabled).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ASSISTANT_ENABLED/);
  });

  test('an out-of-range budget clamps rather than crashing', () => {
    const { warn, warnings } = withWarn();
    expect(readAssistantFlags({ ASSISTANT_DAILY_BUDGET_PER_USER: '0' }, { warn }).dailyBudgetPerUser).toBe(1);
    expect(readAssistantFlags({ ASSISTANT_DAILY_BUDGET_PER_USER: '999999999' }, { warn }).dailyBudgetPerUser).toBe(100000);
    expect(readAssistantFlags({ ASSISTANT_DAILY_BUDGET_PER_USER: 'lots' }, { warn }).dailyBudgetPerUser).toBe(100);
    expect(warnings).toHaveLength(3);
  });

  test('reading flags never mutates the frozen defaults', () => {
    const flags = readAssistantFlags({ ASSISTANT_ALLOWED_ROLES: 'super_admin' });
    flags.allowedRoles.push('teacher');
    expect(ASSISTANT_FLAG_DEFAULTS.allowedRoles).toEqual(['teacher']);
    expect(Object.isFrozen(ASSISTANT_FLAG_DEFAULTS)).toBe(true);
  });
});

describe('flags.readHelpSupportFlags', () => {
  test('an empty environment produces a completely inert feature', () => {
    const { warn, warnings } = withWarn();
    const flags = readHelpSupportFlags({}, { warn });

    expect(flags.enabled).toBe(false);
    expect(flags.allowedSchoolCodes).toEqual([]);
    expect(warnings).toHaveLength(0);
  });

  test('the documented defaults match what is actually returned', () => {
    const flags = readHelpSupportFlags({});
    expect(flags.enabled).toBe(HELP_SUPPORT_FLAG_DEFAULTS.enabled);
    expect(flags.allowedSchoolCodes).toEqual([...HELP_SUPPORT_FLAG_DEFAULTS.allowedSchoolCodes]);
  });

  test('an explicitly configured environment is read through', () => {
    const { warn, warnings } = withWarn();
    const flags = readHelpSupportFlags(
      { HELP_SUPPORT_ENABLED: 'true', HELP_SUPPORT_ALLOWED_SCHOOL_CODES: 'DPS001, KV002' },
      { warn }
    );
    expect(flags.enabled).toBe(true);
    expect(flags.allowedSchoolCodes).toEqual(['DPS001', 'KV002']);
    expect(warnings).toHaveLength(0);
  });

  test('an empty school allow-list means "all schools", not "no schools"', () => {
    expect(readHelpSupportFlags({}).allowedSchoolCodes).toEqual([]);
    expect(readHelpSupportFlags({ HELP_SUPPORT_ALLOWED_SCHOOL_CODES: '' }).allowedSchoolCodes).toEqual([]);
  });

  test('a nonsense enable value leaves the feature OFF and warns', () => {
    const { warn, warnings } = withWarn();
    const flags = readHelpSupportFlags({ HELP_SUPPORT_ENABLED: 'probably' }, { warn });
    expect(flags.enabled).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/HELP_SUPPORT_ENABLED/);
  });

  test('reading flags never mutates the frozen defaults', () => {
    const flags = readHelpSupportFlags({ HELP_SUPPORT_ALLOWED_SCHOOL_CODES: 'DPS001' });
    flags.allowedSchoolCodes.push('KV002');
    expect(HELP_SUPPORT_FLAG_DEFAULTS.allowedSchoolCodes).toEqual([]);
    expect(Object.isFrozen(HELP_SUPPORT_FLAG_DEFAULTS)).toBe(true);
  });
});

describe('flags.readLearningRepresentationFlags', () => {
  test('an empty environment produces a completely inert feature', () => {
    const { warn, warnings } = withWarn();
    const flags = readLearningRepresentationFlags({}, { warn });

    expect(flags.enabled).toBe(false);
    expect(flags.allowedSchoolCodes).toEqual([]);
    expect(flags.dailyBudgetPerUser).toBe(50);
    expect(warnings).toHaveLength(0);
  });

  test('the documented defaults match what is actually returned', () => {
    const flags = readLearningRepresentationFlags({});
    expect(flags.enabled).toBe(LEARNING_REPRESENTATION_FLAG_DEFAULTS.enabled);
    expect(flags.allowedSchoolCodes).toEqual([...LEARNING_REPRESENTATION_FLAG_DEFAULTS.allowedSchoolCodes]);
    expect(flags.dailyBudgetPerUser).toBe(LEARNING_REPRESENTATION_FLAG_DEFAULTS.dailyBudgetPerUser);
  });

  test('an explicitly configured environment is read through', () => {
    const { warn, warnings } = withWarn();
    const flags = readLearningRepresentationFlags(
      {
        LEARNING_REPRESENTATION_ENABLED: 'true',
        LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES: 'DPS001, KV002',
        LEARNING_REPRESENTATION_DAILY_BUDGET_PER_USER: '75',
      },
      { warn }
    );

    expect(flags.enabled).toBe(true);
    expect(flags.allowedSchoolCodes).toEqual(['DPS001', 'KV002']);
    expect(flags.dailyBudgetPerUser).toBe(75);
    expect(warnings).toHaveLength(0);
  });

  test('an empty school allow-list means "all schools", not "no schools"', () => {
    expect(readLearningRepresentationFlags({}).allowedSchoolCodes).toEqual([]);
    expect(
      readLearningRepresentationFlags({ LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES: '' }).allowedSchoolCodes
    ).toEqual([]);
  });

  test('a nonsense enable value leaves the feature OFF and warns', () => {
    const { warn, warnings } = withWarn();
    const flags = readLearningRepresentationFlags({ LEARNING_REPRESENTATION_ENABLED: 'probably' }, { warn });
    expect(flags.enabled).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/LEARNING_REPRESENTATION_ENABLED/);
  });

  test('an out-of-range budget clamps rather than crashing', () => {
    const { warn, warnings } = withWarn();
    expect(
      readLearningRepresentationFlags({ LEARNING_REPRESENTATION_DAILY_BUDGET_PER_USER: '0' }, { warn }).dailyBudgetPerUser
    ).toBe(1);
    expect(
      readLearningRepresentationFlags({ LEARNING_REPRESENTATION_DAILY_BUDGET_PER_USER: '999999999' }, { warn })
        .dailyBudgetPerUser
    ).toBe(100000);
    expect(warnings).toHaveLength(2);
  });

  test('reading flags never mutates the frozen defaults', () => {
    const flags = readLearningRepresentationFlags({ LEARNING_REPRESENTATION_ALLOWED_SCHOOL_CODES: 'DPS001' });
    flags.allowedSchoolCodes.push('KV002');
    expect(LEARNING_REPRESENTATION_FLAG_DEFAULTS.allowedSchoolCodes).toEqual([]);
    expect(Object.isFrozen(LEARNING_REPRESENTATION_FLAG_DEFAULTS)).toBe(true);
  });
});

describe('flags.readClassroomModeFlags', () => {
  test('an empty environment produces a completely inert feature', () => {
    const { warn, warnings } = withWarn();
    const flags = readClassroomModeFlags({}, { warn });

    expect(flags.enabled).toBe(false);
    expect(flags.allowedSchoolCodes).toEqual([]);
    expect(warnings).toHaveLength(0);
  });

  test('the documented defaults match what is actually returned', () => {
    const flags = readClassroomModeFlags({});
    expect(flags.enabled).toBe(CLASSROOM_MODE_FLAG_DEFAULTS.enabled);
    expect(flags.allowedSchoolCodes).toEqual([...CLASSROOM_MODE_FLAG_DEFAULTS.allowedSchoolCodes]);
  });

  test('an explicitly configured environment is read through', () => {
    const { warn, warnings } = withWarn();
    const flags = readClassroomModeFlags(
      { CLASSROOM_MODE_ENABLED: 'true', CLASSROOM_MODE_ALLOWED_SCHOOL_CODES: 'DPS001, KV002' },
      { warn }
    );
    expect(flags.enabled).toBe(true);
    expect(flags.allowedSchoolCodes).toEqual(['DPS001', 'KV002']);
    expect(warnings).toHaveLength(0);
  });

  test('an empty school allow-list means "all schools", not "no schools"', () => {
    expect(readClassroomModeFlags({}).allowedSchoolCodes).toEqual([]);
    expect(readClassroomModeFlags({ CLASSROOM_MODE_ALLOWED_SCHOOL_CODES: '' }).allowedSchoolCodes).toEqual([]);
  });

  // This feature is the one place where a single teacher action fans out into
  // several model calls, so a mistyped enable value must fail CLOSED — an
  // accidental "CLASSROOM_MODE_ENABLED=ture" that coerced to true would start
  // spending several times per question with nobody having asked for it.
  test('a nonsense enable value leaves the feature OFF and warns', () => {
    const { warn, warnings } = withWarn();
    const flags = readClassroomModeFlags({ CLASSROOM_MODE_ENABLED: 'probably' }, { warn });
    expect(flags.enabled).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/CLASSROOM_MODE_ENABLED/);
  });

  test('reading flags never mutates the frozen defaults', () => {
    const flags = readClassroomModeFlags({ CLASSROOM_MODE_ALLOWED_SCHOOL_CODES: 'DPS001' });
    flags.allowedSchoolCodes.push('KV002');
    expect(CLASSROOM_MODE_FLAG_DEFAULTS.allowedSchoolCodes).toEqual([]);
    expect(Object.isFrozen(CLASSROOM_MODE_FLAG_DEFAULTS)).toBe(true);
  });
});

describe('flags.readClassroomManagementFlags', () => {
  test('an empty environment produces a completely inert feature', () => {
    const { warn, warnings } = withWarn();
    const flags = readClassroomManagementFlags({}, { warn });

    expect(flags.enabled).toBe(false);
    expect(flags.allowedSchoolCodes).toEqual([]);
    expect(warnings).toHaveLength(0);
  });

  test('the documented defaults match what is actually returned', () => {
    const flags = readClassroomManagementFlags({});
    expect(flags.enabled).toBe(CLASSROOM_MANAGEMENT_FLAG_DEFAULTS.enabled);
    expect(flags.allowedSchoolCodes).toEqual([...CLASSROOM_MANAGEMENT_FLAG_DEFAULTS.allowedSchoolCodes]);
  });

  test('an explicitly configured environment is read through', () => {
    const { warn, warnings } = withWarn();
    const flags = readClassroomManagementFlags(
      { CLASSROOM_MANAGEMENT_ENABLED: 'true', CLASSROOM_MANAGEMENT_ALLOWED_SCHOOL_CODES: 'DPS001, KV002' },
      { warn }
    );
    expect(flags.enabled).toBe(true);
    expect(flags.allowedSchoolCodes).toEqual(['DPS001', 'KV002']);
    expect(warnings).toHaveLength(0);
  });

  test('an empty school allow-list means "all schools", not "no schools"', () => {
    expect(readClassroomManagementFlags({}).allowedSchoolCodes).toEqual([]);
    expect(
      readClassroomManagementFlags({ CLASSROOM_MANAGEMENT_ALLOWED_SCHOOL_CODES: '' }).allowedSchoolCodes
    ).toEqual([]);
  });

  test('a nonsense enable value leaves the feature OFF and warns', () => {
    const { warn, warnings } = withWarn();
    const flags = readClassroomManagementFlags({ CLASSROOM_MANAGEMENT_ENABLED: 'probably' }, { warn });
    expect(flags.enabled).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/CLASSROOM_MANAGEMENT_ENABLED/);
  });

  test('reading flags never mutates the frozen defaults', () => {
    const flags = readClassroomManagementFlags({ CLASSROOM_MANAGEMENT_ALLOWED_SCHOOL_CODES: 'DPS001' });
    flags.allowedSchoolCodes.push('KV002');
    expect(CLASSROOM_MANAGEMENT_FLAG_DEFAULTS.allowedSchoolCodes).toEqual([]);
    expect(Object.isFrozen(CLASSROOM_MANAGEMENT_FLAG_DEFAULTS)).toBe(true);
  });
});
