// Component tests for the Generator request form (Generator v2 Stage 3 —
// docs/generator-v2-plan.md, docs/mobile-app-plan.md Phase 6). Mirrors this
// repo's established RNTL conventions (ResourceEditScreen.test.tsx):
// api/resources is module-mocked, render/fireEvent are awaited.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { QUESTION_COUNT_MIN, QUESTION_COUNT_MAX } from '../../../config';
import { GeneratorFormScreen } from '../GeneratorFormScreen';

jest.mock('../../../api/resources', () => ({
  generateAssessment: jest.fn(),
}));
const { generateAssessment } = jest.requireMock('../../../api/resources') as { generateAssessment: jest.Mock };

function makeNavigation() {
  return { navigate: jest.fn() };
}

async function renderScreen(navigation = makeNavigation()) {
  await render(
    <ThemeProvider>
      <GeneratorFormScreen
        navigation={navigation as never}
        route={{ key: 'g', name: 'GeneratorForm', params: undefined } as never}
      />
    </ThemeProvider>
  );
  return navigation;
}

describe('GeneratorFormScreen', () => {
  beforeEach(() => {
    generateAssessment.mockReset();
  });

  it('does not generate while the topic is empty, even if Generate is pressed', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByText('Generate'));
    await waitFor(() => expect(generateAssessment).not.toHaveBeenCalled());
  });

  it('generates with the default field values and navigates to GeneratorResult with the response', async () => {
    generateAssessment.mockResolvedValueOnce({ content: '# Quiz\n...', structured: undefined, requestId: 'r1' });
    const navigation = await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Topic *'), 'Fractions');
    await fireEvent.press(screen.getByText('Generate'));

    await waitFor(() => expect(generateAssessment).toHaveBeenCalledWith({
      format: 'quiz',
      grade: undefined,
      subject: undefined,
      topic: 'Fractions',
      difficulty: 'medium',
      questionType: 'mcq',
      questionCount: 10,
      language: 'en',
      instructions: undefined,
    }));

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('GeneratorResult', expect.objectContaining({
      format: 'quiz', topic: 'Fractions', difficulty: 'medium', questionType: 'mcq',
      questionCount: 10, language: 'en', content: '# Quiz\n...', structured: undefined,
    })));
  });

  it('passes structured through untouched when the response includes it', async () => {
    generateAssessment.mockResolvedValueOnce({ content: '# Quiz', structured: '{"schemaVersion":2,"questions":[]}', requestId: 'r1' });
    const navigation = await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Topic *'), 'Fractions');
    await fireEvent.press(screen.getByText('Generate'));

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('GeneratorResult', expect.objectContaining({
      structured: '{"schemaVersion":2,"questions":[]}',
    })));
  });

  it('changing format/difficulty/question type/language changes the request payload', async () => {
    generateAssessment.mockResolvedValueOnce({ content: 'c', structured: undefined, requestId: 'r1' });
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Topic *'), 'Water cycle');
    await fireEvent.press(screen.getByText('Worksheet'));

    await fireEvent.press(screen.getByLabelText('Difficulty'));
    await fireEvent.press(screen.getByText('Hard'));

    await fireEvent.press(screen.getByLabelText('Question type'));
    await fireEvent.press(screen.getByText('Match the Following'));

    await fireEvent.press(screen.getByLabelText('Language'));
    await fireEvent.press(screen.getByText('हिंदी'));

    await fireEvent.press(screen.getByText('Generate'));

    await waitFor(() => expect(generateAssessment).toHaveBeenCalledWith(expect.objectContaining({
      format: 'worksheet', difficulty: 'hard', questionType: 'match', language: 'hi',
    })));
  });

  it('selecting grade and subject from their dropdowns includes them in the request payload', async () => {
    generateAssessment.mockResolvedValueOnce({ content: 'c', structured: undefined, requestId: 'r1' });
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Topic *'), 'Fractions');
    await fireEvent.press(screen.getByLabelText('Grade'));
    await fireEvent.press(screen.getByText('Class 3-5'));
    await fireEvent.press(screen.getByLabelText('Subject'));
    await fireEvent.press(screen.getByText('Mathematics'));
    await fireEvent.press(screen.getByText('Generate'));

    await waitFor(() => expect(generateAssessment).toHaveBeenCalledWith(expect.objectContaining({
      grade: 'Class 3-5', subject: 'Mathematics',
    })));
  });

  it('question-count stepper increments/decrements and clamps at the bounds', async () => {
    await renderScreen();
    const decrease = screen.getByLabelText('Decrease question count');
    const increase = screen.getByLabelText('Increase question count');

    expect(screen.getByDisplayValue('10')).toBeTruthy();
    await fireEvent.press(increase);
    expect(screen.getByDisplayValue('11')).toBeTruthy();
    await fireEvent.press(decrease);
    await fireEvent.press(decrease);
    expect(screen.getByDisplayValue('9')).toBeTruthy();

    for (let i = 0; i < 10; i++) await fireEvent.press(decrease);
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(decrease.props.accessibilityState?.disabled).toBe(true);
  });

  it('question count can also be typed directly, and is clamped to bounds on blur', async () => {
    await renderScreen();
    const input = screen.getByLabelText('Number of questions');

    await fireEvent.changeText(input, '25');
    expect(screen.getByDisplayValue('25')).toBeTruthy();

    // Typing past the max, then blurring, clamps back into range.
    await fireEvent.changeText(input, '99');
    await fireEvent(input, 'blur');
    expect(screen.getByDisplayValue(String(QUESTION_COUNT_MAX))).toBeTruthy();

    // Clearing the field, then blurring, falls back to the minimum.
    await fireEvent.changeText(input, '');
    await fireEvent(input, 'blur');
    expect(screen.getByDisplayValue(String(QUESTION_COUNT_MIN))).toBeTruthy();
  });

  it('generating with a typed, in-range question count sends that count', async () => {
    generateAssessment.mockResolvedValueOnce({ content: 'c', structured: undefined, requestId: 'r1' });
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Topic *'), 'Fractions');
    await fireEvent.changeText(screen.getByLabelText('Number of questions'), '20');
    await fireEvent.press(screen.getByText('Generate'));

    await waitFor(() => expect(generateAssessment).toHaveBeenCalledWith(expect.objectContaining({
      questionCount: 20,
    })));
  });

  it('shows an inline error and does not navigate when generation fails', async () => {
    generateAssessment.mockRejectedValueOnce(new Error('boom'));
    const navigation = await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Topic *'), 'Fractions');
    await fireEvent.press(screen.getByText('Generate'));

    await waitFor(() => expect(screen.getByText('Could not generate. Please try again.')).toBeTruthy());
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('shows a loading state while generating (Button swaps its label for a spinner)', async () => {
    let resolveGenerate: (v: unknown) => void = () => {};
    generateAssessment.mockReturnValueOnce(new Promise((resolve) => { resolveGenerate = resolve; }));
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Topic *'), 'Fractions');

    await act(async () => {
      fireEvent.press(screen.getByText('Generate'));
    });
    // Button.tsx renders an ActivityIndicator instead of its label text
    // while `loading` is true — so the assertion is that the label is gone,
    // not that a "Generating…" text node exists.
    expect(screen.queryByText('Generate')).toBeNull();
    expect(generateAssessment).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveGenerate({ content: 'c', structured: undefined, requestId: 'r1' });
    });
  });
});
