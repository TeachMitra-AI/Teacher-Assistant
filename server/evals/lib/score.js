// The scorer (Milestone M7a). PURE — results in, metrics out. No I/O, no clock.
//
// This is the one component in the harness whose bugs are INVISIBLE: a broken
// scorer reports a beautiful number and nothing anywhere looks wrong. It is
// therefore pure, unit-tested against hand-built result objects, and proven to
// fail on an injected mis-scoring defect.
//
// Every metric reports INTEGER COUNTS alongside its percentage. A bare "91.4%"
// cannot be diffed, reproduced or argued with; "64/70" can.
//
// ─── WHAT IS COUNTED WHERE ─────────────────────────────────────────────────
// AMBIGUOUS cases are excluded from routing precision, routing recall and the
// false-positive/negative counts, and are reported in their own bucket. If they
// counted, the cheapest way to raise precision would be to relabel the awkward
// ones — the threshold could then be met without changing behaviour.
//
// SLOT metrics are computed ONLY over turns routed to the CORRECT action. Slot
// accuracy on a misrouted turn is noise: it measures extraction against a
// descriptor the utterance was never about.

const ALL_SLOTS = Object.freeze([
  'format',
  'topic',
  'grade',
  'subject',
  'difficulty',
  'questionType',
  'questionCount',
  'language',
]);

/**
 * Compare two slot values.
 *
 * Case-insensitive and NFKC-normalized because the vocabularies canonicalize to
 * a fixed casing but free text does not, and because Devanagari must compare in
 * the same normal form it was matched in.
 */
function sameValue(actual, expected) {
  if (actual === undefined || actual === null) return false;
  if (typeof expected === 'number') return Number(actual) === expected;
  return (
    String(actual).normalize('NFKC').trim().toLowerCase() ===
    String(expected).normalize('NFKC').trim().toLowerCase()
  );
}

/**
 * Normalize a topic for comparison.
 *
 * Strips a leading article and trailing punctuation, because "the water cycle"
 * and "water cycle" are the same topic and an article-sensitive metric would
 * spend its resolution on grammar rather than on extraction quality.
 */
function normalizeTopic(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

/**
 * Classify a topic result into the three failure modes recorded live at M5/M6,
 * which have three different fixes and must not be collapsed into one rate.
 *
 *   exact   — matches
 *   dirty   — contains the expected topic plus trailing junk
 *             ("photosynthesishippo", "fractionsnsibs")
 *   crammed — several slots stuffed into the topic string
 *             ("fractions.5thsgrade.subject:maths.language:Hindi")
 *   wrong   — something else entirely
 *   missing — not filled at all
 */
function classifyTopic(actualValue, expectedValue) {
  if (actualValue === undefined || actualValue === null || actualValue === '') return 'missing';

  const actual = normalizeTopic(actualValue);
  const expected = normalizeTopic(expectedValue);
  if (actual === expected) return 'exact';

  const crammedSignature = ALL_SLOTS.some((slot) =>
    new RegExp(`${slot.toLowerCase()}\\s*[:=]`, 'i').test(String(actualValue))
  );
  if (crammedSignature || /\b\w+\s*:\s*\w+/.test(String(actualValue))) return 'crammed';

  if (expected && actual.includes(expected)) return 'dirty';
  return 'wrong';
}

/** A counter that also knows its denominator. */
function ratio(numerator, denominator) {
  return {
    n: numerator,
    of: denominator,
    // One decimal, derived from integers. No floating-point noise in a
    // committed artifact, and a stable string to diff.
    pct: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10,
  };
}

/** Was this turn labelled as something that should route? */
function isActionLabel(expected) {
  return expected.decision !== 'passthrough' && expected.actionId !== null;
}

/**
 * Score one turn.
 *
 * Returns the per-case record that lands in results.json and results.csv, with
 * the verdict and — for anything that went wrong — the attribution.
 */
function scoreOne(result) {
  const { expected, actual } = result;
  const ambiguous = Array.isArray(expected.acceptable) && expected.acceptable.length > 0;
  const routed = actual.decision !== 'passthrough';
  const wantsAction = isActionLabel(expected);

  let verdict;
  if (ambiguous) {
    verdict = expected.acceptable.includes(actual.decision) ? 'acceptable' : 'outside_acceptable';
  } else if (wantsAction && routed && actual.actionId === expected.actionId) {
    verdict = actual.decision === expected.decision ? 'correct' : 'correct_action_wrong_decision';
  } else if (wantsAction && routed) {
    verdict = 'wrong_action';
  } else if (wantsAction && !routed) {
    verdict = 'missed';
  } else if (!wantsAction && routed) {
    verdict = 'false_positive';
  } else {
    verdict = 'correct';
  }

  // Attribution exists so a failure names the layer that owns the fix. The last
  // three values are CODE findings, not model findings, and the report lists
  // them first for that reason.
  let attribution = null;
  if (verdict === 'missed') {
    const reason = actual.passthroughReason;
    if (reason === 'not_an_action') attribution = 'classifier_not_an_action';
    else if (reason === 'low_confidence') attribution = 'low_confidence';
    else if (reason === 'emergency_detected') attribution = 'emergency_shortcircuit';
    else if (reason === 'invalid_proposal') attribution = 'invalid_proposal';
    else if (reason === 'classifier_timeout' || reason === 'classifier_error') attribution = 'infra';
    else if (reason === 'safety_blocked' || reason === 'budget_exhausted' || reason === 'disabled')
      attribution = 'infra';
    else attribution = 'unknown';
  } else if (verdict === 'wrong_action') {
    attribution = 'classifier_wrong_action';
  } else if (verdict === 'correct_action_wrong_decision') {
    // The naive attribution here is "policy.js", and it is usually WRONG. The
    // policy asking for `topic` when `topic` is missing is the policy working
    // exactly as specified; the defect is upstream, in a classifier that did not
    // extract a slot the teacher plainly stated. Attributing these to the policy
    // would send someone to read a module with 288 exhaustively-enumerated
    // combinations looking for a bug that is not there.
    const stated = Object.keys(expected.slots?.stated || {});
    const missedStatedSlot = (actual.missing || []).some((slot) => stated.includes(slot));
    const hallucinatedRequired = (expected.slots?.notStated || []).some(
      (slot) => actual.provenance[slot] === 'utterance'
    );

    if (missedStatedSlot) attribution = 'classifier_slot_missing';
    else if (actual.decision === 'prefill' && expected.decision === 'ask' && hallucinatedRequired)
      attribution = 'classifier_slot_hallucinated';
    else attribution = 'policy_decision';
  }

  // --- Slot scoring, only where the action is right -------------------------
  const slots = { stated: [], hallucinated: [], inherited: [], stale: [], topic: null };
  const scoreSlots = !ambiguous && routed && wantsAction && actual.actionId === expected.actionId;

  if (scoreSlots) {
    const spec = expected.slots || {};

    for (const [slot, expectedValue] of Object.entries(spec.stated || {})) {
      const value = actual.params[slot];
      const provenance = actual.provenance[slot];
      const entry = {
        slot,
        extracted: provenance === 'utterance',
        correct: provenance === 'utterance' && sameValue(value, expectedValue),
        actual: value === undefined ? null : value,
        expected: expectedValue,
        provenance: provenance || null,
      };
      if (slot === 'topic') {
        slots.topic = classifyTopic(value, expectedValue);
        entry.correct = slots.topic === 'exact' && provenance === 'utterance';
      }
      slots.stated.push(entry);
    }

    for (const slot of spec.notStated || []) {
      if (actual.provenance[slot] === 'utterance') {
        slots.hallucinated.push({ slot, actual: actual.params[slot] ?? null });
      }
    }

    for (const [slot, expectedValue] of Object.entries(spec.inherited || {})) {
      slots.inherited.push({
        slot,
        correct: actual.provenance[slot] === 'memory' && sameValue(actual.params[slot], expectedValue),
        actual: actual.params[slot] ?? null,
        expected: expectedValue,
        provenance: actual.provenance[slot] || null,
      });
    }

    for (const slot of spec.mustNotInherit || []) {
      if (actual.provenance[slot] === 'memory') {
        slots.stale.push({ slot, actual: actual.params[slot] ?? null });
      }
    }
  }

  // --- Hard-gate observations ----------------------------------------------
  // The language trap is checked on EVERY turn regardless of routing: a
  // `language` set from the utterance where none was named is a violation
  // whether or not the action was right.
  const languageTrapViolation =
    (expected.slots?.notStated || []).includes('language') && actual.provenance.language === 'utterance';

  const askCorrect =
    expected.decision === 'ask' && actual.decision === 'ask'
      ? actual.askSlot === expected.askSlot
      : null;

  const reasonCorrect = expected.passthroughReason
    ? actual.passthroughReason === expected.passthroughReason
    : null;

  return {
    ...result,
    ambiguous,
    verdict,
    attribution,
    slots,
    languageTrapViolation,
    askCorrect,
    reasonCorrect,
  };
}

/** Aggregate scored turns into the report's metric blocks. */
function aggregate(scored) {
  const headline = scored.filter((entry) => !entry.ambiguous);
  const routed = headline.filter((entry) => entry.actual.decision !== 'passthrough');
  const wantsAction = headline.filter((entry) => isActionLabel(entry.expected));

  const precisionHits = routed.filter(
    (entry) => entry.verdict === 'correct' || entry.verdict === 'correct_action_wrong_decision'
  );
  const recallHits = wantsAction.filter(
    (entry) => entry.verdict === 'correct' || entry.verdict === 'correct_action_wrong_decision'
  );

  const byLanguage = {};
  for (const language of ['en', 'hinglish', 'hi']) {
    const subset = headline.filter((entry) => entry.language === language);
    const subsetRouted = subset.filter((entry) => entry.actual.decision !== 'passthrough');
    const subsetActions = subset.filter((entry) => isActionLabel(entry.expected));
    byLanguage[language] = {
      cases: subset.length,
      precision: ratio(
        subsetRouted.filter((e) => e.verdict.startsWith('correct')).length,
        subsetRouted.length
      ),
      recall: ratio(
        subsetActions.filter((e) => e.verdict.startsWith('correct')).length,
        subsetActions.length
      ),
    };
  }

  const byAction = {};
  for (const actionId of ['generate_assessment', 'open_generator']) {
    const labelled = headline.filter((entry) => entry.expected.actionId === actionId);
    const claimed = headline.filter((entry) => entry.actual.actionId === actionId);
    byAction[actionId] = {
      precision: ratio(claimed.filter((e) => e.expected.actionId === actionId).length, claimed.length),
      recall: ratio(labelled.filter((e) => e.actual.actionId === actionId).length, labelled.length),
    };
  }

  // --- Slot metrics ---------------------------------------------------------
  const slotMetrics = {};
  for (const slot of ALL_SLOTS) {
    let statedTotal = 0;
    let extracted = 0;
    let correct = 0;
    let hallucinated = 0;
    let notStatedTotal = 0;

    for (const entry of scored) {
      for (const stated of entry.slots.stated) {
        if (stated.slot !== slot) continue;
        statedTotal += 1;
        if (stated.extracted) extracted += 1;
        if (stated.correct) correct += 1;
      }
      if ((entry.expected.slots?.notStated || []).includes(slot)) {
        // Only counted where slots were scored at all — otherwise a misrouted
        // turn would inflate the denominator with cases nothing was extracted for.
        if (entry.slots.stated.length > 0 || entry.slots.inherited.length > 0 || entry.verdict.startsWith('correct')) {
          notStatedTotal += 1;
          if (entry.slots.hallucinated.some((h) => h.slot === slot)) hallucinated += 1;
        }
      }
    }

    slotMetrics[slot] = {
      extractionRecall: ratio(extracted, statedTotal),
      valueAccuracy: ratio(correct, statedTotal),
      hallucination: ratio(hallucinated, notStatedTotal),
    };
  }

  const topicVerdicts = { exact: 0, dirty: 0, crammed: 0, wrong: 0, missing: 0 };
  for (const entry of scored) {
    if (entry.slots.topic) topicVerdicts[entry.slots.topic] += 1;
  }
  const topicTotal = Object.values(topicVerdicts).reduce((sum, n) => sum + n, 0);

  // --- Clarification --------------------------------------------------------
  const asks = headline.filter((entry) => entry.actual.decision === 'ask');
  const askChecked = scored.filter((entry) => entry.askCorrect !== null);

  // --- Memory ---------------------------------------------------------------
  const memoryTurns = scored.filter((entry) => entry.stratum === 'memory');
  let inheritTotal = 0;
  let inheritCorrect = 0;
  let staleTotal = 0;
  let staleHits = 0;
  let overrideTotal = 0;
  let overrideCorrect = 0;

  for (const entry of memoryTurns) {
    for (const inherited of entry.slots.inherited) {
      inheritTotal += 1;
      if (inherited.correct) inheritCorrect += 1;
    }
    const mustNot = entry.expected.slots?.mustNotInherit || [];
    staleTotal += mustNot.length;
    staleHits += entry.slots.stale.length;
    // An override is a slot that is BOTH stated this turn and listed as
    // must-not-inherit: the teacher restated it, so `utterance` must win.
    for (const stated of entry.slots.stated) {
      if (mustNot.includes(stated.slot)) {
        overrideTotal += 1;
        if (stated.extracted) overrideCorrect += 1;
      }
    }
  }

  const askTurnLeaks = memoryTurns.filter(
    (entry) => entry.actual.decision === 'ask' && entry.actual.memoryUpdates !== null
  );

  // --- Hard gates -----------------------------------------------------------
  const emergency = scored.filter((entry) => entry.stratum === 'emergency');
  const emergencyGuarded = emergency.filter(
    (entry) => entry.expected.passthroughReason === 'emergency_detected'
  );

  const hardGates = {
    emergencyRouted: {
      pass: emergency.every((entry) => entry.actual.decision === 'passthrough'),
      offenders: emergency
        .filter((entry) => entry.actual.decision !== 'passthrough')
        .map((entry) => entry.caseId),
    },
    emergencyClassifierCalls: {
      pass: emergencyGuarded.every((entry) => entry.classifierCalls === 0),
      offenders: emergencyGuarded
        .filter((entry) => entry.classifierCalls !== 0)
        .map((entry) => `${entry.caseId} (${entry.classifierCalls} calls)`),
    },
    languageTrap: {
      pass: scored.every((entry) => !entry.languageTrapViolation),
      offenders: scored.filter((entry) => entry.languageTrapViolation).map((entry) => entry.caseId),
    },
    outOfCatalogAccepted: {
      // Any action id the pipeline emitted that is not a registered capability.
      pass: scored.every(
        (entry) =>
          entry.actual.actionId === null ||
          ['generate_assessment', 'open_generator'].includes(entry.actual.actionId)
      ),
      offenders: scored
        .filter(
          (entry) =>
            entry.actual.actionId !== null &&
            !['generate_assessment', 'open_generator'].includes(entry.actual.actionId)
        )
        .map((entry) => `${entry.caseId} -> ${entry.actual.actionId}`),
    },
    askTurnMemoryIsolation: {
      pass: askTurnLeaks.length === 0,
      offenders: askTurnLeaks.map((entry) => `${entry.caseId} turn ${entry.turn}`),
    },
  };

  const latencies = scored.map((entry) => entry.latencyMs).sort((a, b) => a - b);
  const percentile = (p) =>
    latencies.length === 0 ? null : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];

  const attributionCounts = {};
  for (const entry of scored) {
    if (!entry.attribution) continue;
    attributionCounts[entry.attribution] = (attributionCounts[entry.attribution] || 0) + 1;
  }

  const passthroughReasons = {};
  for (const entry of scored) {
    const reason = entry.actual.passthroughReason;
    if (reason) passthroughReasons[reason] = (passthroughReasons[reason] || 0) + 1;
  }

  const ambiguousCases = scored.filter((entry) => entry.ambiguous);

  return {
    totals: {
      turns: scored.length,
      headlineTurns: headline.length,
      ambiguousTurns: ambiguousCases.length,
      routed: routed.length,
      labelledActions: wantsAction.length,
    },
    routing: {
      precision: ratio(precisionHits.length, routed.length),
      recall: ratio(recallHits.length, wantsAction.length),
      decisionAccuracy: ratio(
        headline.filter((entry) => entry.verdict === 'correct').length,
        headline.length
      ),
    },
    falsePositives: {
      total: headline.filter((entry) => entry.verdict === 'false_positive').length,
      coaching: ratio(
        scored.filter((entry) => entry.stratum === 'coaching' && entry.verdict === 'false_positive')
          .length,
        scored.filter((entry) => entry.stratum === 'coaching').length
      ),
      adversarial: scored.filter(
        (entry) => entry.stratum === 'adversarial' && entry.verdict === 'false_positive'
      ).length,
      cases: headline.filter((entry) => entry.verdict === 'false_positive').map((entry) => entry.caseId),
    },
    falseNegatives: {
      total: headline.filter((entry) => entry.verdict === 'missed' || entry.verdict === 'wrong_action')
        .length,
      byAttribution: attributionCounts,
      cases: headline
        .filter((entry) => entry.verdict === 'missed' || entry.verdict === 'wrong_action')
        .map((entry) => entry.caseId),
    },
    byLanguage,
    byAction,
    slots: slotMetrics,
    topic: { verdicts: topicVerdicts, cleanliness: ratio(topicVerdicts.exact, topicTotal) },
    clarification: {
      rate: ratio(asks.length, routed.length),
      correctness: ratio(askChecked.filter((entry) => entry.askCorrect).length, askChecked.length),
      overAsking: headline.filter(
        (entry) => entry.actual.decision === 'ask' && entry.expected.decision === 'prefill'
      ).length,
      underAsking: headline.filter(
        (entry) => entry.actual.decision === 'prefill' && entry.expected.decision === 'ask'
      ).length,
    },
    memory: {
      sessions: new Set(memoryTurns.map((entry) => entry.caseId)).size,
      turns: memoryTurns.length,
      inheritanceCorrectness: ratio(inheritCorrect, inheritTotal),
      staleness: ratio(staleHits, staleTotal),
      overrideCorrectness: ratio(overrideCorrect, overrideTotal),
    },
    ambiguousBucket: {
      total: ambiguousCases.length,
      agreement: ratio(
        ambiguousCases.filter((entry) => entry.verdict === 'acceptable').length,
        ambiguousCases.length
      ),
      outside: ambiguousCases
        .filter((entry) => entry.verdict === 'outside_acceptable')
        .map((entry) => entry.caseId),
    },
    hardGates,
    operational: {
      latencyP50: percentile(0.5),
      latencyP95: percentile(0.95),
      latencyMax: latencies.length ? latencies[latencies.length - 1] : null,
      totalClassifierCalls: scored.reduce((sum, entry) => sum + entry.classifierCalls, 0),
      passthroughReasons,
    },
  };
}

/** Score a whole run. */
function score(results) {
  const scored = results.map(scoreOne);
  return { scored, metrics: aggregate(scored) };
}

module.exports = { ALL_SLOTS, sameValue, normalizeTopic, classifyTopic, ratio, scoreOne, aggregate, score };
