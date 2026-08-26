import React, { useCallback, useLayoutEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ClipboardCheck, Users, Wallet, BarChart3, ChevronRight, ChevronDown, type LucideIcon } from 'lucide-react-native';
import type { ClassroomStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { Button } from '../../components/Button';
import { SummaryTile, SummaryTileRow } from '../../components/SummaryTile';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { useClassHomeScreen } from './useClassHomeScreen';
import { useClassSwitcher } from './useClassSwitcher';
import { ClassSwitcherModal } from './ClassSwitcherModal';
import type { SchoolClass } from '../../types';

// Four shortcut rows, not five small tabs (§12) — the class name as a
// tappable header title (ClassroomStack.tsx's static `options.title` is
// still the fallback/back-button-label value; this screen overrides it with
// an interactive headerTitle via navigation.setOptions once mounted, opening
// the Phase 8 Step 4 class switcher), pushed screens for Students/
// Attendance/Fees/Reports (§12: "each a stack screen pushed
// from Class Home, not sibling tabs"). Row shape (icon well + label +
// chevron) matches .quick-action-card, not a centred label-only tile —
// UI_REFINED.md §11, icons per its own suggestion. These stay
// navigation/placeholder entry points only — Students is wired for real in
// Phase 8 Step 3; Attendance/Fees/Reports functionality belongs to Phases
// 9/10/11 respectively and is deliberately not implemented here.
const SHORTCUTS: { route: 'Attendance' | 'Students' | 'Fees' | 'Reports'; label: string; icon: LucideIcon }[] = [
  { route: 'Attendance', label: "Mark Today's Attendance", icon: ClipboardCheck },
  { route: 'Students', label: 'Students', icon: Users },
  { route: 'Fees', label: 'Fees this Month', icon: Wallet },
  { route: 'Reports', label: 'Reports', icon: BarChart3 },
];

export function ClassHomeScreen({ route, navigation }: NativeStackScreenProps<ClassroomStackParamList, 'ClassHome'>) {
  const { colors } = useTheme();
  const { classId, className } = route.params;
  const { today, totalStudents, loading, error, reload } = useClassHomeScreen(classId);

  // Class switcher (§12: "a compact class-switcher in the Class Home
  // header ... same stack / selected class changes / Class Home refreshes
  // for selected class"). navigation.setParams updates THIS screen's own
  // route params in place — no push, no pop — which is what re-triggers
  // useClassHomeScreen's [classId] effect above.
  const { classes: switcherClasses, loading: switcherLoading, error: switcherError, load: loadSwitcher } = useClassSwitcher();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const openSwitcher = useCallback(() => {
    setSwitcherOpen(true);
    loadSwitcher();
  }, [loadSwitcher]);

  function handleSelectClass(cls: SchoolClass) {
    setSwitcherOpen(false);
    if (cls.id === classId) return;
    navigation.setParams({ classId: cls.id, className: cls.name });
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Pressable
          onPress={openSwitcher}
          style={styles.headerTitle}
          accessibilityRole="button"
          accessibilityLabel={`${className}. Switch class.`}
          testID="classhome-switcher-trigger"
        >
          <ThemedText style={[styles.headerTitleText, { color: colors.text }]} numberOfLines={1}>
            {className}
          </ThemedText>
          <ChevronDown size={16} color={colors.textMuted} />
        </Pressable>
      ),
    });
  }, [navigation, className, colors, openSwitcher]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Today's live summary strip (§12) — sourced from
          getDailyAttendance(classId, today).summary, the only endpoint that
          actually has a per-class "today" breakdown (see useClassHomeScreen.ts
          and ClassAnalytics's doc comment in types/index.ts for why the
          per-class analytics endpoint alone can't provide this). Degrades
          gracefully: the shortcut cards below render regardless of this
          strip's own loading/error state. */}
      {loading && (
        <View style={[styles.strip, styles.stripCenter]}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.stripLoadingText}>Loading today&rsquo;s summary…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={[styles.strip, styles.stripCenter]}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={reload} style={styles.stripRetry} />
        </View>
      )}

      {!loading && !error && today && (
        <View style={styles.strip}>
          {totalStudents != null && (
            <ThemedText variant="muted" style={styles.stripCaption}>
              Today&rsquo;s attendance · {totalStudents} student{totalStudents === 1 ? '' : 's'}
            </ThemedText>
          )}
          <SummaryTileRow>
            <SummaryTile label="Present" value={today.present} tone="positive" />
            <SummaryTile label="Absent" value={today.absent} tone="negative" />
            <SummaryTile label="Unmarked" value={today.unmarked} tone="neutral" />
          </SummaryTileRow>
        </View>
      )}

      {SHORTCUTS.map((s) => (
        <Pressable
          key={s.route}
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => navigation.navigate(s.route, { classId, className })}
        >
          <View style={[styles.iconWell, { backgroundColor: colors.orangeSoft }]}>
            <s.icon size={18} color={colors.orange} />
          </View>
          <ThemedText style={styles.label}>{s.label}</ThemedText>
          <ChevronRight size={18} color={colors.textMuted} />
        </Pressable>
      ))}

      <ClassSwitcherModal
        visible={switcherOpen}
        classes={switcherClasses}
        loading={switcherLoading}
        error={switcherError}
        currentClassId={classId}
        onSelect={handleSelectClass}
        onRetry={loadSwitcher}
        onClose={() => setSwitcherOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 220 },
  headerTitleText: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  strip: { marginBottom: spacing.sm, gap: spacing.sm },
  stripCenter: { alignItems: 'center', paddingVertical: spacing.md },
  stripLoadingText: { marginTop: spacing.xs },
  stripRetry: { marginTop: spacing.xs },
  stripCaption: { fontSize: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md, minHeight: 64,
  },
  iconWell: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontWeight: '600', fontSize: 15 },
});
