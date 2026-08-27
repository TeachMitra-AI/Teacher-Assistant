// Shared presentational tile blocks for the Reports screen's two tabs
// (§26 Phase 11) — the "This Class" and "All Classes" views both render an
// attendance block and a fee block, differing only in scope (one class vs.
// every class) and whether a "Days Marked" tile applies (a single day's
// snapshot has no "days marked" concept, a month-scoped one does). Kept
// local to this feature, not promoted to components/, since nothing outside
// Reports needs them.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '../../../components/ThemedText';
import { SummaryTile, SummaryTileRow } from '../../../components/SummaryTile';
import { spacing } from '../../../theme/tokens';

export function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

interface AttendanceSummaryBlockProps {
  title: string;
  totalStudents: number;
  daysMarked?: number;
  present: number;
  absent: number;
  unmarked: number;
  percentage: number | null;
}

export function AttendanceSummaryBlock({
  title,
  totalStudents,
  daysMarked,
  present,
  absent,
  unmarked,
  percentage,
}: AttendanceSummaryBlockProps) {
  return (
    <View style={styles.section}>
      <ThemedText variant="title" style={styles.sectionTitle}>{title}</ThemedText>
      <SummaryTileRow>
        <SummaryTile label="Students" value={totalStudents} />
        {daysMarked !== undefined && <SummaryTile label="Days Marked" value={daysMarked} />}
        <SummaryTile label="Average" value={pct(percentage)} />
      </SummaryTileRow>
      <SummaryTileRow>
        <SummaryTile label="Present" value={present} tone="positive" />
        <SummaryTile label="Absent" value={absent} tone="negative" />
        <SummaryTile label="Unmarked" value={unmarked} />
      </SummaryTileRow>
    </View>
  );
}

interface FeeSummaryBlockProps {
  title: string;
  totalStudents: number;
  paid: number;
  partial: number;
  pending: number;
  totalCollected: number;
  totalExpected: number;
}

export function FeeSummaryBlock({
  title,
  totalStudents,
  paid,
  partial,
  pending,
  totalCollected,
  totalExpected,
}: FeeSummaryBlockProps) {
  return (
    <View style={styles.section}>
      <ThemedText variant="title" style={styles.sectionTitle}>{title}</ThemedText>
      <SummaryTileRow>
        <SummaryTile label="Total Students" value={totalStudents} />
        <SummaryTile label="Paid" value={paid} tone="positive" />
        <SummaryTile label="Partial" value={partial} />
        <SummaryTile label="Pending" value={pending} tone="negative" />
      </SummaryTileRow>
      <ThemedText variant="muted" style={styles.collectedLine}>
        ₹{totalCollected} collected{totalExpected > 0 ? ` of ₹${totalExpected} expected` : ''} this month.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 15 },
  collectedLine: { fontSize: 13 },
});
