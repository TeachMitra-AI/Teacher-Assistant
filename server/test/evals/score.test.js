// The scorer's own tests (Milestone M7a).
//
// A BROKEN SCORER REPORTS A BEAUTIFUL NUMBER. Nothing else in the harness has
// that property: a broken loader throws, a broken runner throws, a missing
// cassette now invalidates the run — but a scorer that counts a wrong action as
// correct produces a report that looks exactly like a good one. So it is pure,
// it is tested against hand-built results, and the tests below are proven to
// fail when a mis-scoring defect is injected (see the M7a completion report).


const { scoreOne, aggregate, score, classifyTopic, sameValue } = require('../../evals/lib/score');

/** Build a result record without repeating the whole shape in every test. */
function result({
  caseId = 'c.1',
  stratum = 'commands',
  language = 'en',
  turn = null,
  expected,
  decision = 'prefill',
  actionId = 'generate_assessment',
  params = {},
  provenance = {},
  missing = [],
  passthroughReason = null,
  askSlot = null,
  memoryUpdates = null,
  classifierCalls = 1,
} = {}) {
  return {
    caseId,
    turn,
    stratum,
    language,
    utterance: 'x',
    expected: {
      slots: { stated: {}, inherited: {}, notStated: [], mustNotInherit: [] },
      ...expected,
    },
    actual: {
      decision,
      actionId: decision === 'passthrough' ? null : actionId,
      passthroughReason,
      params,
      provenance,
      missing,
      lowConfidenceFields: [],
      confidence: 'high',
      askSlot,
      askOptions: null,
      memoryUpdates,
    },
    classifierCalls,
    latencyMs: 1,
  };
}

const action = (over = {}) => ({ decision: 'prefill', actionId: 'generate_assessment', ...over });
const nonAction = (over = {}) => ({ decision: 'passthrough', actionId: null, ...over });

describe('scoreOne — verdicts', () => {
  test('a correctly routed action is correct', () => {
    expect(scoreOne(result({ expected: action() })).verdict).toBe('correct');
  });

  test('the WRONG action is never scored as correct', () => {
    const scored = scoreOne(result({ expected: action(), actionId: 'open_generator' }));
    expect(scored.verdict).toBe('wrong_action');
    expect(scored.attribution).toBe('classifier_wrong_action');
  });

  test('a labelled action that passed through is a miss, attributed by reason', () => {
    const scored = scoreOne(
      result({ expected: action(), decision: 'passthrough', passthroughReason: 'not_an_action' })
    );
    expect(scored.verdict).toBe('missed');
    expect(scored.attribution).toBe('classifier_not_an_action');
  });

  test('a routed coaching question is a false positive', () => {
    const scored = scoreOne(result({ stratum: 'coaching', expected: nonAction() }));
    expect(scored.verdict).toBe('false_positive');
  });

  test('a coaching question that passed through is correct', () => {
    const scored = scoreOne(
      result({ stratum: 'coaching', expected: nonAction(), decision: 'passthrough' })
    );
    expect(scored.verdict).toBe('correct');
  });

  test('each passthrough reason maps to its owning layer', () => {
    const cases = {
      low_confidence: 'low_confidence',
      invalid_proposal: 'invalid_proposal',
      classifier_timeout: 'infra',
      classifier_error: 'infra',
      safety_blocked: 'infra',
      emergency_detected: 'emergency_shortcircuit',
    };
    for (const [reason, attribution] of Object.entries(cases)) {
      const scored = scoreOne(
        result({ expected: action(), decision: 'passthrough', passthroughReason: reason })
      );
      expect(scored.attribution, reason).toBe(attribution);
    }
  });

  // The distinction this protects is the one that decides who reads which file.
  test('an ask caused by an unextracted STATED slot blames the classifier, not the policy', () => {
    const scored = scoreOne(
      result({
        expected: action({ decision: 'prefill', slots: { stated: { topic: 'fractions' }, inherited: {}, notStated: [], mustNotInherit: [] } }),
        decision: 'ask',
        missing: ['topic'],
        askSlot: 'topic',
      })
    );
    expect(scored.verdict).toBe('correct_action_wrong_decision');
    expect(scored.attribution).toBe('classifier_slot_missing');
  });

  test('an ask for a slot the teacher genuinely did not state blames the policy', () => {
    const scored = scoreOne(
      result({
        expected: action({ decision: 'prefill' }),
        decision: 'ask',
        missing: ['format'],
        askSlot: 'format',
      })
    );
    expect(scored.attribution).toBe('policy_decision');
  });
});

describe('scoreOne — slots', () => {
  const expected = action({
    slots: {
      stated: { format: 'worksheet', grade: 'Class 3-5' },
      inherited: {},
      notStated: ['language', 'subject'],
      mustNotInherit: [],
    },
  });

  test('a stated slot filled from the utterance with the right value is correct', () => {
    const scored = scoreOne(
      result({
        expected,
        params: { format: 'worksheet', grade: 'Class 3-5' },
        provenance: { format: 'utterance', grade: 'utterance' },
      })
    );
    expect(scored.slots.stated.every((s) => s.correct)).toBe(true);
  });

  test('the right value from the WRONG source is not an extraction', () => {
    const scored = scoreOne(
      result({
        expected,
        params: { format: 'worksheet', grade: 'Class 3-5' },
        provenance: { format: 'utterance', grade: 'memory' },
      })
    );
    const grade = scored.slots.stated.find((s) => s.slot === 'grade');
    expect(grade.extracted).toBe(false);
    expect(grade.correct).toBe(false);
  });

  test('a notStated slot filled from the utterance is counted as a hallucination', () => {
    const scored = scoreOne(
      result({
        expected,
        params: { format: 'worksheet', grade: 'Class 3-5', subject: 'Science' },
        provenance: { format: 'utterance', grade: 'utterance', subject: 'utterance' },
      })
    );
    expect(scored.slots.hallucinated.map((h) => h.slot)).toEqual(['subject']);
  });

  test('a notStated slot filled from PROFILE is not a hallucination', () => {
    const scored = scoreOne(
      result({
        expected,
        params: { format: 'worksheet', grade: 'Class 3-5', subject: 'Science' },
        provenance: { format: 'utterance', grade: 'utterance', subject: 'profile' },
      })
    );
    expect(scored.slots.hallucinated).toHaveLength(0);
  });

  test('slots are NOT scored when the action was wrong', () => {
    const scored = scoreOne(
      result({
        expected,
        actionId: 'open_generator',
        params: { format: 'worksheet' },
        provenance: { format: 'utterance' },
      })
    );
    expect(scored.slots.stated).toHaveLength(0);
  });

  test('memory inheritance and staleness are counted separately', () => {
    const scored = scoreOne(
      result({
        stratum: 'memory',
        expected: action({
          slots: {
            stated: {},
            inherited: { grade: 'Class 3-5' },
            notStated: [],
            mustNotInherit: ['topic'],
          },
        }),
        params: { grade: 'Class 3-5', topic: 'old topic' },
        provenance: { grade: 'memory', topic: 'memory' },
      })
    );
    expect(scored.slots.inherited[0].correct).toBe(true);
    expect(scored.slots.stale.map((s) => s.slot)).toEqual(['topic']);
  });
});

describe('scoreOne — hard-gate observations', () => {
  test('language set from the utterance where none was named is a trap violation', () => {
    const scored = scoreOne(
      result({
        expected: action({ slots: { stated: {}, inherited: {}, notStated: ['language'], mustNotInherit: [] } }),
        params: { language: 'hi' },
        provenance: { language: 'utterance' },
      })
    );
    expect(scored.languageTrapViolation).toBe(true);
  });

  test('language from the PROFILE is not a trap violation', () => {
    const scored = scoreOne(
      result({
        expected: action({ slots: { stated: {}, inherited: {}, notStated: ['language'], mustNotInherit: [] } }),
        params: { language: 'en' },
        provenance: { language: 'profile' },
      })
    );
    expect(scored.languageTrapViolation).toBe(false);
  });

  test('the asked slot is checked against the label', () => {
    expect(
      scoreOne(result({ expected: action({ decision: 'ask', askSlot: 'format' }), decision: 'ask', askSlot: 'format' }))
        .askCorrect
    ).toBe(true);
    expect(
      scoreOne(result({ expected: action({ decision: 'ask', askSlot: 'format' }), decision: 'ask', askSlot: 'topic' }))
        .askCorrect
    ).toBe(false);
  });
});

describe('ambiguous quarantine', () => {
  const ambiguous = {
    decision: 'ask',
    acceptable: ['ask', 'passthrough'],
    actionId: 'generate_assessment',
  };

  test('an acceptable outcome is not a failure', () => {
    const scored = scoreOne(result({ stratum: 'ambiguous', expected: ambiguous, decision: 'passthrough' }));
    expect(scored.verdict).toBe('acceptable');
  });

  test('an ambiguous case moves NEITHER precision nor recall', () => {
    const base = [result({ expected: action() })];
    const withAmbiguous = [
      ...base,
      result({ caseId: 'c.2', stratum: 'ambiguous', expected: ambiguous, decision: 'prefill' }),
    ];

    const before = aggregate(base.map(scoreOne));
    const after = aggregate(withAmbiguous.map(scoreOne));

    expect(after.routing.precision).toEqual(before.routing.precision);
    expect(after.routing.recall).toEqual(before.routing.recall);
    expect(after.falsePositives.total).toBe(before.falsePositives.total);
    expect(after.ambiguousBucket.total).toBe(1);
  });
});

describe('aggregate', () => {
  test('percentages are derived from the integer counts', () => {
    const results = [
      result({ caseId: 'a.1', expected: action() }),
      result({ caseId: 'a.2', expected: action() }),
      result({ caseId: 'a.3', expected: action(), actionId: 'open_generator' }),
    ];
    const { metrics } = score(results);
    expect(metrics.routing.precision).toEqual({ n: 2, of: 3, pct: 66.7 });
  });

  test('an empty denominator reports null, never a fabricated 100%', () => {
    const { metrics } = score([result({ stratum: 'coaching', expected: nonAction(), decision: 'passthrough' })]);
    expect(metrics.routing.precision.pct).toBeNull();
  });

  test('hard gates fail loudly and name their offenders', () => {
    const { metrics } = score([
      result({
        caseId: 'emg.1',
        stratum: 'emergency',
        expected: nonAction({ passthroughReason: 'emergency_detected' }),
        decision: 'prefill',
        classifierCalls: 1,
      }),
    ]);
    expect(metrics.hardGates.emergencyRouted.pass).toBe(false);
    expect(metrics.hardGates.emergencyRouted.offenders).toEqual(['emg.1']);
    expect(metrics.hardGates.emergencyClassifierCalls.pass).toBe(false);
  });

  // ADDED AFTER AN INJECTED-DEFECT PROOF FAILED TO FAIL. Hardcoding
  // `hardGates.languageTrap.pass` to true broke nothing: `scoreOne`'s
  // per-turn `languageTrapViolation` flag was tested, but the AGGREGATE that
  // actually gates a release was not, so the gate could not fail. Every other
  // hard gate had this test; this one did not. A guard that cannot fail is not
  // a guard (the M5 G4 precedent, found the same way).
  test('a language-trap violation fails the gate and names the offender', () => {
    const { metrics } = score([
      result({
        caseId: 'cmd.hi.trap',
        language: 'hi',
        expected: action({
          slots: { stated: {}, inherited: {}, notStated: ['language'], mustNotInherit: [] },
        }),
        params: { language: 'hi' },
        provenance: { language: 'utterance' },
      }),
    ]);
    expect(metrics.hardGates.languageTrap.pass).toBe(false);
    expect(metrics.hardGates.languageTrap.offenders).toEqual(['cmd.hi.trap']);
  });

  test('language from the profile does NOT fail the trap gate', () => {
    const { metrics } = score([
      result({
        expected: action({
          slots: { stated: {}, inherited: {}, notStated: ['language'], mustNotInherit: [] },
        }),
        params: { language: 'en' },
        provenance: { language: 'profile' },
      }),
    ]);
    expect(metrics.hardGates.languageTrap.pass).toBe(true);
  });

  test('an action id outside the registry fails the out-of-catalog gate', () => {
    const { metrics } = score([result({ expected: action(), actionId: 'delete_all_resources' })]);
    expect(metrics.hardGates.outOfCatalogAccepted.pass).toBe(false);
  });

  test('memoryUpdates on an ask turn fails the isolation gate', () => {
    const { metrics } = score([
      result({
        stratum: 'memory',
        expected: action({ decision: 'ask', askSlot: 'topic' }),
        decision: 'ask',
        askSlot: 'topic',
        memoryUpdates: { format: { value: 'quiz', source: 'utterance', turn: 1 } },
      }),
    ]);
    expect(metrics.hardGates.askTurnMemoryIsolation.pass).toBe(false);
  });
});

describe('topic classification', () => {
  test('separates the three failure modes recorded live at M5 and M6', () => {
    expect(classifyTopic('fractions', 'fractions')).toBe('exact');
    expect(classifyTopic('the water cycle', 'water cycle')).toBe('exact');
    expect(classifyTopic('photosynthesishippo', 'photosynthesis')).toBe('dirty');
    expect(classifyTopic('fractions.5thsgrade.subject:maths', 'fractions')).toBe('crammed');
    expect(classifyTopic('algebra', 'fractions')).toBe('wrong');
    expect(classifyTopic(undefined, 'fractions')).toBe('missing');
  });
});

describe('value comparison', () => {
  test('is case- and NFKC-insensitive, and type-aware for numbers', () => {
    expect(sameValue('Worksheet', 'worksheet')).toBe(true);
    expect(sameValue('  Class 3-5 ', 'Class 3-5')).toBe(true);
    expect(sameValue(10, 10)).toBe(true);
    expect(sameValue('10', 10)).toBe(true);
    expect(sameValue(undefined, 'x')).toBe(false);
  });
});
