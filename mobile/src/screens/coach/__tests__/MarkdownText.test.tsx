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

  // A numbered question followed by MCQ options ends up in its own
  // single-item list block, separate from the next question's block (see
  // lib/formatMarkdown.ts's extractStructuralBlocks) — without the literal
  // source number, every such block rendered "1." (array position instead
  // of source order), so a real quiz mixing question types showed "1." for
  // every question after the first.
  it('numbers questions by their literal source number, not by array position, when MCQ options split them into separate blocks', async () => {
    await renderText(
      '1. Which is a primary color?\nA. Red\nB. Green\nC. Blue\nD. Yellow\n\n2. Name a secondary color.'
    );
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
  });

  // react-native-webview is mocked to a plain <View testID="mock-webview">
  // in jest.setup.ts. Text containing LaTeX math bypasses the native block
  // parser above entirely and renders as ONE WebView loaded with
  // lib/formatHtml.ts's HTML (components/FormattedHtmlView.tsx) — see that
  // file's own comment for why one WebView per expression (an earlier
  // version) doesn't hold up on a real exam paper. KaTeX's actual rendering
  // is covered directly by lib/__tests__/math.test.ts and
  // lib/__tests__/formatHtml.test.ts; these just check the routing.
  describe('LaTeX math', () => {
    it('routes math-containing text to a single WebView instead of the native block tree', async () => {
      await renderText('A. $x^2$\nB. $x^3$\nC. $x^4$\nD. $x^5$');
      expect(screen.getAllByTestId('mock-webview')).toHaveLength(1);
    });

    it('still routes math-free text through the native block tree', async () => {
      await renderText('1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6');
      expect(screen.queryByTestId('mock-webview')).toBeNull();
      expect(screen.getByText(/A\.\s*3/)).toBeTruthy();
    });
  });
});
