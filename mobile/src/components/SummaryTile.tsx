import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { ThemedText } from './ThemedText';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';

export type SummaryTileTone = 'neutral' | 'positive' | 'negative';

interface SummaryTileProps {
  label: string;
  value: string | number;
  tone?: SummaryTileTone;
  // Only set by SummaryTileRow (below), to make each tile share the row's
  // actual width instead of using its own intrinsic minimum — left unset,
  // a standalone SummaryTile keeps its natural minWidth (e.g. AdminAnalyticsScreen's
  // wrapping stat grid, which is not a SummaryTileRow).
  style?: StyleProp<ViewStyle>;
}

// Native equivalent of index.css's .classroom-summary-tile (§22) — the
// present/absent/unmarked stat tiles that will anchor the Attendance and
// Fees screens (§13, §14), and the Class Home summary strip (§12).
export function SummaryTile({ label, value, tone = 'neutral', style }: SummaryTileProps) {
  const { colors } = useTheme();
  const valueColor =
    tone === 'positive' ? colors.semantic.success.text : tone === 'negative' ? colors.semantic.danger.text : colors.text;

  return (
    <Card style={[styles.card, style]}>
      <ThemedText style={[styles.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </ThemedText>
      <ThemedText variant="muted" style={styles.label} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', minWidth: 90, paddingVertical: 12, paddingHorizontal: 4 },
  value: { fontSize: 24, fontWeight: '700' },
  label: { fontSize: 12, marginTop: 2, textAlign: 'center' },
});

// Re-exported so a row of tiles can be laid out consistently without every
// screen redefining the same flex row. Every tile is forced to flex:1 with
// minWidth:0 (overriding SummaryTile's own default minWidth) so the row
// always divides the screen's ACTUAL available width between however many
// tiles it holds — a fixed per-tile minimum (the old default) summed to more
// than the screen width on a 4-tile row on many phones, pushing the last
// tile ("100%") off-screen instead of shrinking to fit.
export function SummaryTileRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={rowStyles.row}>
      {React.Children.map(children, (child) =>
        React.isValidElement<SummaryTileProps>(child) ? React.cloneElement(child, { style: rowStyles.tile }) : child
      )}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, minWidth: 0 },
});
