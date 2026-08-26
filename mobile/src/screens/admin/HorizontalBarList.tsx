// Native stand-in for the web's recharts Bar/Pie breakdowns (By subject / By
// focus area / By language, client/src/pages/AdminPage.tsx) — recharts is a
// web-only dependency with no RN build, and adding a native charting library
// for three small ranked breakdowns isn't warranted (CLAUDE.md's simplicity
// rule). A ranked horizontal-bar list conveys the same "who's biggest"
// comparison recharts' bar/pie views give, reads better than a squeezed pie
// on a phone-width screen, and needs no new dependency — see
// docs/mobile-app-plan.md's Phase 7c Admin Analytics note for this deviation.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';

interface HorizontalBarListProps {
  data: { label: string; count: number }[];
  color: string;
  emptyLabel?: string;
}

export function HorizontalBarList({ data, color, emptyLabel = 'No data yet.' }: HorizontalBarListProps) {
  const { colors } = useTheme();
  if (data.length === 0) {
    return <ThemedText variant="muted" style={styles.empty}>{emptyLabel}</ThemedText>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <View style={styles.list}>
      {data.map((d) => (
        <View key={d.label} style={styles.row}>
          <ThemedText numberOfLines={1} style={styles.label}>{d.label}</ThemedText>
          <View style={[styles.track, { backgroundColor: colors.surface2 }]}>
            <View style={[styles.fill, { backgroundColor: color, width: `${(d.count / max) * 100}%` }]} />
          </View>
          <ThemedText variant="muted" style={styles.count}>{d.count}</ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { flex: 1, fontSize: 13 },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  count: { fontSize: 12, minWidth: 24, textAlign: 'right' },
  empty: { fontSize: 13, textAlign: 'center', paddingVertical: spacing.md },
});
