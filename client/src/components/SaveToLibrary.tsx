import { useRef, useState, type FormEvent } from 'react';
import { BookmarkPlus, Check } from 'lucide-react';
import { useDismissable } from '../hooks/useDismissable';
import { useToast } from './Toast';
import { createResource } from '../lib/resources';
import { RESOURCE_TYPES, RESOURCE_TYPE_META } from '../config';
import { ApiError } from '../api';
import type { QueryContext, ResourceType } from '../types';

interface SaveToLibraryProps {
  query: string;
  text: string;
  language: string;
  context: QueryContext;
  queryId: string | null;
}

// Suggest a resource type from the phrasing the teacher used, so the picker
// defaults sensibly. Falls back to a general resource.
function guessType(query: string): ResourceType {
  const q = query.toLowerCase();
  if (q.includes('lesson plan')) return 'lesson_plan';
  if (q.includes('activity') || q.includes('game')) return 'classroom_activity';
  if (q.includes('assessment') || q.includes('quiz') || q.includes('test') || q.includes('worksheet')) return 'assessment';
  if (q.includes('explain') || q.includes('what is') || q.includes('how does')) return 'explanation';
  return 'general';
}

function defaultTitle(query: string): string {
  const trimmed = query.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Saved resource';
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

export default function SaveToLibrary({ query, text, language, context, queryId }: SaveToLibraryProps) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(() => defaultTitle(query));
  const [type, setType] = useState<ResourceType>(() => guessType(query));

  const ref = useRef<HTMLDivElement>(null);
  useDismissable(open, ref, () => setOpen(false));

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      show('Please enter a title', 'error');
      return;
    }
    setSaving(true);
    try {
      await createResource({
        type,
        title: cleanTitle.slice(0, 200),
        grade: context.grade || undefined,
        subject: context.subject || undefined,
        language,
        content: text,
        sourceQueryId: queryId || undefined,
      });
      setSaved(true);
      setOpen(false);
      show('Saved to your library', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not save resource', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="save-library" ref={ref}>
      <button
        type="button"
        className={`action-chip${saved ? ' saved' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={saved ? 'Saved to Library' : 'Save to Library'}
        title={saved ? 'Saved to Library' : 'Save to Library'}
      >
        {saved ? <Check size={15} aria-hidden="true" /> : <BookmarkPlus size={15} aria-hidden="true" />}
      </button>

      {open && (
        <form className="save-popover" onSubmit={handleSave} role="dialog" aria-label="Save to library">
          <label className="save-field">
            <span>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
            />
          </label>
          <label className="save-field">
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as ResourceType)}>
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>{RESOURCE_TYPE_META[t].label}</option>
              ))}
            </select>
          </label>
          <div className="save-actions">
            <button type="button" className="btn-text" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary save-submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
