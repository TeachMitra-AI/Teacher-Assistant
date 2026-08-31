// Renders the block structure lib/formatMarkdown.ts parses out of a Coach
// answer (or the Generator/Library legacy-markdown preview) as native
// Text/View — the RN analogue of client/src/lib/format.ts's HTML string (see
// that file's own doc comment for what is deliberately not ported: LaTeX
// math).
import React from 'react';
import { View, Text, ScrollView, StyleSheet, type TextStyle, type StyleProp } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { parseMarkdownBlocks, type InlineSegment, type MarkdownBlock } from '../../lib/formatMarkdown';

function Inline({ segments, style }: { segments: InlineSegment[]; style: StyleProp<TextStyle> }) {
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

// MCQ options grid — index.css:1477's .fmt-options two-column grid, hung
// under the question text at the same 1.9em indent as .fmt-li-ol/.fmt-qnum.
function Options({
  block,
  bodyStyle,
}: {
  block: Extract<MarkdownBlock, { type: 'options' }>;
  bodyStyle: TextStyle;
}) {
  return (
    <View style={styles.options}>
      {block.items.map((item, i) => (
        <Inline
          key={i}
          segments={[{ text: `${item.letter}. `, bold: true }, ...item.segments]}
          style={[bodyStyle, styles.optionItem]}
        />
      ))}
    </View>
  );
}

// Pipe table — index.css:1491's .fmt-table, scrollable sideways instead of
// reflowing (a table can't drop to one column without losing the pairing
// that makes it a table, same reasoning as the web's narrow-screen rule).
function Table({
  block,
  colors,
}: {
  block: Extract<MarkdownBlock, { type: 'table' }>;
  colors: { text: string; border: string; surface2: string };
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, { borderColor: colors.border }]}>
        <View style={styles.tableRow}>
          {block.header.map((cell, i) => (
            <Text
              key={i}
              style={[
                styles.tableCell,
                styles.tableHeaderCell,
                { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border },
                i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth },
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
        {block.rows.map((row, ri) => (
          <View key={ri} style={[styles.tableRow, { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}>
            {row.map((cell, ci) => (
              <Text
                key={ci}
                style={[
                  styles.tableCell,
                  { color: colors.text, borderColor: colors.border },
                  ci > 0 && { borderLeftWidth: StyleSheet.hairlineWidth },
                ]}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
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
                  <Text style={[bodyStyle, styles.marker, block.ordered && styles.markerBold]}>
                    {block.ordered ? `${j + 1}.` : '•'}
                  </Text>
                  <Inline segments={item} style={{ ...bodyStyle, flexShrink: 1 }} />
                </View>
              ))}
            </View>
          );
        }
        if (block.type === 'options') {
          return <Options key={i} block={block} bodyStyle={bodyStyle} />;
        }
        if (block.type === 'subpart') {
          return (
            <Inline
              key={i}
              segments={[{ text: `(${block.letter}) ` }, ...block.segments]}
              style={[bodyStyle, styles.subpart]}
            />
          );
        }
        if (block.type === 'table') {
          return <Table key={i} block={block} colors={colors} />;
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
  // .fmt-qnum's font-weight: 700 — bolds the literal question number so it
  // reads as a margin-hung numeral, the exam-paper convention.
  markerBold: { fontWeight: '700' },
  // .fmt-options: two-column grid, 1.9em/~28dp indent to align under the
  // question text above it.
  options: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs, marginLeft: 28 },
  optionItem: { flexBasis: '45%', flexGrow: 1 },
  // .fmt-subpart's margin: 0.3rem 0 0.3rem 1.9em.
  subpart: { marginLeft: 28 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  tableCell: { minWidth: 110, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, fontSize: 14 },
  tableHeaderCell: { fontWeight: '700' },
});
