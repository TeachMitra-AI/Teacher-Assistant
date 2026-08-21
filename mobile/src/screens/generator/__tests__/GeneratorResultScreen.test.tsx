// Component tests for the Generator result/edit/save screen (Generator v2
// Stage 3 — docs/generator-v2-plan.md, docs/mobile-app-plan.md Phase 6).
// Covers both the structured-question path (schemaVersion 2, gated by
// STRUCTURED_QUESTIONS_ENABLED) and the legacy markdown-textarea fallback,
// matching this repo's established RNTL conventions (ResourceEditScreen.test.tsx):
// api/resources and useAuth are module-mocked, the header Save button is read
// directly off navigation.setOptions' headerRight() element rather than
// rendered, and render/fireEvent are awaited.
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { GeneratorResultScreen } from '../GeneratorResultScreen';

jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', name: 'Demo Teacher', email: 'teacher@example.com', role: 'teacher',
      preferences: {}, school: { id: 's1', name: 'Govt Primary School, Rampur', code: 'RAMPUR01' },
    },
  }),
}));

jest.mock('../../../api/resources', () => ({
  createResource: jest.fn(),
}));
const { createResource } = jest.requireMock('../../../api/resources') as { createResource: jest.Mock };

// STRUCTURED_QUESTIONS_ENABLED is read once at module load from an env var
// (mobile/src/config.ts) — mocking the config module directly, per this
// file's own per-test needs, is more reliable than juggling process.env
// across a shared jest module registry (matching the web test suite's own
// documented reason for mocking ../config rather than the env var directly).
jest.mock('../../../config', () => ({
  ...jest.requireActual('../../../config'),
  STRUCTURED_QUESTIONS_ENABLED: true,
}));

function makeNavigation() {
  // getParent() must return the SAME object on every call (React Navigation's
  // real behavior) — a fresh mock per call would give the component's
  // getParent().navigate(...) call and the test's own navigation.getParent()
  // two different jest.fn() instances, so a "was it called" assertion would
  // always fail against the wrong mock.
  const parent = { navigate: jest.fn() };
  return {
    addListener: jest.fn((_event: string, _callback: (event: unknown) => void) => jest.fn()),
    setOptions: jest.fn(),
    dispatch: jest.fn(),
    goBack: jest.fn(),
    getParent: jest.fn(() => parent),
  };
}

const BASE_PARAMS = {
  format: 'quiz' as const,
  grade: 'Class 6-8',
  subject: 'Mathematics',
  topic: 'Fractions',
  difficulty: 'medium' as const,
  questionType: 'mcq' as const,
  questionCount: 5,
  language: 'en',
};

async function renderScreen(params: Record<string, unknown>, navigation = makeNavigation()) {
  await render(
    <ThemeProvider>
      <GeneratorResultScreen
        navigation={navigation as never}
        route={{ key: 'g', name: 'GeneratorResult', params: { ...BASE_PARAMS, ...params } } as never}
      />
    </ThemeProvider>
  );
  return navigation;
}

function getSaveButton(navigation: ReturnType<typeof makeNavigation>) {
  const calls = navigation.setOptions.mock.calls;
  const last = calls[calls.length - 1][0];
  return last.headerRight();
}

const STRUCTURED = JSON.stringify({
  schemaVersion: 2,
  instructions: 'Answer all questions.',
  questions: [
    { id: 'q1', type: 'mcq', text: 'What is 1/2 + 1/2?', options: ['1', '2', '0', '1/4'], correctOptionIndex: 0 },
  ],
});

describe('GeneratorResultScreen — legacy (markdown) result', () => {
  beforeEach(() => {
    createResource.mockReset();
  });

  it('shows a default title and the generated content in Preview', async () => {
    await renderScreen({ content: '# Quiz: Fractions\n\nQ1. ...' });
    await waitFor(() => expect(screen.getByDisplayValue('Quiz: Fractions (Class 6-8)')).toBeTruthy());
  });

  it('never shows the QuestionListEditor for a legacy (no structured) result', async () => {
    await renderScreen({ content: 'Q1. What is 1/2 + 1/2?' });
    expect(screen.queryByText('No questions in this document.')).toBeNull();
    expect(screen.queryByText('No questions yet — add one below.')).toBeNull();
  });

  it('the Edit tab shows an editable textarea for the raw content', async () => {
    await renderScreen({ content: 'Q1. What is 1/2 + 1/2?' });
    await fireEvent.press(screen.getByText('Edit'));
    expect(screen.getByTestId('generator-content').props.value).toBe('Q1. What is 1/2 + 1/2?');
  });

  it('saving sends `content` and navigates to the Library edit screen for the new resource', async () => {
    createResource.mockResolvedValueOnce({ id: 'res1' });
    const navigation = await renderScreen({ content: 'Q1. What is 1/2 + 1/2?' });
    await waitFor(() => screen.getByDisplayValue('Quiz: Fractions (Class 6-8)'));

    await act(async () => {
      getSaveButton(navigation).props.onPress();
    });

    await waitFor(() => expect(createResource).toHaveBeenCalledWith(expect.objectContaining({
      type: 'assessment',
      title: 'Quiz: Fractions (Class 6-8)',
      grade: 'Class 6-8',
      subject: 'Mathematics',
      language: 'en',
      content: 'Q1. What is 1/2 + 1/2?',
    })));

    const parentNav = navigation.getParent();
    expect(parentNav.navigate).toHaveBeenCalledWith('LibraryTab', { screen: 'ResourceEdit', params: { resourceId: 'res1' } });
  });

  it('requires a title before saving', async () => {
    const navigation = await renderScreen({ content: 'c' });
    await waitFor(() => screen.getByDisplayValue('Quiz: Fractions (Class 6-8)'));
    await fireEvent.changeText(screen.getByTestId('generator-title'), '   ');

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => {
      getSaveButton(navigation).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Title required', 'Please enter a title.');
    expect(createResource).not.toHaveBeenCalled();
  });

  it('warns before leaving an unsaved result', async () => {
    const navigation = await renderScreen({ content: 'c' });
    await waitFor(() => screen.getByDisplayValue('Quiz: Fractions (Class 6-8)'));

    const handler = navigation.addListener.mock.calls.find((c) => c[0] === 'beforeRemove')![1];
    const preventDefault = jest.fn();
    const fakeEvent = { preventDefault, data: { action: { type: 'GO_BACK' } } };

    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Discard')?.onPress?.();
    });

    handler(fakeEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(navigation.dispatch).toHaveBeenCalledWith(fakeEvent.data.action);
  });

  it('does not warn on leaving after a successful save', async () => {
    createResource.mockResolvedValueOnce({ id: 'res1' });
    const navigation = await renderScreen({ content: 'c' });
    await waitFor(() => screen.getByDisplayValue('Quiz: Fractions (Class 6-8)'));

    await act(async () => {
      getSaveButton(navigation).props.onPress();
    });
    await waitFor(() => expect(createResource).toHaveBeenCalled());

    const handler = navigation.addListener.mock.calls.find((c) => c[0] === 'beforeRemove')![1];
    const preventDefault = jest.fn();
    handler({ preventDefault, data: { action: { type: 'GO_BACK' } } });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('GeneratorResultScreen — structured-question result', () => {
  beforeEach(() => {
    createResource.mockReset();
  });

  it('shows the QuestionListEditor instead of the markdown textarea when structured is present', async () => {
    await renderScreen({ content: 'ignored-legacy-rendering', structured: STRUCTURED });
    await fireEvent.press(screen.getByText('Edit'));
    expect(screen.getByLabelText('Question 1 text')).toBeTruthy();
    expect(screen.queryByTestId('generator-content')).toBeNull();
  });

  it('editing a question, adding one, and deleting one all update the in-memory document', async () => {
    await renderScreen({ content: 'x', structured: STRUCTURED });
    await fireEvent.press(screen.getByText('Edit'));

    await fireEvent.changeText(screen.getByLabelText('Question 1 text'), 'Updated question text');
    expect(screen.getByDisplayValue('Updated question text')).toBeTruthy();

    await fireEvent.press(screen.getByText('Add question'));
    expect(screen.getByLabelText('Question 2 text')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Delete question 2'));
    expect(screen.queryByLabelText('Question 2 text')).toBeNull();
  });

  it('blocks saving with a validation error when a question is incomplete', async () => {
    const navigation = await renderScreen({ content: 'x', structured: STRUCTURED });
    await fireEvent.press(screen.getByText('Edit'));
    // Clear the only MCQ option's text, making the question invalid.
    await fireEvent.changeText(screen.getByLabelText('Question 1 option A'), '');

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => {
      getSaveButton(navigation).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Fix questions', 'Fix the highlighted questions before saving.');
    expect(createResource).not.toHaveBeenCalled();
  });

  it('saving sends the structured payload and omits `content` (the server re-renders it)', async () => {
    createResource.mockResolvedValueOnce({ id: 'res2' });
    const navigation = await renderScreen({ content: 'ignored', structured: STRUCTURED });
    await waitFor(() => screen.getByDisplayValue('Quiz: Fractions (Class 6-8)'));

    await act(async () => {
      getSaveButton(navigation).props.onPress();
    });

    await waitFor(() => expect(createResource).toHaveBeenCalled());
    const payload = createResource.mock.calls[0][0];
    expect(payload.content).toBeUndefined();
    expect(JSON.parse(payload.structured).schemaVersion).toBe(2);
    expect(JSON.parse(payload.structured).questions).toHaveLength(1);
  });

  it('blocks saving when every question has been deleted', async () => {
    const navigation = await renderScreen({ content: 'x', structured: STRUCTURED });
    await fireEvent.press(screen.getByText('Edit'));
    await fireEvent.press(screen.getByLabelText('Delete question 1'));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => {
      getSaveButton(navigation).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Add a question', 'Add at least one question before saving.');
    expect(createResource).not.toHaveBeenCalled();
  });
});
