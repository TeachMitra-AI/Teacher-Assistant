import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGISTERED_ACTION_IDS, REGISTERED_DOMAINS, resolveDomainHome, resolveHandler } from './index';
import { generateAssessmentHandler } from './generateAssessment';
import { openGeneratorHandler } from './openGenerator';
import { GENERATOR_ROUTE, PREFILL_PARAM } from './routes';
import { DRAFT_STORAGE_KEY, readDraft } from '../draftStore';
import type { ResolvedAction } from '../types';

// Handlers are the ONLY place an AI-navigation route string may appear (G16) and
// the only place the teacher's text ever touches storage. Both properties are
// asserted here rather than assumed, because the URL is the one surface where a
// mistake becomes permanent — browser history, referrer headers, access logs.

const prefill: ResolvedAction = {
  actionId: 'generate_assessment',
  version: 1,
  effect: 'draft',
  decision: 'prefill',
  confidence: 'high',
  params: { format: 'worksheet', topic: 'Fractions', grade: 'Class 3-5', questionCount: 10 },
  provenance: { format: 'utterance', topic: 'utterance', grade: 'memory', questionCount: 'default' },
  missing: [],
  lowConfidenceFields: ['grade'],
};

const utterance = 'Generate a Class 5 fractions worksheet';

function handleIdFrom(to: string): string {
  return new URLSearchParams(to.split('?')[1] ?? '').get(PREFILL_PARAM) ?? '';
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('generate_assessment handler', () => {
  it('writes the draft, then navigates with an opaque handle', () => {
    const navigate = vi.fn();
    generateAssessmentHandler(prefill, { navigate, utterance });

    const to = navigate.mock.calls[0][0] as string;
    expect(to.startsWith(`${GENERATOR_ROUTE}?${PREFILL_PARAM}=`)).toBe(true);

    const draft = readDraft(handleIdFrom(to));
    expect(draft).not.toBeNull();
    expect(draft!.actionId).toBe('generate_assessment');
    expect(draft!.initialParams).toEqual(prefill.params);
    expect(draft!.provenance).toEqual(prefill.provenance);
    expect(draft!.lowConfidenceFields).toEqual(['grade']);
  });

  it('keeps the utterance for the banner but out of the URL (G12)', () => {
    const navigate = vi.fn();
    generateAssessmentHandler(prefill, { navigate, utterance });

    const to = navigate.mock.calls[0][0] as string;
    expect(to).not.toContain('Fractions');
    expect(to).not.toContain('fractions');
    expect(to).not.toContain('worksheet');
    expect(to).not.toContain('Class');
    // Available where it is safe: in the tab's own storage, for the banner.
    expect(readDraft(handleIdFrom(to))!.utterance).toBe(utterance);
  });

  it('produces a handle that carries no teacher text', () => {
    const navigate = vi.fn();
    generateAssessmentHandler(prefill, { navigate, utterance });
    expect(handleIdFrom(navigate.mock.calls[0][0] as string)).toMatch(/^[0-9a-f]+$/);
  });

  it('navigates WITHOUT a handle when the draft cannot be stored', () => {
    // Quota exhaustion and disabled storage are routine on the target devices.
    // A handle resolving to nothing would leave a dead parameter in the URL and
    // an empty form; the bare route is today's behaviour instead.
    vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const navigate = vi.fn();
    generateAssessmentHandler(prefill, { navigate, utterance });
    expect(navigate).toHaveBeenCalledWith(GENERATOR_ROUTE);
  });
});

describe('open_generator handler', () => {
  it('navigates to the module with no handle and writes nothing', () => {
    const navigate = vi.fn();
    openGeneratorHandler(
      { ...prefill, actionId: 'open_generator', effect: 'read', params: {}, provenance: {} },
      { navigate, utterance: 'open the generator' }
    );

    expect(navigate).toHaveBeenCalledWith(GENERATOR_ROUTE);
    expect(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });
});

describe('the handler map', () => {
  it('resolves every registered action', () => {
    expect(resolveHandler('generate_assessment')).toBe(generateAssessmentHandler);
    expect(resolveHandler('open_generator')).toBe(openGeneratorHandler);
  });

  it('returns null for an id this build has never heard of', () => {
    expect(resolveHandler('duplicate_assessment')).toBeNull();
    expect(resolveHandler('')).toBeNull();
  });

  it('does not resolve inherited Object properties', () => {
    expect(resolveHandler('constructor')).toBeNull();
    expect(resolveHandler('toString')).toBeNull();
  });

  it('maps a known domain to its home and nothing else', () => {
    expect(resolveDomainHome('generator')).toBe(GENERATOR_ROUTE);
    expect(resolveDomainHome('library')).toBeNull();
    expect(resolveDomainHome(null)).toBeNull();
    expect(resolveDomainHome(undefined)).toBeNull();
  });

  it('registers exactly the Phase 1 capability set', () => {
    // A third entry appearing here without a milestone behind it is scope creep,
    // and this is where a reviewer sees it.
    expect(REGISTERED_ACTION_IDS.sort()).toEqual(['generate_assessment', 'open_generator']);
    expect(REGISTERED_DOMAINS).toEqual(['generator']);
  });
});
