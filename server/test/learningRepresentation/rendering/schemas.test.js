// Structured render specs — AI Learning Representation System, Phase C.

const { LEARNING_REPRESENTATION_IDS, VERBAL_EXPLANATION } = require('../../../src/learningRepresentation/representations');
const {
  RENDER_SPECS,
  RENDERABLE_REPRESENTATION_IDS,
  hasRenderer,
  getRenderVersion,
} = require('../../../src/learningRepresentation/rendering/schemas');

const VALID_EXAMPLES = {
  process_diagram: {
    steps: [
      { label: 'Water evaporates', description: 'The sun heats water in oceans and lakes, turning it into vapour.' },
      { label: 'Vapour condenses', description: 'Water vapour cools and forms clouds.' },
      { label: 'Precipitation falls', description: 'Water falls back to the ground as rain or snow.' },
    ],
  },
  comparison_table: {
    items: ['Mitosis', 'Meiosis'],
    rows: [
      { dimension: 'Number of divisions', values: ['One', 'Two'] },
      { dimension: 'Resulting cells', values: ['2 identical cells', '4 non-identical cells'] },
    ],
  },
  timeline: {
    events: [
      { when: '1526', label: 'Battle of Panipat', description: 'Babur defeats the Delhi Sultanate, founding the Mughal Empire.' },
      { when: '1556', label: 'Akbar becomes emperor', description: 'Akbar takes the throne at age 13.' },
    ],
  },
  hierarchy_diagram: {
    nodes: [
      { id: 'animalia', label: 'Animal Kingdom', parentId: null },
      { id: 'vertebrates', label: 'Vertebrates', parentId: 'animalia' },
      { id: 'mammals', label: 'Mammals', parentId: 'vertebrates' },
    ],
  },
  labeled_diagram: {
    parts: [
      { label: 'Nucleus', description: 'Contains the cell’s genetic material.' },
      { label: 'Chloroplast', description: 'Site of photosynthesis in plant cells.' },
    ],
  },
  graph_chart: {
    chartType: 'line',
    xLabel: 'Year',
    yLabel: 'Population (crore)',
    series: [
      {
        name: 'India',
        points: [
          { x: '1970', y: 54 },
          { x: '2000', y: 103 },
          { x: '2020', y: 138 },
        ],
      },
    ],
  },
};

describe('the registry (what schemas.js IS the source of truth for)', () => {
  test('covers exactly the six non-verbal representations', () => {
    expect([...RENDERABLE_REPRESENTATION_IDS].sort()).toEqual(
      LEARNING_REPRESENTATION_IDS.filter((id) => id !== VERBAL_EXPLANATION).sort()
    );
  });

  test('never includes verbal_explanation', () => {
    expect(RENDERABLE_REPRESENTATION_IDS).not.toContain(VERBAL_EXPLANATION);
  });

  test('hasRenderer is true for every renderable id, false otherwise', () => {
    for (const id of RENDERABLE_REPRESENTATION_IDS) expect(hasRenderer(id)).toBe(true);
    expect(hasRenderer(VERBAL_EXPLANATION)).toBe(false);
    expect(hasRenderer('not_a_real_representation')).toBe(false);
  });
});

describe('every spec has the shape renderer.js depends on', () => {
  for (const id of Object.keys(RENDER_SPECS)) {
    test(`${id}: instructions, responseSchema, resultSchema all present`, () => {
      const spec = RENDER_SPECS[id];
      expect(typeof spec.instructions).toBe('string');
      expect(spec.instructions.length).toBeGreaterThan(0);
      expect(typeof spec.responseSchema).toBe('object');
      expect(typeof spec.resultSchema.safeParse).toBe('function');
    });

    test(`${id}: has a valid positive-integer version (ADR Phase E)`, () => {
      const spec = RENDER_SPECS[id];
      expect(Number.isInteger(spec.version)).toBe(true);
      expect(spec.version).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('getRenderVersion', () => {
  test.each(RENDERABLE_REPRESENTATION_IDS)('%s returns the same version as RENDER_SPECS', (id) => {
    expect(getRenderVersion(id)).toBe(RENDER_SPECS[id].version);
  });
});

describe('resultSchema accepts a realistic valid example, per representation', () => {
  for (const id of Object.keys(VALID_EXAMPLES)) {
    test(id, () => {
      const result = RENDER_SPECS[id].resultSchema.safeParse(VALID_EXAMPLES[id]);
      expect(result.success).toBe(true);
    });
  }
});

describe('resultSchema rejects the obvious malformed shapes', () => {
  test('process_diagram: fewer than 2 steps', () => {
    const result = RENDER_SPECS.process_diagram.resultSchema.safeParse({
      steps: [{ label: 'Only one', description: 'Not a real process.' }],
    });
    expect(result.success).toBe(false);
  });

  test('process_diagram: an extra unrequested field (.strict())', () => {
    const result = RENDER_SPECS.process_diagram.resultSchema.safeParse({
      steps: [
        { label: 'a', description: 'b' },
        { label: 'c', description: 'd', confidence: 'high' },
      ],
    });
    expect(result.success).toBe(false);
  });

  test('comparison_table: row values that do not align 1:1 with items', () => {
    const result = RENDER_SPECS.comparison_table.resultSchema.safeParse({
      items: ['Mitosis', 'Meiosis'],
      rows: [{ dimension: 'Divisions', values: ['One'] }], // only one value for two items
    });
    expect(result.success).toBe(false);
  });

  test('hierarchy_diagram: no root (every node has a parent)', () => {
    const result = RENDER_SPECS.hierarchy_diagram.resultSchema.safeParse({
      nodes: [
        { id: 'a', label: 'A', parentId: 'b' },
        { id: 'b', label: 'B', parentId: 'a' },
      ],
    });
    expect(result.success).toBe(false);
  });

  test('hierarchy_diagram: two roots', () => {
    const result = RENDER_SPECS.hierarchy_diagram.resultSchema.safeParse({
      nodes: [
        { id: 'a', label: 'A', parentId: null },
        { id: 'b', label: 'B', parentId: null },
      ],
    });
    expect(result.success).toBe(false);
  });

  test('hierarchy_diagram: a parentId that does not resolve to any node', () => {
    const result = RENDER_SPECS.hierarchy_diagram.resultSchema.safeParse({
      nodes: [
        { id: 'a', label: 'A', parentId: null },
        { id: 'b', label: 'B', parentId: 'does-not-exist' },
      ],
    });
    expect(result.success).toBe(false);
  });

  test('hierarchy_diagram: duplicate ids', () => {
    const result = RENDER_SPECS.hierarchy_diagram.resultSchema.safeParse({
      nodes: [
        { id: 'a', label: 'A', parentId: null },
        { id: 'a', label: 'A again', parentId: 'a' },
      ],
    });
    expect(result.success).toBe(false);
  });

  test('graph_chart: a non-numeric y value', () => {
    const result = RENDER_SPECS.graph_chart.resultSchema.safeParse({
      chartType: 'line',
      xLabel: 'Year',
      yLabel: 'Population',
      series: [{ name: 'India', points: [{ x: '2000', y: 'a lot' }, { x: '2010', y: 120 }] }],
    });
    expect(result.success).toBe(false);
  });

  test('graph_chart: an invalid chartType', () => {
    const result = RENDER_SPECS.graph_chart.resultSchema.safeParse({
      chartType: 'pie',
      xLabel: 'Year',
      yLabel: 'Population',
      series: [{ name: 'India', points: [{ x: '2000', y: 1 }, { x: '2010', y: 2 }] }],
    });
    expect(result.success).toBe(false);
  });
});

describe('the registry consistency guard ran at load time without throwing', () => {
  test('requiring schemas.js succeeded, which is itself the proof', () => {
    expect(RENDER_SPECS).toBeDefined();
  });
});
