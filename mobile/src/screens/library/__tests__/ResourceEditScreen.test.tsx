// Component tests for the Phase 5 Library edit ("workspace") screen
// (docs/mobile-app-plan.md §26 Phase 5 — matches ResourceWorkspace.tsx's
// dirty-check/save, AI Assist preview/apply, and export flow). api/resources.ts
// is mocked; useAuth is mocked directly (this suite is about the workspace's
// own behavior, not auth).
//
// The Save/Export buttons live in the native-stack header (set via
// navigation.setOptions({ headerRight })), which isn't mounted by the test
// renderer (there's no real navigator here). Rather than mounting a second,
// separate render tree for the header element (which was found to disturb
// the main tree's own fireEvent handling under this React/RNTL version),
// tests read the headerRight() React element's props directly — `disabled`
// and `onPress` are plain props on our own JSX, so no rendering is needed to
// inspect or invoke them.
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as Print from 'expo-print';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ResourceEditScreen } from '../ResourceEditScreen';

jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', name: 'Demo Teacher', email: 'teacher@example.com', role: 'teacher',
      preferences: {}, school: { id: 's1', name: 'Govt Primary School, Rampur', code: 'RAMPUR01' },
    },
  }),
}));

jest.mock('../../../api/resources', () => ({
  getResource: jest.fn(),
  updateResource: jest.fn(),
  runAiAction: jest.fn(),
}));
const { getResource, updateResource, runAiAction } = jest.requireMock('../../../api/resources') as {
  getResource: jest.Mock;
  updateResource: jest.Mock;
  runAiAction: jest.Mock;
};

const RESOURCE = {
  id: 'res1',
  type: 'lesson_plan' as const,
  title: 'Photosynthesis Lesson',
  grade: 'Class 6-8',
  subject: 'Science',
  language: 'en',
  content: 'Explain how plants make food.',
  structured: null,
  sourceQueryId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const ASSESSMENT = {
  ...RESOURCE,
  id: 'res2',
  type: 'assessment' as const,
  title: 'Fractions Quiz',
  content: '## Instructions\n\nAnswer all.\n\n## Questions\n\n1. What is 1/2 + 1/2?\n\n## Answer Key\n\n1. 1',
};

// A structured (Generator v2, schemaVersion 2) assessment — the Library
// reopen/continue-editing path (docs/generator-v2-plan.md). No
// STRUCTURED_QUESTIONS_ENABLED flag involved: the screen decides structured
// vs. legacy purely from `resource.structured`'s own schemaVersion.
const STRUCTURED_ASSESSMENT = {
  ...RESOURCE,
  id: 'res3',
  type: 'assessment' as const,
  title: 'Fractions Quiz (structured)',
  content: '# Fractions Quiz\n\n1. What is 1/2 + 1/2?\n   A) 1  B) 2  C) 0  D) 1/4\n',
  structured: JSON.stringify({
    schemaVersion: 2,
    instructions: 'Answer all questions.',
    format: 'quiz',
    topic: 'Fractions',
    grade: 'Class 6-8',
    subject: 'Mathematics',
    difficulty: 'medium',
    questionType: 'mcq',
    questionCount: 1,
    questions: [
      { id: 'q1', type: 'mcq', text: 'What is 1/2 + 1/2?', options: ['1', '2', '0', '1/4'], correctOptionIndex: 0 },
    ],
  }),
};

function makeNavigation() {
  return {
    addListener: jest.fn((_event: string, _callback: (event: unknown) => void) => jest.fn()),
    setOptions: jest.fn(),
    dispatch: jest.fn(),
    goBack: jest.fn(),
  };
}

async function renderScreen(resourceId = 'res1', navigation = makeNavigation()) {
  await render(
    <ThemeProvider>
      <ResourceEditScreen
        navigation={navigation as never}
        route={{ key: 'r', name: 'ResourceEdit', params: { resourceId } } as never}
      />
    </ThemeProvider>
  );
  return navigation;
}

// Reads the Save/Export button elements out of the most recent
// navigation.setOptions({ headerRight }) call, without rendering them.
function getHeaderButtons(navigation: ReturnType<typeof makeNavigation>) {
  const calls = navigation.setOptions.mock.calls;
  const last = calls[calls.length - 1][0];
  const headerElement = last.headerRight();
  const [exportBtn, saveBtn] = headerElement.props.children;
  return { exportBtn, saveBtn };
}

describe('ResourceEditScreen', () => {
  beforeEach(() => {
    getResource.mockReset();
    updateResource.mockReset();
    runAiAction.mockReset();
    (Print.printToFileAsync as jest.Mock).mockClear();
  });

  it('loads the resource into the form fields', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    await act(async () => {
      await renderScreen();
    });
    await waitFor(() => expect(screen.getByDisplayValue('Photosynthesis Lesson')).toBeTruthy());
    expect(screen.getByDisplayValue('Explain how plants make food.')).toBeTruthy();
  });

  it('the header Save button is disabled until a field is actually changed', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    const navigation = makeNavigation();
    await act(async () => {
      await renderScreen('res1', navigation);
    });
    await waitFor(() => screen.getByDisplayValue('Photosynthesis Lesson'));

    expect(getHeaderButtons(navigation).saveBtn.props.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('workspace-title'), 'Photosynthesis Lesson (revised)');
    await waitFor(() => expect(getHeaderButtons(navigation).saveBtn.props.disabled).toBe(false));
  });

  it('saves only the changed fields as a PATCH', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    updateResource.mockResolvedValueOnce({ ...RESOURCE, title: 'New Title' });
    const navigation = makeNavigation();
    await act(async () => {
      await renderScreen('res1', navigation);
    });
    await waitFor(() => screen.getByDisplayValue('Photosynthesis Lesson'));

    await fireEvent.changeText(screen.getByTestId('workspace-title'), 'New Title');
    await waitFor(() => expect(getHeaderButtons(navigation).saveBtn.props.disabled).toBe(false));

    await act(async () => {
      getHeaderButtons(navigation).saveBtn.props.onPress();
    });

    await waitFor(() => expect(updateResource).toHaveBeenCalledWith('res1', { title: 'New Title' }));
  });

  it('running an AI Assist action shows a suggestion the teacher can apply', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    runAiAction.mockResolvedValueOnce({ suggestion: 'A much simpler explanation.', requestId: 'r1' });
    await act(async () => {
      await renderScreen();
    });
    await waitFor(() => screen.getByDisplayValue('Photosynthesis Lesson'));

    await fireEvent.press(screen.getByTestId('ai-action-simplify'));
    await waitFor(() => expect(runAiAction).toHaveBeenCalledWith('res1', 'simplify', { targetGrade: undefined }));

    await waitFor(() => expect(screen.getByText('A much simpler explanation.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Apply to editor'));

    await waitFor(() => expect(screen.getByDisplayValue('A much simpler explanation.')).toBeTruthy());
  });

  it('does not persist an applied suggestion until Save is pressed', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    runAiAction.mockResolvedValueOnce({ suggestion: 'A much simpler explanation.', requestId: 'r1' });
    await act(async () => {
      await renderScreen();
    });
    await waitFor(() => screen.getByDisplayValue('Photosynthesis Lesson'));
    await fireEvent.press(screen.getByTestId('ai-action-simplify'));
    await waitFor(() => screen.getByText('A much simpler explanation.'));
    await fireEvent.press(screen.getByText('Apply to editor'));
    await waitFor(() => screen.getByDisplayValue('A much simpler explanation.'));

    expect(updateResource).not.toHaveBeenCalled();
  });

  it('exports an assessment with the exam-paper letterhead via the header export button, offering a student/teacher choice', async () => {
    getResource.mockResolvedValueOnce(ASSESSMENT);
    const navigation = makeNavigation();
    await act(async () => {
      await renderScreen('res2', navigation);
    });
    await waitFor(() => expect(screen.getAllByDisplayValue('Fractions Quiz').length).toBeGreaterThan(0));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Teacher version')?.onPress?.();
    });

    await act(async () => {
      getHeaderButtons(navigation).exportBtn.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith('Export as…', undefined, expect.any(Array));
    await waitFor(() => expect(Print.printToFileAsync).toHaveBeenCalledTimes(1));
    expect((Print.printToFileAsync as jest.Mock).mock.calls[0][0].html).toContain('class="exam-header"');
  });

  it('warns before leaving with unsaved changes', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    const navigation = makeNavigation();
    await act(async () => {
      await renderScreen('res1', navigation);
    });
    await waitFor(() => screen.getByDisplayValue('Photosynthesis Lesson'));
    await fireEvent.changeText(screen.getByTestId('workspace-title'), 'Changed Title');
    await waitFor(() => expect(getHeaderButtons(navigation).saveBtn.props.disabled).toBe(false));

    // The effect re-registers 'beforeRemove' whenever `dirty` changes (it's
    // a dep), so take the LAST registration — the one closing over the
    // post-edit dirty=true state — not the first (registered dirty=false).
    const beforeRemoveCalls = navigation.addListener.mock.calls.filter((c) => c[0] === 'beforeRemove');
    const handler = beforeRemoveCalls[beforeRemoveCalls.length - 1][1];
    const preventDefault = jest.fn();
    const fakeEvent = { preventDefault, data: { action: { type: 'GO_BACK' } } };

    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Leave')?.onPress?.();
    });

    handler(fakeEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(navigation.dispatch).toHaveBeenCalledWith(fakeEvent.data.action);
  });
});

describe('ResourceEditScreen — structured-question resource (Generator v2 reopen/continue-editing)', () => {
  beforeEach(() => {
    getResource.mockReset();
    updateResource.mockReset();
    runAiAction.mockReset();
  });

  it('shows the QuestionListEditor instead of the flat textarea for a structured resource', async () => {
    getResource.mockResolvedValueOnce(STRUCTURED_ASSESSMENT);
    await act(async () => {
      await renderScreen('res3');
    });
    await waitFor(() => expect(screen.getByLabelText('Question 1 text')).toBeTruthy());
    expect(screen.queryByTestId('workspace-content')).toBeNull();
  });

  it('a legacy assessment (no schemaVersion) still shows the flat textarea, unchanged', async () => {
    getResource.mockResolvedValueOnce(ASSESSMENT);
    await act(async () => {
      await renderScreen('res2');
    });
    await waitFor(() => expect(screen.getByTestId('workspace-content')).toBeTruthy());
    expect(screen.queryByLabelText('Question 1 text')).toBeNull();
  });

  it('editing a question enables Save, and Save sends the rebuilt structured document without `content`', async () => {
    getResource.mockResolvedValueOnce(STRUCTURED_ASSESSMENT);
    updateResource.mockResolvedValueOnce(STRUCTURED_ASSESSMENT);
    const navigation = makeNavigation();
    await act(async () => {
      await renderScreen('res3', navigation);
    });
    await waitFor(() => screen.getByLabelText('Question 1 text'));
    expect(getHeaderButtons(navigation).saveBtn.props.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Question 1 text'), 'What is 1/2 + 1/4?');
    await waitFor(() => expect(getHeaderButtons(navigation).saveBtn.props.disabled).toBe(false));

    await act(async () => {
      getHeaderButtons(navigation).saveBtn.props.onPress();
    });

    await waitFor(() => expect(updateResource).toHaveBeenCalled());
    const patch = updateResource.mock.calls[0][1];
    expect(patch.content).toBeUndefined();
    const savedDoc = JSON.parse(patch.structured);
    expect(savedDoc.schemaVersion).toBe(2);
    expect(savedDoc.questions[0].text).toBe('What is 1/2 + 1/4?');
    // Fields the web workspace itself does not carry through a Library save
    // (questionType/questionCount) are preserved here — see this screen's
    // own structuredConfig comment.
    expect(savedDoc.questionType).toBe('mcq');
    expect(savedDoc.questionCount).toBe(1);
  });

  it('blocks saving when a question becomes invalid', async () => {
    getResource.mockResolvedValueOnce(STRUCTURED_ASSESSMENT);
    const navigation = makeNavigation();
    await act(async () => {
      await renderScreen('res3', navigation);
    });
    await waitFor(() => screen.getByLabelText('Question 1 text'));
    await fireEvent.changeText(screen.getByLabelText('Question 1 option A'), '');

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => {
      getHeaderButtons(navigation).saveBtn.props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Fix questions', 'Fix the highlighted questions before saving.');
    expect(updateResource).not.toHaveBeenCalled();
  });

  it('an AI Assist suggestion for a structured resource applies both content and structured together', async () => {
    getResource.mockResolvedValueOnce(STRUCTURED_ASSESSMENT);
    const updatedStructured = JSON.stringify({
      schemaVersion: 2,
      instructions: 'Answer all questions.',
      questions: [
        { id: 'q1', type: 'mcq', text: 'What is 1/2 + 1/2? (easier)', options: ['1', '2', '0', '1/4'], correctOptionIndex: 0 },
      ],
    });
    runAiAction.mockResolvedValueOnce({ suggestion: 'Easier version content', structured: updatedStructured, requestId: 'r1' });
    await act(async () => {
      await renderScreen('res3');
    });
    await waitFor(() => screen.getByLabelText('Question 1 text'));

    await fireEvent.press(screen.getByTestId('ai-action-make_easier'));
    await waitFor(() => expect(screen.getByText('Easier version content')).toBeTruthy());
    await fireEvent.press(screen.getByText('Apply to editor'));

    await waitFor(() => expect(screen.getByDisplayValue('What is 1/2 + 1/2? (easier)')).toBeTruthy());
  });
});
