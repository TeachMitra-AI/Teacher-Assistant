const {
  checkInSchema,
  checkOutSchema,
  reviewActionSchema,
  schoolAttendanceConfigSchema,
  createHolidaySchema,
} = require('../../src/lib/teacherAttendanceSchema');

const VALID_EVIDENCE = {
  lat: 12.9716,
  lon: 77.5946,
  accuracyMeters: 25,
  deviceId: 'device-abc-123',
};

describe.each([
  ['checkInSchema', checkInSchema],
  ['checkOutSchema', checkOutSchema],
])('%s', (_name, schema) => {
  test('accepts valid location evidence', () => {
    expect(schema.safeParse(VALID_EVIDENCE).success).toBe(true);
  });

  test('accepts evidence with no deviceId — it is optional', () => {
    const { lat, lon, accuracyMeters } = VALID_EVIDENCE;
    expect(schema.safeParse({ lat, lon, accuracyMeters }).success).toBe(true);
  });

  test('rejects a latitude outside -90..90', () => {
    expect(schema.safeParse({ ...VALID_EVIDENCE, lat: 91 }).success).toBe(false);
    expect(schema.safeParse({ ...VALID_EVIDENCE, lat: -91 }).success).toBe(false);
  });

  test('rejects a longitude outside -180..180', () => {
    expect(schema.safeParse({ ...VALID_EVIDENCE, lon: 181 }).success).toBe(false);
    expect(schema.safeParse({ ...VALID_EVIDENCE, lon: -181 }).success).toBe(false);
  });

  test('rejects a negative accuracy', () => {
    expect(schema.safeParse({ ...VALID_EVIDENCE, accuracyMeters: -1 }).success).toBe(false);
  });

  // The core "server decides, not the client" invariant — this schema has
  // no field for a client-computed verdict, so a caller trying to send one
  // gets rejected by .strict() rather than silently ignored.
  test('rejects a client-supplied verdict field — there is no such field to trust', () => {
    const result = schema.safeParse({ ...VALID_EVIDENCE, insideGeofence: true });
    expect(result.success).toBe(false);
  });

  test('rejects an unknown extra field generally (.strict())', () => {
    expect(schema.safeParse({ ...VALID_EVIDENCE, extra: 'nope' }).success).toBe(false);
  });
});

describe('reviewActionSchema', () => {
  test('accepts a simple approve with a reason', () => {
    const result = reviewActionSchema.safeParse({ action: 'approve', reason: 'Confirmed with the teacher.' });
    expect(result.success).toBe(true);
  });

  test('rejects a blank reason', () => {
    expect(reviewActionSchema.safeParse({ action: 'approve', reason: '' }).success).toBe(false);
  });

  test('rejects a whitespace-only reason', () => {
    expect(reviewActionSchema.safeParse({ action: 'approve', reason: '   ' }).success).toBe(false);
  });

  test('rejects a missing reason entirely', () => {
    expect(reviewActionSchema.safeParse({ action: 'approve' }).success).toBe(false);
  });

  test('rejects an unknown action', () => {
    expect(reviewActionSchema.safeParse({ action: 'do_something_else', reason: 'x' }).success).toBe(false);
  });

  test('correct_checkin requires correctedCheckInAt', () => {
    const withoutTime = reviewActionSchema.safeParse({ action: 'correct_checkin', reason: 'Forgot to tap in.' });
    expect(withoutTime.success).toBe(false);

    const withTime = reviewActionSchema.safeParse({
      action: 'correct_checkin',
      reason: 'Forgot to tap in.',
      correctedCheckInAt: '2026-08-29T03:30:00.000Z',
    });
    expect(withTime.success).toBe(true);
  });

  test('correct_checkout requires correctedCheckOutAt', () => {
    const withoutTime = reviewActionSchema.safeParse({ action: 'correct_checkout', reason: 'Left in a hurry.' });
    expect(withoutTime.success).toBe(false);

    const withTime = reviewActionSchema.safeParse({
      action: 'correct_checkout',
      reason: 'Left in a hurry.',
      correctedCheckOutAt: '2026-08-29T10:30:00.000Z',
    });
    expect(withTime.success).toBe(true);
  });

  test('mark_on_leave and mark_on_duty both require leaveOrDutyCategory', () => {
    expect(reviewActionSchema.safeParse({ action: 'mark_on_leave', reason: 'Medical.' }).success).toBe(false);
    expect(reviewActionSchema.safeParse({ action: 'mark_on_duty', reason: 'Election duty.' }).success).toBe(false);

    expect(
      reviewActionSchema.safeParse({
        action: 'mark_on_leave',
        reason: 'Medical.',
        leaveOrDutyCategory: 'Medical Leave',
      }).success
    ).toBe(true);
  });

  test('reject and approve need no extra fields beyond action + reason', () => {
    expect(reviewActionSchema.safeParse({ action: 'reject', reason: 'Not a valid check-in.' }).success).toBe(true);
  });
});

describe('schoolAttendanceConfigSchema', () => {
  const VALID_CONFIG = {
    openTime: '09:00',
    closeTime: '16:00',
    checkinWindowStart: '08:30',
    checkinWindowEnd: '10:00',
    geofenceLat: 12.9716,
    geofenceLon: 77.5946,
  };

  test('accepts the minimum required fields, with every threshold optional', () => {
    expect(schoolAttendanceConfigSchema.safeParse(VALID_CONFIG).success).toBe(true);
  });

  test('accepts every threshold explicitly set too', () => {
    const result = schoolAttendanceConfigSchema.safeParse({
      ...VALID_CONFIG,
      weeklyOffDays: '0,6',
      lateGraceMinutes: 10,
      halfDayThresholdPercent: 50,
      fullDayGraceMinutes: 15,
      geofenceRadiusMeters: 180,
      repeatPatternThreshold: 3,
      repeatPatternWindowDays: 30,
    });
    expect(result.success).toBe(true);
  });

  test('accepts an empty weeklyOffDays — no weekly off day configured', () => {
    expect(schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, weeklyOffDays: '' }).success).toBe(true);
  });

  test('rejects a malformed weeklyOffDays', () => {
    expect(schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, weeklyOffDays: '7' }).success).toBe(false);
    expect(schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, weeklyOffDays: 'sunday' }).success).toBe(false);
    expect(schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, weeklyOffDays: '0,' }).success).toBe(false);
  });

  test('rejects a malformed time string', () => {
    expect(schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, openTime: '9am' }).success).toBe(false);
    expect(schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, openTime: '24:00' }).success).toBe(false);
  });

  test('rejects a half-day percent outside 1..100', () => {
    expect(schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, halfDayThresholdPercent: 0 }).success).toBe(
      false
    );
    expect(schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, halfDayThresholdPercent: 101 }).success).toBe(
      false
    );
  });

  test('rejects a closing time that is not after opening time — a typo\'d "8:00" instead of "16:00"', () => {
    const result = schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, closeTime: '08:00' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['closeTime']);
  });

  test('rejects closing time exactly equal to opening time too — a zero-length school day', () => {
    expect(schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, closeTime: VALID_CONFIG.openTime }).success).toBe(
      false
    );
  });

  test('rejects a check-in window end that is not after its start', () => {
    const result = schoolAttendanceConfigSchema.safeParse({ ...VALID_CONFIG, checkinWindowEnd: '08:00' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['checkinWindowEnd']);
  });
});

describe('createHolidaySchema', () => {
  test('accepts a valid holiday with a reason', () => {
    const result = createHolidaySchema.safeParse({ date: '2026-10-02', reason: 'Gandhi Jayanti' });
    expect(result.success).toBe(true);
    expect(result.data.source).toBe('principal_emergency');
  });

  test('rejects a malformed date', () => {
    expect(createHolidaySchema.safeParse({ date: '02-10-2026', reason: 'x' }).success).toBe(false);
  });

  test('rejects a blank reason', () => {
    expect(createHolidaySchema.safeParse({ date: '2026-10-02', reason: '' }).success).toBe(false);
  });

  test('rejects a source other than principal_emergency', () => {
    expect(
      createHolidaySchema.safeParse({ date: '2026-10-02', reason: 'x', source: 'department' }).success
    ).toBe(false);
  });
});
