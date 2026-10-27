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

    // Controlled input: type one character at a time, re-rendering with the new value between, since a bare user.type() against a static value only captures the last keystroke.
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

  // Generated questions write maths as $...$ LaTeX. The read-only card must typeset it (as the printed paper does), not show
  // "$\frac{5}{12}$". KaTeX keeps the source in a hidden MathML <annotation> for screen readers, so "visible" text is checked
  // with the .katex elements removed.
  function visibleTextOutsideMath(el: HTMLElement): string {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.katex').forEach((k) => k.remove());
    return clone.textContent ?? '';
  }

  test('typesets a LaTeX fraction in the question text and keeps the surrounding words', () => {
    const q = {
      ...(createEmptyQuestion('short_answer') as ShortAnswerQuestion),
      text: 'In the fraction $\\frac{5}{12}$, which number is the denominator?',
      correctAnswer: '12',
    };
    const { container } = render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    const text = container.querySelector('.question-card-text-display') as HTMLElement;

    expect(text.tagName).toBe('P');
    expect(text.querySelectorAll('.katex')).toHaveLength(1);
    expect(text.querySelector('.katex-mathml math')).not.toBeNull(); // accessible MathML is kept
    const visible = visibleTextOutsideMath(text);
    expect(visible).toBe('In the fraction , which number is the denominator?');
    expect(visible).not.toMatch(/\\frac|\$/);
  });

  test('plain text renders exactly as before, with HTML-like characters shown literally', () => {
    const q = {
      ...(createEmptyQuestion('short_answer') as ShortAnswerQuestion),
      text: 'Is 3 < 5 & 7 > 2? Answer in <b>one</b> word.',
      correctAnswer: 'Yes',
    };
    const { container } = render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    const text = container.querySelector('.question-card-text-display') as HTMLElement;

    expect(text.textContent).toBe('Is 3 < 5 & 7 > 2? Answer in <b>one</b> word.');
    expect(text.querySelector('b')).toBeNull();
    expect(text.querySelector('.katex')).toBeNull();
  });

  test('mcq: typesets LaTeX in every option and keeps the correct-option styling', () => {
    const q: McqQuestion = {
      ...(createEmptyQuestion('mcq') as McqQuestion),
      text: 'Which fraction is equivalent to $\\frac{2}{5}$?',
      options: ['$\\frac{4}{10}$', '$\\frac{3}{8}$', '$\\frac{5}{2}$', '$\\frac{6}{20}$'],
      correctOptionIndex: 0,
    };
    const { container } = render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    const options = [...container.querySelectorAll('.question-card-option-text')] as HTMLElement[];

    expect(options).toHaveLength(4);
    for (const option of options) {
      expect(option.querySelectorAll('.katex')).toHaveLength(1);
      expect(visibleTextOutsideMath(option)).toBe('');
    }
    expect(options[0].className).toContain('correct');
    expect(options[1].className).not.toContain('correct');
  });

  test('mcq: an empty option still shows its placeholder', () => {
    const q: McqQuestion = { ...(createEmptyQuestion('mcq') as McqQuestion), text: 'Q?', options: ['$5$', '', '7', '8'] };
    render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    expect(screen.getByText('(empty)')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  test('answers and match cells typeset LaTeX too', () => {
    const shortQ = { ...(createEmptyQuestion('short_answer') as ShortAnswerQuestion), text: '2/8 + 3/8?', correctAnswer: '$\\frac{5}{8}$' };
    const { container, unmount } = render(<QuestionCard question={shortQ} index={0} total={1} editable={false} />);
    expect(container.querySelector('.question-card-answer strong .katex')).not.toBeNull();
    unmount();

    const matchQ: MatchQuestion = {
      ...(createEmptyQuestion('match') as MatchQuestion),
      text: 'Match.',
      pairs: [{ left: '$\\frac{1}{2}$', right: 'half' }, { left: 'b', right: '2' }, { left: 'c', right: '3' }],
    };
    const view = render(<QuestionCard question={matchQ} index={0} total={1} editable={false} />);
    expect(view.container.querySelector('td .katex')).not.toBeNull();
    expect(screen.getByText('half')).toBeInTheDocument();
  });

  test('model text cannot inject HTML, in plain text or inside a maths segment', () => {
    const q: McqQuestion = {
      ...(createEmptyQuestion('mcq') as McqQuestion),
      text: '<img src=x onerror="alert(1)"> and $<img src=y onerror=alert(2)>$',
      options: ['<script>alert(3)</script>', '$\\frac{1}{2}$', 'c', 'd'],
      correctOptionIndex: 1,
    };
    const { container } = render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(screen.getByText('<script>alert(3)</script>')).toBeInTheDocument();
  });

  test('no action buttons (move/delete) render in read-only mode', () => {
    const q = createEmptyQuestion('short_answer');
    render(<QuestionCard question={q} index={0} total={1} editable={false} />);
    expect(screen.queryByLabelText('Delete question 1')).not.toBeInTheDocument();
  });
});
