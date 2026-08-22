// One structured question, rendered either as an editable card (Generator's
// Edit tab / ResourceWorkspace's structured editor) or a read-only card
// (Preview tab) — see docs/generator-v2-plan.md. Kept as one component for
// both modes so the two never visually drift apart; `editable` decides which
// controls render.
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { EDITABLE_QUESTION_TYPES } from '../lib/structuredQuestions';
import type { MatchQuestion, McqQuestion, Question } from '../lib/resources';

const TYPE_LABELS: Record<string, string> = Object.fromEntries(EDITABLE_QUESTION_TYPES.map((t) => [t.value, t.label]));

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export interface QuestionCardProps {
  question: Question;
  index: number;
  total: number;
  editable: boolean;
  error?: string | null;
  onChange?: (next: Question) => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export default function QuestionCard({
  question, index, total, editable, error, onChange, onDelete, onMoveUp, onMoveDown,
}: QuestionCardProps) {
  function patch(fields: Partial<Question>) {
    onChange?.({ ...question, ...fields } as Question);
  }

  function changeType(nextType: string) {
    if (!onChange || nextType === question.type) return;
    // Switching type resets the type-specific fields to sensible empty
    // defaults rather than carrying over stale, now-meaningless data (e.g. an
    // mcq's options surviving a switch to "match").
    const text = question.text;
    const id = question.id;
    if (nextType === 'mcq') onChange({ id, type: 'mcq', text, options: ['', '', '', ''], correctOptionIndex: 0 });
    else if (nextType === 'true_false') onChange({ id, type: 'true_false', text, correctAnswer: 'True' });
    else if (nextType === 'descriptive') onChange({ id, type: 'descriptive', text, modelAnswer: '' });
    else if (nextType === 'fill_blank') onChange({ id, type: 'fill_blank', text, correctAnswer: '' });
    else if (nextType === 'match') {
      onChange({ id, type: 'match', text, pairs: [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }] });
    } else onChange({ id, type: 'short_answer', text, correctAnswer: '' });
  }

  return (
    <div className={`question-card${error ? ' has-error' : ''}`}>
      <div className="question-card-head">
        <span className="question-card-number">Q{index + 1}</span>
        {editable ? (
          <select
            className="question-card-type-select"
            value={question.type}
            onChange={(e) => changeType(e.target.value)}
            aria-label={`Question ${index + 1} type`}
          >
            {EDITABLE_QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        ) : (
          <span className="question-card-type-badge">{TYPE_LABELS[question.type] || question.type}</span>
        )}
        {editable && (
          <div className="question-card-actions">
            <button
              type="button"
              className="icon-btn question-card-move"
              onClick={onMoveUp}
              disabled={index === 0}
              aria-label={`Move question ${index + 1} up`}
            >
              <ChevronUp size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn question-card-move"
              onClick={onMoveDown}
              disabled={index === total - 1}
              aria-label={`Move question ${index + 1} down`}
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn question-card-delete"
              onClick={onDelete}
              aria-label={`Delete question ${index + 1}`}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {editable ? (
        <textarea
          className="question-card-text"
          value={question.text}
          onChange={(e) => patch({ text: e.target.value })}
          placeholder={question.type === 'fill_blank' ? 'e.g. The capital of France is ___.' : 'Question text'}
          aria-label={`Question ${index + 1} text`}
          rows={2}
        />
      ) : (
        <p className="question-card-text-display">{question.text || <em>(No question text)</em>}</p>
      )}

      {question.type === 'mcq' && (
        <McqFields question={question} editable={editable} index={index} onChange={onChange} />
      )}
      {question.type === 'true_false' && (
        editable ? (
          <label className="ws-field question-card-field">
            <span className="ws-label">Correct answer</span>
            <select value={question.correctAnswer} onChange={(e) => patch({ correctAnswer: e.target.value as 'True' | 'False' })}>
              <option value="True">True</option>
              <option value="False">False</option>
            </select>
          </label>
        ) : (
          <p className="question-card-answer">Correct answer: <strong>{question.correctAnswer}</strong></p>
        )
      )}
      {(question.type === 'short_answer' || question.type === 'fill_blank') && (
        editable ? (
          <label className="ws-field question-card-field">
            <span className="ws-label">{question.type === 'fill_blank' ? 'Answer for the blank' : 'Correct answer'}</span>
            <input
              type="text"
              value={question.correctAnswer}
              maxLength={500}
              onChange={(e) => patch({ correctAnswer: e.target.value })}
              placeholder={question.type === 'fill_blank' ? 'e.g. Paris' : 'Model answer'}
            />
          </label>
        ) : (
          <p className="question-card-answer">
            {question.type === 'fill_blank' ? 'Answer' : 'Correct answer'}: <strong>{question.correctAnswer || '—'}</strong>
          </p>
        )
      )}
      {question.type === 'descriptive' && (
        editable ? (
          <label className="ws-field question-card-field">
            <span className="ws-label">Model answer</span>
            <textarea
              value={question.modelAnswer}
              maxLength={2000}
              onChange={(e) => patch({ modelAnswer: e.target.value })}
              placeholder="A suggested answer a teacher could grade against"
              rows={2}
            />
          </label>
        ) : (
          <p className="question-card-answer">Suggested answer: {question.modelAnswer || '—'}</p>
        )
      )}
      {question.type === 'match' && (
        <MatchFields question={question} editable={editable} onChange={onChange} />
      )}

      {editable && error && <p className="question-card-error">{error}</p>}
    </div>
  );
}

function McqFields({
  question, editable, index, onChange,
}: { question: McqQuestion; editable: boolean; index: number; onChange?: (next: Question) => void }) {
  function setOption(i: number, value: string) {
    if (!onChange) return;
    const options = [...question.options];
    options[i] = value;
    onChange({ ...question, options });
  }

  return (
    <div className="question-card-options">
      {question.options.map((opt, i) => (
        <div key={i} className="question-card-option-row">
          <label className="question-card-option-radio">
            <input
              type="radio"
              name={`mcq-correct-${question.id}`}
              checked={question.correctOptionIndex === i}
              onChange={() => editable && onChange?.({ ...question, correctOptionIndex: i })}
              disabled={!editable}
              aria-label={`Option ${OPTION_LETTERS[i]} is correct`}
            />
            <span className="question-card-option-letter">{OPTION_LETTERS[i]}</span>
          </label>
          {editable ? (
            <input
              type="text"
              className="question-card-option-input"
              value={opt}
              maxLength={300}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`Option ${OPTION_LETTERS[i]}`}
              aria-label={`Question ${index + 1} option ${OPTION_LETTERS[i]}`}
            />
          ) : (
            <span className={`question-card-option-text${question.correctOptionIndex === i ? ' correct' : ''}`}>
              {opt || <em>(empty)</em>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function MatchFields({
  question, editable, onChange,
}: { question: MatchQuestion; editable: boolean; onChange?: (next: Question) => void }) {
  function setPair(i: number, side: 'left' | 'right', value: string) {
    if (!onChange) return;
    const pairs = question.pairs.map((p, idx) => (idx === i ? { ...p, [side]: value } : p));
    onChange({ ...question, pairs });
  }
  function addPair() {
    if (!onChange || question.pairs.length >= 8) return;
    onChange({ ...question, pairs: [...question.pairs, { left: '', right: '' }] });
  }
  function removePair(i: number) {
    if (!onChange || question.pairs.length <= 3) return;
    onChange({ ...question, pairs: question.pairs.filter((_, idx) => idx !== i) });
  }

  if (!editable) {
    return (
      <table className="question-card-match-table">
        <thead><tr><th>Column A</th><th>Column B</th></tr></thead>
        <tbody>
          {question.pairs.map((p, i) => (
            <tr key={i}><td>{p.left || '—'}</td><td>{p.right || '—'}</td></tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="question-card-match-editor">
      {question.pairs.map((p, i) => (
        <div key={i} className="question-card-match-row">
          <input
            type="text"
            value={p.left}
            maxLength={200}
            onChange={(e) => setPair(i, 'left', e.target.value)}
            placeholder="Column A"
            aria-label={`Match pair ${i + 1}, left`}
          />
          <span className="question-card-match-arrow">↔</span>
          <input
            type="text"
            value={p.right}
            maxLength={200}
            onChange={(e) => setPair(i, 'right', e.target.value)}
            placeholder="Column B"
            aria-label={`Match pair ${i + 1}, right`}
          />
          <button
            type="button"
            className="icon-btn question-card-match-remove"
            onClick={() => removePair(i)}
            disabled={question.pairs.length <= 3}
            aria-label={`Remove pair ${i + 1}`}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="btn-text question-card-match-add" onClick={addPair} disabled={question.pairs.length >= 8}>
        <Plus size={14} aria-hidden="true" /> Add pair
      </button>
    </div>
  );
}
