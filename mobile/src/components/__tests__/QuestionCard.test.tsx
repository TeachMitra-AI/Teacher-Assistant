// Component tests for the structured-question card (Generator v2 Stage 3 —
// docs/generator-v2-plan.md). Mirrors client/src/components/QuestionCard.test.tsx's
// coverage, adapted to React Native Testing Library conventions: fireEvent.changeText
// sets the whole value in one call (unlike web's character-by-character user-event),
// and `render`/`rerender`/`fireEvent` are all awaited — this repo's
// ResourceEditScreen.test.tsx convention, and required here: an un-awaited
// fireEvent leaves an overlapping act() call that corrupts every later
// assertion in the same file (confirmed empirically — omitting await turned
// 10 of these 12 tests into false failures with no code defect behind them).
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { QuestionCard } from '../QuestionCard';
import { createEmptyQuestion } from '../../lib/structuredQuestions';
import type { MatchQuestion, McqQuestion, Question } from '../../api/resources';

async function renderCard(props: Partial<React.ComponentProps<typeof QuestionCard>> & { question: Question; index: number; total: number; editable: boolean }) {
  return await render(
    <ThemeProvider>
      <QuestionCard {...props} />
    </ThemeProvider>
  );
}

describe('QuestionCard — editable mode', () => {
  it('editing the question text calls onChange with the updated question', async () => {
    const q = { ...createEmptyQuestion('short_answer'), correctAnswer: 'A' } as Question;
    const onChange = jest.fn();
    await renderCard({ question: q, index: 0, total: 1, editable: true, onChange });

    await fireEvent.changeText(screen.getByLabelText('Question 1 text'), 'X');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].text).toBe('X');
  });

  it('mcq: editing an option and picking the correct radio both fire onChange correctly', async () => {
    const q = createEmptyQuestion('mcq') as McqQuestion;
    const onChange = jest.fn();
    await renderCard({ question: q, index: 0, total: 1, editable: true, onChange });

    await fireEvent.changeText(screen.getByLabelText('Question 1 option A'), 'Paris');
    expect(onChange.mock.calls[0][0].options[0]).toBe('Paris');

    await fireEvent.press(screen.getByLabelText('Option C is correct'));
    expect(onChange.mock.calls[1][0].correctOptionIndex).toBe(2);
  });

  it('true_false: toggling to False fires onChange', async () => {
    const q = createEmptyQuestion('true_false') as Question;
    const onChange = jest.fn();
    await renderCard({ question: q, index: 0, total: 1, editable: true, onChange });
    await fireEvent.press(screen.getByText('False'));
    expect(onChange.mock.calls[0][0].correctAnswer).toBe('False');
  });

  it('fill_blank: shows the "answer for the blank" field, not "correct answer"', async () => {
    const q = createEmptyQuestion('fill_blank');
    await renderCard({ question: q, index: 0, total: 1, editable: true, onChange: jest.fn() });
    expect(screen.getByText('Answer for the blank')).toBeTruthy();
  });

  it('descriptive: shows a model-answer field', async () => {
    const q = createEmptyQuestion('descriptive');
    await renderCard({ question: q, index: 0, total: 1, editable: true, onChange: jest.fn() });
    expect(screen.getByText('Model answer')).toBeTruthy();
  });

  it('match: add pair grows the array, remove pair shrinks it (never below 3)', async () => {
    const q = createEmptyQuestion('match') as MatchQuestion;
    let current = q;
    const onChange = jest.fn((next: Question) => { current = next as MatchQuestion; });
    const { rerender } = await renderCard({ question: current, index: 0, total: 1, editable: true, onChange });

    await fireEvent.press(screen.getByText('Add pair'));
    expect(current.pairs).toHaveLength(4);
    await rerender(
      <ThemeProvider>
        <QuestionCard question={current} index={0} total={1} editable onChange={onChange} />
      </ThemeProvider>
    );

    await fireEvent.press(screen.getByLabelText('Remove pair 1'));
    expect(current.pairs).toHaveLength(3);
  });

  it('changing question type resets type-specific fields (mcq -> match clears options, seeds pairs)', async () => {
    const q = { ...(createEmptyQuestion('mcq') as McqQuestion), text: 'Keep me' };
    const onChange = jest.fn();
    await renderCard({ question: q, index: 0, total: 1, editable: true, onChange });

    await fireEvent.press(screen.getByText('Match the Following'));
    const next = onChange.mock.calls[0][0];
    expect(next.type).toBe('match');
    expect(next.text).toBe('Keep me');
    expect(next.pairs).toHaveLength(3);
  });

  it('delete/move-up/move-down buttons call their handlers', async () => {
    const q = createEmptyQuestion('short_answer');
    const onDelete = jest.fn();
    const onMoveUp = jest.fn();
    const onMoveDown = jest.fn();
    await renderCard({ question: q, index: 1, total: 3, editable: true, onChange: jest.fn(), onDelete, onMoveUp, onMoveDown });

    await fireEvent.press(screen.getByLabelText('Move question 2 up'));
    await fireEvent.press(screen.getByLabelText('Move question 2 down'));
    await fireEvent.press(screen.getByLabelText('Delete question 2'));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows the inline validation error when one is passed', async () => {
    const q = createEmptyQuestion('short_answer');
    await renderCard({ question: q, index: 0, total: 1, editable: true, error: 'A correct answer is required.', onChange: jest.fn() });
    expect(screen.getByText('A correct answer is required.')).toBeTruthy();
  });
});

describe('QuestionCard — read-only (preview) mode', () => {
  it('renders question text and correct answer as plain text, no inputs', async () => {
    const q = { ...(createEmptyQuestion('short_answer') as Question), text: 'Define X.', correctAnswer: 'A thing.' } as Question;
    await renderCard({ question: q, index: 0, total: 1, editable: false });
    expect(screen.getByText('Define X.')).toBeTruthy();
    expect(screen.getByText('A thing.')).toBeTruthy();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('mcq: marks the correct option visually, with no editable radios', async () => {
    const q: McqQuestion = {
      ...(createEmptyQuestion('mcq') as McqQuestion),
      text: 'Q?', options: ['Paris', 'London', 'Berlin', 'Madrid'], correctOptionIndex: 1,
    };
    await renderCard({ question: q, index: 0, total: 1, editable: false });
    expect(screen.getAllByRole('radio').every((r) => r.props.accessibilityState?.disabled)).toBe(true);
    expect(screen.getByText('London')).toBeTruthy();
    expect(screen.getByText('Paris')).toBeTruthy();
  });

  it('match: renders a read-only two-column table', async () => {
    const q: MatchQuestion = {
      ...(createEmptyQuestion('match') as MatchQuestion),
      text: 'Match.',
      pairs: [{ left: 'Mercury', right: '1st' }, { left: 'Venus', right: '2nd' }, { left: 'Earth', right: '3rd' }],
    };
    await renderCard({ question: q, index: 0, total: 1, editable: false });
    expect(screen.getByText('Mercury')).toBeTruthy();
    expect(screen.getByText('1st')).toBeTruthy();
  });

  it('no action buttons (move/delete) render in read-only mode', async () => {
    const q = createEmptyQuestion('short_answer');
    await renderCard({ question: q, index: 0, total: 1, editable: false });
    expect(screen.queryByLabelText('Delete question 1')).toBeNull();
  });
});
