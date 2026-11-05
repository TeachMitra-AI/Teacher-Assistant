import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeachingContextMenu from './TeachingContextMenu';
import { GRADES } from '../config';

function setup() {
  const onContextChange = vi.fn();
  render(
    <>
      <TeachingContextMenu
        language="en"
        onLanguageChange={vi.fn()}
        context={{ grade: '', subject: '', classroomType: '', issueType: '' }}
        onContextChange={onContextChange}
      />
      <button type="button">Outside</button>
    </>,
  );
  return { user: userEvent.setup(), onContextChange };
}

const trigger = () => screen.getByRole('button', { name: 'Teaching context' });
const panel = () => screen.queryByRole('dialog', { name: 'Teaching context' });
const closeButton = () => screen.getByRole('button', { name: 'Close teaching context' });

describe('TeachingContextMenu', () => {
  test('the X closes the panel', async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.click(closeButton());
    expect(panel()).toBeNull();
  });

  test('a field change applies immediately and the X does not undo it', async () => {
    const { user, onContextChange } = setup();
    await user.click(trigger());
    await user.selectOptions(screen.getByLabelText('Grade'), GRADES[0]);
    expect(onContextChange).toHaveBeenCalledWith('grade', GRADES[0]);

    await user.click(closeButton());
    expect(onContextChange).toHaveBeenCalledTimes(1);
  });

  test('Escape and an outside click still close the panel', async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(panel()).toBeNull();

    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(panel()).toBeNull();
  });
});
