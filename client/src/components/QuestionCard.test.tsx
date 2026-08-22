import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuestionCard from './QuestionCard';
import { createEmptyQuestion } from '../lib/structuredQuestions';
import type { MatchQuestion, McqQuestion, Question, ShortAnswerQuestion } from '../lib/resources';

describe('QuestionCard — editable mode', () => {
  test('editing the question text calls onChange with the updated question', async () => {
    const user = userEvent.setup();
    const q: Question = { ...createEmptyQuestion('short_answer'), correctAnswer: 'A' } as Question;
    const onChange = vi.fn();
    render(<QuestionCard question={q} index={0} total={1} editable onChange={onChange} />);

    await user.type(screen.getByLabelText('Question 1 text'), 'X');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(last.text).toBe('X');
  });

  test('mcq: editing an option and picking the correct radio both fire onChange correctly', async () => {
    const user = userEvent.setup();
    let current = createEmptyQuestion('mcq') as McqQuestion;
    const onChange = vi.fn((next: Question) => { current = next as McqQuestion; });
    const { rerender } = render(<QuestionCard question={current} index={0} total={1} editable onChange={onChange} />);

    // Controlled input: type one character at a time, re-rendering with the
    // updated value in between (a bare user.type() against a value that
    // never advances would only ever capture the single most recent
    // keystroke, not the accumulated string).
    for (const ch of 'Paris') {
      await user.type(screen.getByLabelText('Question 1 option A'), ch);
      rerender(<QuestionCard question={current} index={0} total={1} editable onChange={onChange} />);
    }
    expect(current.options[0]).toBe('Paris');

    await user.click(screen.getByLabelText('Option C is correct'));
    expect(current.correctOptionIndex).toBe(2);
  });

  test('true_false: toggling to False fires onChange', async () => {
    const user = userEvent.setup();
    const q = createEmptyQuestion('true_false') as Question;
    const onChange = vi.fn();
    render(<QuestionCard question={q} index={0} total={1} editable onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Correct answer'), 'False');
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0].correctAnswer).toBe('False');
  });

  test('fill_blank: shows the "answer for the blank" field, not "correct answer"', () => {
    const q = createEmptyQuestion('fill_blank');
    render(<QuestionCard question={q} index={0} total={1} editable onChange={vi.fn()} />);
    expect(screen.getByText('Answer for the blank')).toBeInTheDocument();
  });

  test('descriptive: shows a model-answer field', () => {
    const q = createEmptyQuestion('descriptive');
    render(<QuestionCard question={q} index={0} total={1} editable onChange={vi.fn()} />);
    expect(screen.getByText('Model answer')).toBeInTheDocument();
  });

  test('match: add pair grows the array, remove pair shrinks it (never below 3)', async () => {
    const user = userEvent.setup();
    const q = createEmptyQuestion('match') as MatchQuestion;
    let current = q;
    const onChange = vi.fn((next: Question) => { current = next as MatchQuestion; });
    const { rerender } = render(<QuestionCard question={current} index={0} total={1} editable onChange={onChange} />);

    await user.click(screen.getByText('Add pair'));
    expect(current.pairs).toHaveLength(4);
    rerender(<QuestionCard question={current} index={0} total={1} editable onChange={onChange} />);

    await user.click(screen.getByLabelText('Remove pair 1'));
    expect(current.pairs).toHaveLength(3);

    // Cannot go below the minimum of 3 — the remove button is disabled.
    rerender(<QuestionCard question={current} index={0} total={1} editable onChange={onChange} />);
    expect(screen.getByLabelText('Remove pair 1')).toBeDisabled();
  });

  test('changing question type resets type-specific fields (mcq -> match clears options, seeds pairs)', async () => {
    const user = userEvent.setup();
    const q = { ...(createEmptyQuestion('mcq') as McqQuestion), text: 'Keep me' };
    const onChange = vi.fn();
    render(<QuestionCard question={q} index={0} total={1} editable onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText('Question 1 type'), 'match');
    const next = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(next.type).toBe('match');
    expect(next.text).toBe('Keep me');
    expect(next.pairs).toHaveLength(3);
  });

  test('delete/move-up/move-down buttons call their handlers', async () => {
    const user = userEvent.setup();
    const q = createEmptyQuestion('short_answer');
    const onDelete = vi.fn();
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(
      <QuestionCard
        question={q} index={1} total={3} editable
        onChange={vi.fn()} onDelete={onDelete} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
      />
    );
    await user.click(screen.getByLabelText('Move question 2 up'));
    await user.click(screen.getByLabelText('Move question 2 down'));
    await user.click(screen.getByLabelText('Delete question 2'));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  test('move-up is disabled on the first question, move-down on the last', () => {
    const q = createEmptyQuestion('short_answer');
    render(<QuestionCard question={q} index={0} total={3} editable onChange={vi.fn()} />);
    expect(screen.getByLabelText('Move question 1 up')).toBeDisabled();
    expect(screen.getByLabelText('Move question 1 down')).not.toBeDisabled();
  });

  test('shows the inline validation error when one is passed', () => {
    const q = createEmptyQuestion('short_answer');
    render(<QuestionCard question={q} index={0} total={1} editable error="A correct answer is required." onChange={vi.fn()} />);
    expect(screen.getByText('A correct answer is required.')).toBeInTheDocument();
  });
});

describe('QuestionCard — read-only (preview) mode', () => {
  test('renders question text and correct answer as plain text, no inputs', () => {
    const q = { ...(createEmptyQuestion('short_answer') as ShortAnswerQuestion), text: 'Define X.', correctAnswer: 'A thing.' };
    render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    expect(screen.getByText('Define X.')).toBeInTheDocument();
    expect(screen.getByText('A thing.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('mcq: marks the correct option visually and shows no radio inputs to click', () => {
    const q: McqQuestion = {
      ...(createEmptyQuestion('mcq') as McqQuestion),
      text: 'Q?', options: ['Paris', 'London', 'Berlin', 'Madrid'], correctOptionIndex: 1,
    };
    render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    expect(screen.getAllByRole('radio').every((r) => (r as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByText('London').className).toContain('correct');
    expect(screen.getByText('Paris').className).not.toContain('correct');
  });

  test('match: renders a read-only two-column table', () => {
    const q: MatchQuestion = {
      ...(createEmptyQuestion('match') as MatchQuestion),
      text: 'Match.',
      pairs: [{ left: 'Mercury', right: '1st' }, { left: 'Venus', right: '2nd' }, { left: 'Earth', right: '3rd' }],
    };
    render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    expect(screen.getByText('Mercury')).toBeInTheDocument();
    expect(screen.getByText('1st')).toBeInTheDocument();
  });

  test('no action buttons (move/delete) render in read-only mode', () => {
    const q = createEmptyQuestion('short_answer');
    render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    expect(screen.queryByLabelText('Delete question 1')).not.toBeInTheDocument();
  });
});
