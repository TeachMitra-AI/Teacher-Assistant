// Library integration for the Structured Question Model (docs/generator-v2-plan.md). Unlike GeneratorPage, structured mode here
// depends only on the loaded resource's own `structured.schemaVersion`, not a client flag (a structured resource stays editable
// even if the flag that created it is later turned off), so no config mocking is needed.
import { describe, expect, test, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import ResourceWorkspace from './ResourceWorkspace';
import * as resourcesLib from '../lib/resources';
import type { LibraryResource } from '../types';

// A data router builds a fetch `Request` for every real navigation. Under jsdom its AbortController produces a jsdom AbortSignal, which Node's
// built-in Request rejects ("Expected signal to be an instance of AbortSignal"). This test-only shim keeps the signal the router passed in.
const NativeRequest = globalThis.Request;
beforeAll(() => {
  globalThis.Request = class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal, ...rest } = init ?? {};
      super(input, rest);
      if (signal) Object.defineProperty(this, 'signal', { value: signal });
    }
  } as typeof Request;
});
afterAll(() => {
  globalThis.Request = NativeRequest;
});

vi.mock('../components/TopBar', () => ({ default: () => null }));

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', name: 'Demo Teacher', email: 't@example.com', role: 'teacher',
      school: { id: 's1', name: 'Test School', code: 'TS01' },
      preferences: { onboarding: { dismissedTips: ['workspace-intro', 'ai-assist-intro'] }, examPaperDefaults: {} },
    },
  }),
}));

const showToast = vi.fn();
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: showToast }) }));

vi.mock('../lib/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof resourcesLib>();
  return { ...actual, getResource: vi.fn(), updateResource: vi.fn(), runAiAction: vi.fn() };
});

const mockedResources = vi.mocked(resourcesLib);

// A data router (not MemoryRouter): the Workspace uses useBlocker, which only works under one. The extra routes are targets to navigate to.
function renderWorkspace(id = 'r1', initialEntries = [`/library/${id}/edit`]) {
  const router = createMemoryRouter(
    [
      { path: '/library/:id/edit', element: <ResourceWorkspace preferences={{} as never} /> },
      { path: '/generator', element: <p>Generator page</p> },
      { path: '/library', element: <p>Library page</p> },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 }
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

function structuredResource(overrides: Partial<LibraryResource> = {}): LibraryResource {
  return {
    id: 'r1',
    type: 'assessment',
    title: 'Fractions Quiz',
    grade: 'Class 5',
    subject: 'Maths',
    language: 'en',
    content: '# Maths Quiz: Fractions\n\n## Questions\n\n1. What is 1/2 + 1/2?\n\n## Answer Key\n\n1. 1',
    structured: JSON.stringify({
      schemaVersion: 2,
      format: 'quiz', topic: 'Fractions', grade: 'Class 5', subject: 'Maths', difficulty: 'medium',
      instructions: 'Answer all questions carefully.',
      questions: [
        { type: 'mcq', text: 'What is 1/2 + 1/2?', options: ['0', '1', '2', '1/4'], correctOptionIndex: 1 },
        { type: 'true_false', text: '1/2 is bigger than 1/4.', correctAnswer: 'True' },
      ],
    }),
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function legacyResource(overrides: Partial<LibraryResource> = {}): LibraryResource {
  return {
    id: 'r2',
    type: 'lesson_plan',
    title: 'Photosynthesis',
    grade: 'Class 6',
    subject: 'Science',
    language: 'en',
    content: '## Objectives\nExplain photosynthesis.',
    structured: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  showToast.mockClear();
});

describe('ResourceWorkspace — structured resource (schemaVersion 2)', () => {
  test('loads and shows each question as an individual editable card', async () => {
    mockedResources.getResource.mockResolvedValue(structuredResource());
    renderWorkspace();

    await waitFor(() => expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument());
    expect(screen.getByLabelText('Question 1 text')).toHaveValue('What is 1/2 + 1/2?');
    expect(screen.getByLabelText('Question 2 text')).toHaveValue('1/2 is bigger than 1/4.');
    expect(screen.queryByLabelText('Resource content')).not.toBeInTheDocument(); // no legacy textarea
  });

  test('Preview tab renders every question read-only, with the instructions line', async () => {
    mockedResources.getResource.mockResolvedValue(structuredResource());
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('tab', { name: /preview/i }));
    expect(screen.getByText('Answer all questions carefully.')).toBeInTheDocument();
    // Two matches expected: the visible structured Preview and the always-present (aria-hidden) print document, which renders the plain `content` string on its own.
    expect(screen.getAllByText('What is 1/2 + 1/2?').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText('Question 1 text')).not.toBeInTheDocument();
  });

  test('deleting a question, then saving, sends the reduced structured.questions array', async () => {
    const user = userEvent.setup();
    mockedResources.getResource.mockResolvedValue(structuredResource());
    mockedResources.updateResource.mockResolvedValue(structuredResource());
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Delete question 2'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockedResources.updateResource).toHaveBeenCalled());
    const [, patch] = mockedResources.updateResource.mock.calls[0];
    const structured = JSON.parse(patch.structured!);
    expect(structured.questions).toHaveLength(1);
    expect(structured.questions[0].text).toBe('What is 1/2 + 1/2?');
    expect(patch.content).toBeUndefined(); // server re-renders content from structured
  });

  test('reordering questions and saving sends them in the new order', async () => {
    const user = userEvent.setup();
    mockedResources.getResource.mockResolvedValue(structuredResource());
    mockedResources.updateResource.mockResolvedValue(structuredResource());
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Move question 1 down'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockedResources.updateResource).toHaveBeenCalled());
    const [, patch] = mockedResources.updateResource.mock.calls[0];
    const structured = JSON.parse(patch.structured!);
    expect(structured.questions[0].text).toBe('1/2 is bigger than 1/4.');
    expect(structured.questions[1].text).toBe('What is 1/2 + 1/2?');
  });

  test('Save Changes is disabled until something changes, matching the legacy dirty-check contract', async () => {
    mockedResources.getResource.mockResolvedValue(structuredResource());
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  test('save blocks on an invalid question and never calls updateResource', async () => {
    const user = userEvent.setup();
    mockedResources.getResource.mockResolvedValue(structuredResource());
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Question 1 type'), 'fill_blank');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/fix the highlighted questions/i), 'error');
    expect(mockedResources.updateResource).not.toHaveBeenCalled();
  });

  test('save reloads the workspace from the server response (save + reload round trip)', async () => {
    const user = userEvent.setup();
    mockedResources.getResource.mockResolvedValue(structuredResource());
    const saved = structuredResource({ title: 'Fractions Quiz (saved)' });
    mockedResources.updateResource.mockResolvedValue(saved);
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Delete question 2'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled());
    expect(showToast).toHaveBeenCalledWith('Changes saved', 'success');
  });

  test('applying an assessment AI-assist suggestion updates the question cards from the response', async () => {
    const user = userEvent.setup();
    mockedResources.getResource.mockResolvedValue(structuredResource());
    mockedResources.runAiAction.mockResolvedValue({
      suggestion: '# Maths Quiz: Fractions\n\n## Questions\n\n1. Harder Q?\n\n## Answer Key\n\n1. X',
      structured: JSON.stringify({
        schemaVersion: 2, format: 'quiz', topic: 'Fractions', grade: 'Class 5', subject: 'Maths', difficulty: 'medium',
        instructions: 'Answer all questions carefully, showing your reasoning.',
        questions: [{ type: 'short_answer', text: 'Harder Q?', correctAnswer: 'X' }],
      }),
      requestId: 'r1',
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /make harder/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /apply to editor/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /apply to editor/i }));

    expect(screen.getByLabelText('Question 1 text')).toHaveValue('Harder Q?');
    expect(screen.queryByLabelText('Question 2 text')).not.toBeInTheDocument();
  });
});

describe('ResourceWorkspace — legacy resource (no schemaVersion)', () => {
  test('renders the flat markdown textarea/preview, exactly as before this feature existed', async () => {
    mockedResources.getResource.mockResolvedValue(legacyResource());
    renderWorkspace('r2');

    await waitFor(() => expect(screen.getByLabelText('Resource content')).toBeInTheDocument());
    expect(screen.getByLabelText('Resource content')).toHaveValue('## Objectives\nExplain photosynthesis.');
    expect(screen.queryByLabelText('New question type')).not.toBeInTheDocument();
  });

  test('editing the textarea and saving sends plain `content`, no `structured.questions`', async () => {
    const user = userEvent.setup();
    mockedResources.getResource.mockResolvedValue(legacyResource());
    mockedResources.updateResource.mockResolvedValue(legacyResource());
    renderWorkspace('r2');
    await waitFor(() => expect(screen.getByLabelText('Resource content')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Resource content'), '!');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockedResources.updateResource).toHaveBeenCalled());
    const [, patch] = mockedResources.updateResource.mock.calls[0];
    expect(patch.content).toBe('## Objectives\nExplain photosynthesis.!');
    expect(patch.structured).toBeUndefined();
  });

  describe('leaving with unsaved edits (useBlocker)', () => {
    const MESSAGE = 'You have unsaved changes. Leave without saving?';

    async function openAndEdit(entries?: string[]) {
      mockedResources.getResource.mockResolvedValue(legacyResource());
      const view = renderWorkspace('r2', entries);
      await waitFor(() => expect(screen.getByLabelText('Resource content')).toBeInTheDocument());
      await userEvent.type(screen.getByLabelText('Resource content'), '!');
      return view;
    }

    test('declining the prompt keeps the teacher on the page with their edits', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { router } = await openAndEdit();

      await act(async () => { await router.navigate('/generator'); });

      expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
      expect(router.state.location.pathname).toBe('/library/r2/edit');
      expect(screen.getByLabelText('Resource content')).toHaveValue('## Objectives\nExplain photosynthesis.!');
      expect(screen.queryByText('Generator page')).not.toBeInTheDocument();
    });

    test('accepting the prompt navigates away', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { router } = await openAndEdit();

      await act(async () => { await router.navigate('/generator'); });

      expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
      expect(router.state.location.pathname).toBe('/generator');
      expect(screen.getByText('Generator page')).toBeInTheDocument();
    });

    test('a clean workspace navigates without any prompt', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      mockedResources.getResource.mockResolvedValue(legacyResource());
      const { router } = renderWorkspace('r2');
      await waitFor(() => expect(screen.getByLabelText('Resource content')).toBeInTheDocument());

      await act(async () => { await router.navigate('/generator'); });

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(screen.getByText('Generator page')).toBeInTheDocument();
    });

    test('the browser Back button is guarded too', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { router } = await openAndEdit(['/library', '/library/r2/edit']);

      await act(async () => { await router.navigate(-1); });

      expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
      expect(router.state.location.pathname).toBe('/library/r2/edit');
    });

    test('a query-string-only change does not prompt', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      const { router } = await openAndEdit();

      await act(async () => { await router.navigate('/library/r2/edit?tab=preview'); });

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(router.state.location.pathname).toBe('/library/r2/edit');
    });

    test('after a successful Save the edits are no longer unsaved, so leaving does not prompt', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      const saved = legacyResource({ content: '## Objectives\nExplain photosynthesis.!' });
      mockedResources.updateResource.mockResolvedValue(saved);
      const { router } = await openAndEdit();

      await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => expect(mockedResources.updateResource).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled());

      await act(async () => { await router.navigate('/generator'); });

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(router.state.location.pathname).toBe('/generator');
    });

    test('a failed Save leaves the edits unsaved, so leaving still prompts', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      mockedResources.updateResource.mockRejectedValue(new Error('network down'));
      const { router } = await openAndEdit();

      await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => expect(mockedResources.updateResource).toHaveBeenCalled());

      await act(async () => { await router.navigate('/generator'); });

      expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
      expect(router.state.location.pathname).toBe('/library/r2/edit');
    });
  });

  test('an assessment with a `structured` blob that has no schemaVersion (pre-Stage-1 style) also falls back to legacy', async () => {
    mockedResources.getResource.mockResolvedValue(structuredResource({
      structured: JSON.stringify({ format: 'quiz', difficulty: 'medium', questionType: 'mixed', questionCount: 2, topic: 'Fractions' }),
    }));
    renderWorkspace();

    await waitFor(() => expect(screen.getByLabelText('Resource content')).toBeInTheDocument());
    expect(screen.queryByLabelText('New question type')).not.toBeInTheDocument();
  });
});
