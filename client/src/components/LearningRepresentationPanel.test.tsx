// Finding #7: a malformed Learning Representation payload from Gemini must
// not crash the whole page — only the one card that received it.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LearningRepresentationPanel from './LearningRepresentationPanel';
import * as learningRepresentationLib from '../lib/learningRepresentation';
import type { GraphChartData, LabeledDiagramData, LearningRepresentationResponse } from '../types';

vi.mock('../lib/learningRepresentation', () => ({ fetchLearningRepresentation: vi.fn() }));

const mockedFetch = vi.mocked(learningRepresentationLib.fetchLearningRepresentation);

// Realistic malformed payload: `series` missing entirely. GraphChartView's
// mergeSeries() does `for (const s of series)` with no guard, so this throws
// a real TypeError during render — not a synthetic/simulated error.
const MALFORMED_CHART = { chartType: 'bar', xLabel: 'Month', yLabel: 'Sales' } as unknown as GraphChartData;

function malformedResponse(requestId = 'r1'): LearningRepresentationResponse {
  return { requestId, representation: 'graph_chart', data: MALFORMED_CHART };
}

// The "sibling card renders fine" case deliberately uses a different,
// recharts-free view (labeled_diagram) rather than a second graph_chart:
// recharts' <ResponsiveContainer> needs a real ResizeObserver, which jsdom
// doesn't provide — an environment limitation of testing that component at
// all, unrelated to what this file is verifying (isolation between cards).
const VALID_PARTS: LabeledDiagramData = { parts: [{ label: 'Nucleus', description: 'Controls the cell' }] };
function validResponse(requestId = 'r2'): LearningRepresentationResponse {
  return { requestId, representation: 'labeled_diagram', data: VALID_PARTS };
}

describe('LearningRepresentationPanel — per-card error isolation', () => {
  test('a malformed AI payload shows the safe fallback for that card, without crashing, and never renders raw error/JSON details', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedFetch.mockResolvedValueOnce(malformedResponse());
    render(<LearningRepresentationPanel query="q" answer="a" />);

    await userEvent.click(screen.getByRole('button', { name: /view as visual/i }));

    expect(await screen.findByText('Could not display this content.')).toBeInTheDocument();
    const bodyText = document.body.textContent ?? '';
    // No stack trace and no leaked payload content/data values.
    expect(bodyText).not.toMatch(/\.tsx:\d|at Object\.|"chartType"|"xLabel"/i);
    errorSpy.mockRestore();
  });

  test('one card throwing does not take down a sibling card on the same page — the valid one still renders normally', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedFetch
      .mockResolvedValueOnce(malformedResponse('bad'))
      .mockResolvedValueOnce(validResponse('good'));

    render(
      <>
        <div data-testid="card-bad"><LearningRepresentationPanel query="q1" answer="a1" /></div>
        <div data-testid="card-good"><LearningRepresentationPanel query="q2" answer="a2" /></div>
      </>
    );

    const [badButton, goodButton] = screen.getAllByRole('button', { name: /view as visual/i });
    await userEvent.click(badButton);
    await userEvent.click(goodButton);

    expect(await within(screen.getByTestId('card-bad')).findByText('Could not display this content.')).toBeInTheDocument();
    // The valid card renders its real content — proof the whole page (and
    // this second, unrelated card) survived the first card's crash.
    expect(await within(screen.getByTestId('card-good')).findByText('Nucleus')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });

  test('componentDidCatch logs only a safe message, never the raw Gemini payload or a stack trace', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedFetch.mockResolvedValueOnce(malformedResponse());
    render(<LearningRepresentationPanel query="q" answer="a" />);
    await userEvent.click(screen.getByRole('button', { name: /view as visual/i }));
    await screen.findByText('Could not display this content.');

    const appLog = errorSpy.mock.calls.find((call) => call[0] === '[app] uncaught_render_error');
    expect(appLog).toBeTruthy();
    expect(typeof appLog?.[1]).toBe('string');
    // A plain string, short, and with no embedded newlines/stack frames or
    // JSON-shaped payload content — just the JS engine's own error message.
    expect(appLog?.[1]).not.toMatch(/\n|\.tsx:\d|"chartType"|"xLabel"/i);
    errorSpy.mockRestore();
  });
});
