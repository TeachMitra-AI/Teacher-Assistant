// Renders the block structure lib/formatMarkdown.ts parses out of a Coach
// answer as native Text/View — the RN analogue of client/src/lib/format.ts's
// HTML string (see that file's own doc comment for what is deliberately not
// ported: pipe tables, MCQ option layout, LaTeX math).
import React from 'react';
import { View, Text, StyleSheet, type TextStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import { parseMarkdownBlocks, type InlineSegment } from '../../lib/formatMarkdown';

function Inline({ segments, style }: { segments: InlineSegment[]; style: TextStyle }) {
  return (
    <Text style={style}>
      {segments.map((seg, i) => (
        <Text key={i} style={seg.bold ? styles.bold : undefined}>
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

// Heading sizes match .response-body h1/h2/h3 (UI_REFINED.md §10.3): h1
// 1.3rem/--text, h2 1.15rem/--orange, h3 1.05rem/--orange (h4+ falls back to
// h3's size — the web has no h4+ rule in this context).
function headingStyle(level: number, colors: { text: string; orange: string }): TextStyle {
  if (level === 1) return { color: colors.text, fontSize: 21, fontWeight: '700', lineHeight: 26 };
  if (level === 2) return { color: colors.orange, fontSize: 18, fontWeight: '700', lineHeight: 23, marginTop: 6 };
  return { color: colors.orange, fontSize: 16, fontWeight: '700', lineHeight: 21 };
}

export function MarkdownText({ text }: { text: string }) {
  const { colors } = useTheme();
  const blocks = parseMarkdownBlocks(text);
  // .response-body's line-height: 1.7 on paragraphs (UI_REFINED.md §10.3).
  const bodyStyle = { color: colors.text, fontSize: 15, lineHeight: 25 };

  return (
    <View style={styles.container}>
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          return <Inline key={i} segments={block.segments} style={headingStyle(block.level, colors)} />;
        }
        if (block.type === 'list') {
          return (
            <View key={i} style={styles.list}>
              {block.items.map((item, j) => (
                <View key={j} style={styles.listRow}>
                  <Text style={[bodyStyle, styles.marker]}>{block.ordered ? `${j + 1}.` : '•'}</Text>
                  <Inline segments={item} style={{ ...bodyStyle, flexShrink: 1 }} />
                </View>
              ))}
            </View>
          );
        }
        return <Inline key={i} segments={block.segments} style={bodyStyle} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  bold: { fontWeight: '700' },
  list: { gap: spacing.xs },
  listRow: { flexDirection: 'row', gap: spacing.xs },
  // 21dp indent for the marker column, matching .response-body li's 1.3rem
  // web indent (UI_REFINED.md §10.3).
  marker: { minWidth: 21 },
});
