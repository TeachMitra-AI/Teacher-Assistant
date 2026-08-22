// Structured Question Model (Generator v2) behavior — a SEPARATE file from
// GeneratorPage.test.tsx because STRUCTURED_QUESTIONS_ENABLED is a top-level
// `const` computed once from import.meta.env when config.ts first loads;
// vi.stubEnv after that point can't retroactively change an already-evaluated
// constant. Forcing it true belongs in this file's own `vi.mock('../config')`
// (hoisted, applies to every test in this file), not in a per-test env stub —
// see docs/generator-v2-plan.md's Stage 2 notes for this exact gotcha.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import GeneratorPage from './GeneratorPage';
import * as resourcesLib from '../lib/resources';
import * as configLib from '../config';

vi.mock('../components/TopBar', () => ({ default: () => null }));

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', name: 'Demo Teacher', email: 't@example.com', role: 'teacher',
      school: { id: 's1', name: 'Test School', code: 'TS01' },
      preferences: { onboarding: { dismissedTips: ['generator-intro'] }, examPaperDefaults: {} },
    },
  }),
}));

const showToast = vi.fn();
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: showToast }) }));

vi.mock('../lib/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof resourcesLib>();
  return { ...actual, generateAssessment: vi.fn(), createResource: vi.fn() };
});

vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof configLib>();
  return { ...actual, STRUCTURED_QUESTIONS_ENABLED: true };
});

const mockedResources = vi.mocked(resourcesLib);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/generator']}>
      <GeneratorPage preferences={{} as never} />
    </MemoryRouter>
  );
}

async function fillAndGenerate(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Topic (required)'), 'Fractions');
  await user.click(screen.getByRole('button', { name: /generate/i }));
}

const structuredResult = (questions: unknown[]) => ({
  content: '# Quiz: Fractions\n\n## Instructions\n\nAnswer all questions.\n\n## Questions\n\n...\n\n## Answer Key\n\n...',
  structured: JSON.stringify({
    schemaVersion: 2,
    instructions: 'Answer all questions carefully.',
    questions,
  }),
  requestId: 'r1',
});

const mcqWire = { type: 'mcq', text: 'What is 1/2 + 1/2?', options: ['0', '1', '2', '1/4'], correctOptionIndex: 1 };
const trueFalseWire = { type: 'true_false', text: '1/2 is bigger than 1/4.', correctAnswer: 'True' };
const shortAnswerWire = { type: 'short_answer', text: 'Define a fraction.', correctAnswer: 'A part of a whole.' };
const descriptiveWire = { type: 'descriptive', text: 'Explain equivalent fractions.', modelAnswer: 'They represent the same value.' };
const fillBlankWire = { type: 'fill_blank', text: 'A fraction with numerator 0 equals ___.', correctAnswer: '0' };
const matchWire = {
  type: 'match', text: 'Match the fraction to its decimal.',
  pairs: [{ left: '1/2', right: '0.5' }, { left: '1/4', right: '0.25' }, { left: '3/4', right: '0.75' }],
};

beforeEach(() => {
  showToast.mockClear();
});

describe('GeneratorPage — structured mode (STRUCTURED_QUESTIONS_ENABLED on)', () => {
  test('all 6 question types render as individual editable cards in the Edit tab', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(
      structuredResult([mcqWire, trueFalseWire, shortAnswerWire, descriptiveWire, fillBlankWire, matchWire])
    );
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /edit/i }));

    expect(screen.getByLabelText('Question 1 text')).toHaveValue('What is 1/2 + 1/2?');
    expect(screen.getByLabelText('Question 2 text')).toHaveValue('1/2 is bigger than 1/4.');
    expect(screen.getByLabelText('Question 3 text')).toHaveValue('Define a fraction.');
    expect(screen.getByLabelText('Question 4 text')).toHaveValue('Explain equivalent fractions.');
    expect(screen.getByLabelText('Question 5 text')).toHaveValue('A fraction with numerator 0 equals ___.');
    expect(screen.getByLabelText('Question 6 text')).toHaveValue('Match the fraction to its decimal.');
    // No legacy markdown textarea in structured mode.
    expect(screen.queryByLabelText('Generated content')).not.toBeInTheDocument();
  });

  test('Preview tab renders every question read-only, including the instructions line', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(structuredResult([mcqWire, matchWire]));
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByText('Answer all questions carefully.')).toBeInTheDocument());
    expect(screen.getByText('What is 1/2 + 1/2?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Question 1 text')).not.toBeInTheDocument(); // read-only, no inputs
  });

  test('deleting a question removes its card', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(structuredResult([mcqWire, trueFalseWire]));
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /edit/i }));
    await user.click(screen.getByLabelText('Delete question 2'));

    expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument();
    expect(screen.queryByLabelText('Question 2 text')).not.toBeInTheDocument();
  });

  test('reordering moves a question and renumbers correctly', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(structuredResult([mcqWire, trueFalseWire]));
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /edit/i }));
    await user.click(screen.getByLabelText('Move question 1 down'));

    expect(screen.getByLabelText('Question 1 text')).toHaveValue('1/2 is bigger than 1/4.');
    expect(screen.getByLabelText('Question 2 text')).toHaveValue('What is 1/2 + 1/2?');
  });

  test('adding a question appends a new card of the chosen type', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(structuredResult([mcqWire]));
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /edit/i }));
    await user.selectOptions(screen.getByLabelText('New question type'), 'descriptive');
    await user.click(screen.getByText('Add question'));

    expect(screen.getByLabelText('Question 2 text')).toBeInTheDocument();
  });

  test('save blocks and shows a toast when a question is invalid, and never calls createResource', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(structuredResult([{ ...shortAnswerWire, correctAnswer: '' }]));
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Assessment title'), 'My Quiz');
    await user.click(screen.getByRole('button', { name: /save to library/i }));

    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/fix the highlighted questions/i), 'error');
    expect(mockedResources.createResource).not.toHaveBeenCalled();
  });

  test('save with valid questions sends structured.questions and omits `content`', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(structuredResult([mcqWire, trueFalseWire]));
    mockedResources.createResource.mockResolvedValue({ id: 'saved1' } as never);
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Assessment title'), 'My Quiz');
    await user.click(screen.getByRole('button', { name: /save to library/i }));

    await waitFor(() => expect(mockedResources.createResource).toHaveBeenCalled());
    const call = mockedResources.createResource.mock.calls[0][0];
    expect(call.content).toBeUndefined();
    const structured = JSON.parse(call.structured!);
    expect(structured.schemaVersion).toBe(2);
    expect(structured.questions).toHaveLength(2);
    expect(structured.questions[0].text).toBe(mcqWire.text);
  });

  test('save is blocked with an empty question list', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(structuredResult([mcqWire]));
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /edit/i }));
    await user.click(screen.getByLabelText('Delete question 1'));
    await user.type(screen.getByLabelText('Assessment title'), 'My Quiz');
    await user.click(screen.getByRole('button', { name: /save to library/i }));

    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/add at least one question/i), 'error');
    expect(mockedResources.createResource).not.toHaveBeenCalled();
  });

  test('regenerating after editing a question asks for confirmation', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(structuredResult([mcqWire]));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /edit/i }));
    await user.click(screen.getByLabelText('Delete question 1'));

    await user.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

