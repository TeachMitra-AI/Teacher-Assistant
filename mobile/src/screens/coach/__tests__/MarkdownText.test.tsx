// Component tests for the table/MCQ-options/sub-part rendering added to
// MarkdownText to close the legacy-markdown preview gap with
// client/src/lib/format.ts (docs comment in ../../../lib/formatMarkdown.ts).
// Parsing itself is covered by lib/__tests__/formatMarkdown.test.ts — these
// tests only check that each new block type actually reaches the screen.
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { MarkdownText } from '../MarkdownText';

async function renderText(text: string) {
  return await render(
    <ThemeProvider>
      <MarkdownText text={text} />
    </ThemeProvider>
  );
}

describe('MarkdownText', () => {
  it('renders a pipe table as header and cell text', async () => {
    await renderText('| # | Step |\n|---|---|\n| 1 | Cut the roti in half |\n');
    expect(screen.getByText('Step')).toBeTruthy();
    expect(screen.getByText('Cut the roti in half')).toBeTruthy();
  });

  it('renders MCQ options with their letter prefix', async () => {
    await renderText('1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6');
    expect(screen.getByText(/A\.\s*3/)).toBeTruthy();
    expect(screen.getByText(/D\.\s*6/)).toBeTruthy();
  });

  it('renders a lettered sub-part with its parenthesised label', async () => {
    await renderText('(a) Define photosynthesis.');
    expect(screen.getByText(/\(a\)\s*Define photosynthesis\./)).toBeTruthy();
  });

  it('still renders a plain ordered list (unaffected by the new block types)', async () => {
    await renderText('1. First\n2. Second');
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
  });
});
