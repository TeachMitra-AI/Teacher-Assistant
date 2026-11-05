import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageBubble from './MessageBubble';
import { ToastProvider } from './Toast';
import type { Turn } from '../types';

vi.mock('../auth', () => ({ useAuth: () => ({ featureFlags: null }) }));
vi.mock('./HelpSupport', () => ({ useHelpSupport: () => ({ openBugReport: vi.fn() }) }));

const QUERY = 'Explain photosynthesis';

// An errored turn is editable and renders no ResponseCard, which keeps the test on the edit box.
const turn = {
  id: 'turn-1',
  query: QUERY,
  language: 'English',
  status: 'error',
  error: 'Something went wrong',
  rating: null,
} as Turn;

async function openEditor() {
  const onEdit = vi.fn();
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <MessageBubble turn={turn} onFeedback={vi.fn()} onRetry={vi.fn()} onEdit={onEdit} />
    </ToastProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Edit message' }));
  const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit your question' });
  return { user, onEdit, textarea };
}

describe('MessageBubble prompt editor', () => {
  it('opens focused with the caret at the end of the text', async () => {
    const { textarea } = await openEditor();

    expect(textarea).toHaveFocus();
    expect(textarea.value).toBe(QUERY);
    expect(textarea.selectionStart).toBe(QUERY.length);
    expect(textarea.selectionEnd).toBe(QUERY.length);
  });

  it('keeps the caret in place when deleting mid-text', async () => {
    const { user, textarea } = await openEditor();

    await user.type(textarea, '{Backspace}', { initialSelectionStart: 3, initialSelectionEnd: 3 });
    expect(textarea.value).toBe('Exlain photosynthesis');
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);

    // A second keystroke lands at the caret too, not at the end of the text.
    await user.keyboard('{Backspace}');
    expect(textarea.value).toBe('Elain photosynthesis');
    expect(textarea.selectionStart).toBe(1);
  });

  it('keeps the caret in place when typing mid-text', async () => {
    const { user, textarea } = await openEditor();

    await user.type(textarea, 'XY', { initialSelectionStart: 2, initialSelectionEnd: 2 });

    expect(textarea.value).toBe('ExXYplain photosynthesis');
    expect(textarea.selectionStart).toBe(4);
    expect(textarea.selectionEnd).toBe(4);
  });

  it('still grows with the text, up to the height ceiling', async () => {
    const { user, textarea } = await openEditor();
    const scrollHeight = vi.spyOn(textarea, 'scrollHeight', 'get');

    scrollHeight.mockReturnValue(120);
    await user.keyboard('a');
    expect(textarea.style.height).toBe('120px');

    scrollHeight.mockReturnValue(500);
    await user.keyboard('b');
    expect(textarea.style.height).toBe('200px');
  });

  it('Save submits the trimmed draft and closes the editor', async () => {
    const { user, onEdit, textarea } = await openEditor();

    await user.type(textarea, '{Backspace}', { initialSelectionStart: 3, initialSelectionEnd: 3 });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('turn-1', 'Exlain photosynthesis');
    expect(screen.queryByRole('textbox', { name: 'Edit your question' })).not.toBeInTheDocument();
  });

  it('Cancel discards the draft, and reopening starts from the sent prompt', async () => {
    const { user, onEdit, textarea } = await openEditor();

    await user.type(textarea, '{Backspace}', { initialSelectionStart: 3, initialSelectionEnd: 3 });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Edit your question' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit message' }));
    const reopened = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit your question' });
    expect(reopened.value).toBe(QUERY);
    expect(reopened.selectionStart).toBe(QUERY.length);
  });
});
