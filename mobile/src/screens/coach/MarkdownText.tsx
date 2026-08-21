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

export function MarkdownText({ text }: { text: string }) {
  const { colors } = useTheme();
  const blocks = parseMarkdownBlocks(text);
  const bodyStyle = { color: colors.text, fontSize: 15, lineHeight: 22 };

  return (
    <View style={styles.container}>
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          const size = block.level <= 2 ? 18 : 16;
          return <Inline key={i} segments={block.segments} style={{ color: colors.text, fontSize: size }} />;
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
  marker: { minWidth: 18 },
});
