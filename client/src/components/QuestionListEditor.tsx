// The structured-question list — shared by GeneratorPage's Edit/Preview tabs
// and ResourceWorkspace's structured editor (see docs/generator-v2-plan.md).
// Owns add/delete/reorder; per-question field editing is QuestionCard's job.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import QuestionCard from './QuestionCard';
import { EDITABLE_QUESTION_TYPES, createEmptyQuestion } from '../lib/structuredQuestions';
import type { Question, QuestionType } from '../lib/resources';

export interface QuestionListEditorProps {
  questions: Question[];
  editable: boolean;
  errors?: Record<string, string>;
  onChange?: (next: Question[]) => void;
}

export default function QuestionListEditor({ questions, editable, errors, onChange }: QuestionListEditorProps) {
  const [addType, setAddType] = useState<QuestionType>('mcq');

  function updateAt(index: number, next: Question) {
    if (!onChange) return;
    const copy = [...questions];
    copy[index] = next;
    onChange(copy);
  }

  function deleteAt(index: number) {
    if (!onChange) return;
    onChange(questions.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number) {
    if (!onChange) return;
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const copy = [...questions];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
  }

  function addQuestion() {
    if (!onChange) return;
    onChange([...questions, createEmptyQuestion(addType)]);
  }

  return (
    <div className="question-list-editor">
      {questions.length === 0 && (
        <p className="question-list-empty">
          {editable ? 'No questions yet — add one below.' : 'No questions in this document.'}
        </p>
      )}

      {questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          question={q}
          index={i}
          total={questions.length}
          editable={editable}
          error={errors?.[q.id]}
          onChange={(next) => updateAt(i, next)}
          onDelete={() => deleteAt(i)}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
        />
      ))}

      {editable && (
        <div className="question-list-add">
          <select value={addType} onChange={(e) => setAddType(e.target.value as QuestionType)} aria-label="New question type">
            {EDITABLE_QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button type="button" className="btn-text question-list-add-btn" onClick={addQuestion}>
            <Plus size={15} aria-hidden="true" /> Add question
          </button>
        </div>
      )}
    </div>
  );
}
