// Native stand-in for the web's recharts AreaChart ("Questions over time",
// client/src/pages/AdminPage.tsx) — see HorizontalBarList.tsx's header
// comment for why this pass doesn't add a native charting dependency.
// Simple proportional-height bars in a horizontal scroll convey the same
// day-by-day trend.
import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';

interface DailyTrendChartProps {
  data: { date: string; count: number }[];
  color: string;
}

const CHART_HEIGHT = 100;
const BAR_WIDTH = 10;

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function DailyTrendChart({ data, color }: DailyTrendChartProps) {
  const { colors } = useTheme();
  if (data.length === 0) {
    return <ThemedText variant="muted" style={styles.empty}>No data yet.</ThemedText>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      {data.map((d, i) => {
        const showLabel = i === 0 || i === data.length - 1 || i % 5 === 0;
        return (
          <View key={`${d.date}-${i}`} style={styles.column}>
            <View style={[styles.track, { backgroundColor: colors.surface2 }]}>
              <View
                style={[
                  styles.bar,
                  { backgroundColor: color, height: Math.max((d.count / max) * CHART_HEIGHT, d.count > 0 ? 3 : 0) },
                ]}
              />
            </View>
            <ThemedText variant="muted" numberOfLines={1} style={styles.dateLabel}>
              {showLabel ? shortDate(d.date) : ''}
            </ThemedText>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { alignItems: 'flex-end', gap: 3, paddingVertical: spacing.xs },
  column: { alignItems: 'center', width: BAR_WIDTH + 6 },
  track: { width: BAR_WIDTH, height: CHART_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: BAR_WIDTH, borderRadius: 3 },
  dateLabel: { fontSize: 9, marginTop: 4, transform: [{ rotate: '-40deg' }], width: 32 },
  empty: { fontSize: 13, textAlign: 'center', paddingVertical: spacing.md },
});
