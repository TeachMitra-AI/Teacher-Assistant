// Component tests for the structured-question list editor (Generator v2
// Stage 3 — docs/generator-v2-plan.md). Covers add/delete/reorder wiring;
// per-question field editing is covered by QuestionCard.test.tsx.
// `render`/`fireEvent` are awaited (see QuestionCard.test.tsx's header comment
// for why — un-awaited fireEvent leaves overlapping act() calls that corrupt
// later assertions in the same file).
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { QuestionListEditor } from '../QuestionListEditor';
import { createEmptyQuestion } from '../../lib/structuredQuestions';
import type { Question } from '../../api/resources';

async function renderEditor(questions: Question[], editable: boolean, onChange = jest.fn()) {
  const utils = await render(
    <ThemeProvider>
      <QuestionListEditor questions={questions} editable={editable} onChange={onChange} />
    </ThemeProvider>
  );
  return { ...utils, onChange };
}

describe('QuestionListEditor', () => {
  it('shows an empty-state message when there are no questions (editable)', async () => {
    await renderEditor([], true);
    expect(screen.getByText('No questions yet — add one below.')).toBeTruthy();
  });

  it('shows a different empty-state message in read-only mode', async () => {
    await renderEditor([], false);
    expect(screen.getByText('No questions in this document.')).toBeTruthy();
  });

  it('renders one QuestionCard per question, keyed by id', async () => {
    const questions = [createEmptyQuestion('mcq'), createEmptyQuestion('true_false')];
    await renderEditor(questions, true);
    expect(screen.getByLabelText('Question 1 text')).toBeTruthy();
    expect(screen.getByLabelText('Question 2 text')).toBeTruthy();
  });

  it('add question appends a new question of the selected add-type', async () => {
    // A single mcq question's own type-picker chip row also contains a
    // "True / False" chip, so two chips share that label — the add-type
    // picker's is the one rendered last (below all question cards).
    const { onChange } = await renderEditor([createEmptyQuestion('mcq')], true);

    const trueFalseChips = screen.getAllByText('True / False');
    await fireEvent.press(trueFalseChips[trueFalseChips.length - 1]);
    await fireEvent.press(screen.getByText('Add question'));

    const next = onChange.mock.calls[0][0] as Question[];
    expect(next).toHaveLength(2);
    expect(next[1].type).toBe('true_false');
  });

  it('deleting a question removes only that question', async () => {
    const questions = [createEmptyQuestion('mcq'), createEmptyQuestion('true_false')];
    const { onChange } = await renderEditor(questions, true);

    await fireEvent.press(screen.getByLabelText('Delete question 1'));
    const next = onChange.mock.calls[0][0] as Question[];
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(questions[1].id);
  });

  it('move up/down swap adjacent questions and are boundary-safe', async () => {
    const questions = [createEmptyQuestion('mcq'), createEmptyQuestion('true_false'), createEmptyQuestion('descriptive')];
    const { onChange } = await renderEditor(questions, true);

    await fireEvent.press(screen.getByLabelText('Move question 2 up'));
    const next = onChange.mock.calls[0][0] as Question[];
    expect(next.map((q) => q.id)).toEqual([questions[1].id, questions[0].id, questions[2].id]);

    onChange.mockClear();
    await fireEvent.press(screen.getByLabelText('Move question 1 up'));
    expect(onChange).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Move question 3 down'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('read-only mode renders cards but no add-question controls', async () => {
    await renderEditor([createEmptyQuestion('mcq')], false);
    expect(screen.queryByText('Add question')).toBeNull();
    expect(screen.queryByLabelText('Delete question 1')).toBeNull();
  });

  it('passes per-question errors through by id', async () => {
    const q = createEmptyQuestion('short_answer');
    await render(
      <ThemeProvider>
        <QuestionListEditor
          questions={[q]}
          editable
          errors={{ [q.id]: 'A correct answer is required.' }}
          onChange={jest.fn()}
        />
      </ThemeProvider>
    );
    expect(screen.getByText('A correct answer is required.')).toBeTruthy();
  });
});
