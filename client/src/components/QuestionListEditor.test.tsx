import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuestionListEditor from './QuestionListEditor';
import { createEmptyQuestion } from '../lib/structuredQuestions';
import type { Question } from '../lib/resources';

function threeQuestions(): Question[] {
  return [
    { ...createEmptyQuestion('short_answer'), text: 'First question', correctAnswer: 'A1' },
    { ...createEmptyQuestion('short_answer'), text: 'Second question', correctAnswer: 'A2' },
    { ...createEmptyQuestion('short_answer'), text: 'Third question', correctAnswer: 'A3' },
  ] as Question[];
}

describe('QuestionListEditor — editable mode', () => {
  test('renders one card per question, numbered in order', () => {
    render(<QuestionListEditor questions={threeQuestions()} editable onChange={vi.fn()} />);
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByLabelText('Question 1 text')).toBeInTheDocument();
    expect(screen.getByLabelText('Question 2 text')).toBeInTheDocument();
    expect(screen.getByLabelText('Question 3 text')).toBeInTheDocument();
  });

  test('deleting the middle question removes exactly that one, keeping order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuestionListEditor questions={threeQuestions()} editable onChange={onChange} />);
    await user.click(screen.getByLabelText('Delete question 2'));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Question[];
    expect(next.map((q) => q.text)).toEqual(['First question', 'Third question']);
  });

  test('moving question 1 down swaps it with question 2', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuestionListEditor questions={threeQuestions()} editable onChange={onChange} />);
    await user.click(screen.getByLabelText('Move question 1 down'));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Question[];
    expect(next.map((q) => q.text)).toEqual(['Second question', 'First question', 'Third question']);
  });

  test('moving question 3 up swaps it with question 2', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuestionListEditor questions={threeQuestions()} editable onChange={onChange} />);
    await user.click(screen.getByLabelText('Move question 3 up'));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Question[];
    expect(next.map((q) => q.text)).toEqual(['First question', 'Third question', 'Second question']);
  });

  test('editing one question in place leaves the others untouched', async () => {
    const user = userEvent.setup();
    let current = threeQuestions();
    const onChange = vi.fn((next: Question[]) => { current = next; });
    const { rerender } = render(<QuestionListEditor questions={current} editable onChange={onChange} />);
    await user.type(screen.getByLabelText('Question 2 text'), '!');
    rerender(<QuestionListEditor questions={current} editable onChange={onChange} />);
    expect(current[0].text).toBe('First question');
    expect(current[1].text).toBe('Second question!');
    expect(current[2].text).toBe('Third question');
  });

  test('"Add question" appends a new question of the selected type', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuestionListEditor questions={threeQuestions()} editable onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('New question type'), 'match');
    await user.click(screen.getByText('Add question'));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Question[];
    expect(next).toHaveLength(4);
    expect(next[3].type).toBe('match');
  });

  test('shows an empty-state message and no cards when the list is empty', () => {
    render(<QuestionListEditor questions={[]} editable onChange={vi.fn()} />);
    expect(screen.getByText(/no questions yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('per-question validation errors are passed through to the right card', () => {
    const qs = threeQuestions();
    render(<QuestionListEditor questions={qs} editable errors={{ [qs[1].id]: 'Something is wrong here.' }} onChange={vi.fn()} />);
    expect(screen.getByText('Something is wrong here.')).toBeInTheDocument();
  });
});

describe('QuestionListEditor — read-only (preview) mode', () => {
  test('renders every question read-only, with no add/delete/reorder controls', () => {
    render(<QuestionListEditor questions={threeQuestions()} editable={false} />);
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete question 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Add question')).not.toBeInTheDocument();
  });
});
