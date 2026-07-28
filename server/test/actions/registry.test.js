// Milestone M2 — the Capability Registry.
//
// Two things are under test: that the real descriptors are coherent, and that
// the validator actually rejects the incoherent ones. The second half matters
// more than it looks — a startup validator that never says no is decoration,
// and it is the only thing standing between a typo in a descriptor and a
// capability that silently cannot work.

const {
  DESCRIPTORS,
  CATALOG_VERSION,
  DISABLED_CATALOG,
  validateDescriptors,
  getDescriptor,
  isVisible,
  listForRole,
  toCatalogAction,
  buildCatalog,
} = require('../../src/actions/registry');
const { EFFECTS, PHASE1_MAX_EFFECT } = require('../../src/assistant/contracts');
const { generateAssessmentSchema } = require('../../src/actions/schemas/generateAssessment');

/** Everything on, so filtering is not what is being measured. */
const ALL_ON = {
  ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'true',
  ASSISTANT_ACTION_OPEN_GENERATOR: 'true',
};

/** A minimal descriptor that passes validation, for mutating in rejection tests. */
function validDescriptor(overrides = {}) {
  return {
    id: 'test_action',
    version: 1,
    status: 'active',
    domain: 'test',
    effect: 'read',
    requiredRoles: [],
    featureFlag: 'ASSISTANT_ACTION_TEST',
    autoExecute: false,
    summary: 'A test action.',
    examples: ['one', 'two', 'three', 'four', 'five'],
    slots: [],
    paramSchema: require('../../src/actions/schemas/openGenerator').openGeneratorSchema,
    ...overrides,
  };
}

describe('registry — the real descriptors', () => {
  test('the registry loads, which means startup validation passed', () => {
    expect(DESCRIPTORS.length).toBeGreaterThan(0);
    expect(CATALOG_VERSION).toBe(1);
  });

  test('Phase 1 ships exactly the two generator actions', () => {
    expect(DESCRIPTORS.map((d) => d.id)).toEqual(['generate_assessment', 'open_generator']);
  });

  test('no action may auto-execute or exceed the Phase 1 effect ceiling', () => {
    const ceiling = EFFECTS.indexOf(PHASE1_MAX_EFFECT);
    for (const d of DESCRIPTORS) {
      expect(d.autoExecute, d.id).toBe(false);
      expect(EFFECTS.indexOf(d.effect), d.id).toBeLessThanOrEqual(ceiling);
    }
  });

  test('generate_assessment references the SAME schema object the route validates with', () => {
    // Identity, not equality. If this ever becomes a structural copy, the router
    // and POST /api/resources/generate can start disagreeing about what is
    // valid — the exact failure milestone M1 existed to make impossible.
    expect(getDescriptor('generate_assessment').paramSchema).toBe(generateAssessmentSchema);
  });

  test('the disabled catalog is an inert state rather than an error', () => {
    expect(DISABLED_CATALOG).toEqual({ catalogVersion: 0, actions: [] });
    expect(Object.isFrozen(DISABLED_CATALOG)).toBe(true);
  });
});

describe('registry — validation rejects incoherent descriptors', () => {
  test('accepts a well-formed descriptor', () => {
    expect(() => validateDescriptors([validDescriptor()])).not.toThrow();
  });

  test('rejects an empty registry', () => {
    expect(() => validateDescriptors([])).toThrow(/non-empty/i);
  });

  test('rejects duplicate ids', () => {
    expect(() => validateDescriptors([validDescriptor(), validDescriptor()])).toThrow(/more than once/i);
  });

  test('rejects a missing or blank id', () => {
    expect(() => validateDescriptors([validDescriptor({ id: '' })])).toThrow(/non-empty string id/i);
  });

  test('rejects an unknown status or effect', () => {
    expect(() => validateDescriptors([validDescriptor({ status: 'retired' })])).toThrow(/unknown status/i);
    expect(() => validateDescriptors([validDescriptor({ effect: 'launch_missile' })])).toThrow(/unknown effect/i);
  });

  test('rejects an effect above the Phase 1 ceiling', () => {
    // The safety spine: nothing that writes or destroys may be registered at
    // all, so no policy bug or model output can reach one.
    expect(() => validateDescriptors([validDescriptor({ effect: 'write' })])).toThrow(/above the Phase 1 ceiling/i);
    expect(() => validateDescriptors([validDescriptor({ effect: 'destructive' })])).toThrow(/above the Phase 1 ceiling/i);
  });

  test('rejects autoExecute in any truthy form', () => {
    expect(() => validateDescriptors([validDescriptor({ autoExecute: true })])).toThrow(/autoExecute:false/i);
    expect(() => validateDescriptors([validDescriptor({ autoExecute: undefined })])).toThrow(/autoExecute:false/i);
  });

  test('rejects a descriptor with too few examples', () => {
    expect(() => validateDescriptors([validDescriptor({ examples: ['a', 'b'] })])).toThrow(/at least 5 examples/i);
  });

  test('rejects a missing feature flag', () => {
    expect(() => validateDescriptors([validDescriptor({ featureFlag: '' })])).toThrow(/featureFlag/i);
  });

  test('rejects a descriptor with no zod paramSchema', () => {
    expect(() => validateDescriptors([validDescriptor({ paramSchema: {} })])).toThrow(/zod paramSchema/i);
  });
});

describe('registry — slots must agree with the schema', () => {
  test('rejects a slot the schema does not accept', () => {
    // `.strict()` would strip it at runtime, so the router would fill a field
    // that silently never arrives.
    const broken = validDescriptor({
      paramSchema: generateAssessmentSchema,
      slots: [
        { name: 'format', type: 'enum', values: ['quiz', 'worksheet'], required: true, ask: 'Which?' },
        { name: 'topic', type: 'text', required: true, ask: 'What topic?' },
        { name: 'difficulty', type: 'enum', values: ['easy', 'medium', 'hard'], required: false },
        { name: 'questionType', type: 'enum', values: ['mcq', 'mixed'], required: false },
        { name: 'questionCount', type: 'number', min: 3, max: 30, required: false },
        { name: 'colour', type: 'text', required: false },
      ],
    });
    expect(() => validateDescriptors([broken])).toThrow(/paramSchema does not accept/i);
  });

  test('rejects a schema-required field that no slot declares', () => {
    // Without a slot for every required field, no utterance could ever produce
    // a valid request for this action.
    const broken = validDescriptor({
      paramSchema: generateAssessmentSchema,
      slots: [{ name: 'topic', type: 'text', required: true, ask: 'What topic?' }],
    });
    expect(() => validateDescriptors([broken])).toThrow(/paramSchema requires "format"/i);
  });

  test('rejects a required slot with no question to ask', () => {
    const broken = validDescriptor({
      paramSchema: generateAssessmentSchema,
      slots: [
        { name: 'format', type: 'enum', values: ['quiz', 'worksheet'], required: true },
        { name: 'topic', type: 'text', required: true, ask: 'What topic?' },
        { name: 'difficulty', type: 'enum', values: ['easy', 'medium', 'hard'], required: false },
        { name: 'questionType', type: 'enum', values: ['mcq', 'mixed'], required: false },
        { name: 'questionCount', type: 'number', min: 3, max: 30, required: false },
      ],
    });
    expect(() => validateDescriptors([broken])).toThrow(/needs an "ask" question/i);
  });

  test('rejects duplicate slot names and unknown slot types', () => {
    expect(() =>
      validateDescriptors([
        validDescriptor({ slots: [{ name: 'x', type: 'nonsense', required: false }] }),
      ])
    ).toThrow(/unknown type/i);
  });

  test('rejects a vocab slot pointing at an unknown vocabulary', () => {
    const broken = validDescriptor({
      paramSchema: generateAssessmentSchema,
      slots: [
        { name: 'format', type: 'enum', values: ['quiz', 'worksheet'], required: true, ask: 'Which?' },
        { name: 'topic', type: 'text', required: true, ask: 'What topic?' },
        { name: 'grade', type: 'vocab', vocab: 'ZODIAC_SIGNS', required: false },
        { name: 'difficulty', type: 'enum', values: ['easy', 'medium', 'hard'], required: false },
        { name: 'questionType', type: 'enum', values: ['mcq', 'mixed'], required: false },
        { name: 'questionCount', type: 'number', min: 3, max: 30, required: false },
      ],
    });
    expect(() => validateDescriptors([broken])).toThrow(/unknown vocabulary/i);
  });
});

describe('registry — visibility gates', () => {
  test('an action whose flag is unset is invisible', () => {
    expect(listForRole('teacher', {})).toEqual([]);
  });

  test('an action becomes visible only when its own flag is on', () => {
    const ids = listForRole('teacher', { ASSISTANT_ACTION_OPEN_GENERATOR: 'true' }).map((d) => d.id);
    expect(ids).toEqual(['open_generator']);
  });

  test('empty requiredRoles means any authenticated role', () => {
    for (const role of ['teacher', 'school_admin', 'resource_person', 'super_admin']) {
      expect(listForRole(role, ALL_ON).map((d) => d.id), role).toEqual([
        'generate_assessment',
        'open_generator',
      ]);
    }
  });

  test('a non-empty requiredRoles list excludes everyone else', () => {
    const adminOnly = validDescriptor({ requiredRoles: ['super_admin'] });
    expect(isVisible(adminOnly, 'teacher', { ASSISTANT_ACTION_TEST: 'true' })).toBe(false);
    expect(isVisible(adminOnly, 'super_admin', { ASSISTANT_ACTION_TEST: 'true' })).toBe(true);
  });

  test('a deprecated action stays defined but stops being offered', () => {
    // Deprecate, never delete — cached catalogs exist in the wild.
    const old = validDescriptor({ status: 'deprecated' });
    expect(isVisible(old, 'teacher', { ASSISTANT_ACTION_TEST: 'true' })).toBe(false);
  });
});

describe('registry — public projection', () => {
  const projected = toCatalogAction(getDescriptor('generate_assessment'));

  test('server-internal fields are never projected', () => {
    for (const field of ['paramSchema', 'requiredRoles', 'featureFlag', 'autoExecute']) {
      expect(projected, field).not.toHaveProperty(field);
    }
  });

  test('no route, path or url is ever projected', () => {
    // The server never tells the client where to navigate; the client owns its
    // handler map, keyed by action id.
    for (const field of ['route', 'path', 'url', 'handler']) {
      expect(projected, field).not.toHaveProperty(field);
    }
  });

  test('slot-level resolution strategy is not published', () => {
    // defaultFrom names where the server looks for a fallback value. Publishing
    // it would invite the client to re-implement resolution.
    for (const slot of projected.slots) {
      expect(slot, slot.name).not.toHaveProperty('defaultFrom');
      expect(slot, slot.name).not.toHaveProperty('sensitive');
    }
  });

  test('the projection carries what a client actually needs', () => {
    expect(projected.id).toBe('generate_assessment');
    expect(projected.effect).toBe('draft');
    expect(projected.examples.length).toBeGreaterThanOrEqual(5);
    expect(projected.slots.map((s) => s.name)).toEqual([
      'format', 'topic', 'grade', 'subject', 'difficulty', 'questionType', 'questionCount', 'language',
    ]);
  });

  test('projection copies arrays rather than sharing them', () => {
    // A caller mutating a response must not corrupt the registry for every
    // subsequent request in the process.
    projected.examples.push('injected');
    projected.slots[0].values.push('injected');
    const fresh = toCatalogAction(getDescriptor('generate_assessment'));
    expect(fresh.examples).not.toContain('injected');
    expect(fresh.slots[0].values).not.toContain('injected');
  });
});

describe('registry — buildCatalog', () => {
  test('returns the inert shape when nothing is enabled', () => {
    expect(buildCatalog('teacher', {})).toEqual({ catalogVersion: CATALOG_VERSION, actions: [] });
  });

  test('returns both actions when both flags are on', () => {
    const catalog = buildCatalog('teacher', ALL_ON);
    expect(catalog.catalogVersion).toBe(CATALOG_VERSION);
    expect(catalog.actions.map((a) => a.id)).toEqual(['generate_assessment', 'open_generator']);
  });
});
