import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';

export type SummaryTileTone = 'neutral' | 'positive' | 'negative';

interface SummaryTileProps {
  label: string;
  value: string | number;
  tone?: SummaryTileTone;
}

// Native equivalent of index.css's .classroom-summary-tile (§22) — the
// present/absent/unmarked stat tiles that will anchor the Attendance and
// Fees screens (§13, §14), and the Class Home summary strip (§12).
export function SummaryTile({ label, value, tone = 'neutral' }: SummaryTileProps) {
  const { colors } = useTheme();
  const valueColor =
    tone === 'positive' ? colors.semantic.success.text : tone === 'negative' ? colors.semantic.danger.text : colors.text;

  return (
    <Card style={styles.card}>
      <ThemedText style={[styles.value, { color: valueColor }]}>{value}</ThemedText>
      <ThemedText variant="muted" style={styles.label}>
        {label}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', minWidth: 90, paddingVertical: 12 },
  value: { fontSize: 24, fontWeight: '700' },
  label: { fontSize: 12, marginTop: 2 },
});

// Re-exported so a row of tiles can be laid out consistently without every
// screen redefining the same flex row.
export function SummaryTileRow({ children }: { children: React.ReactNode }) {
  return <View style={rowStyles.row}>{children}</View>;
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
});
