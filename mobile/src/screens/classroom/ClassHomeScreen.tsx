import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ClipboardCheck, Users, Wallet, BarChart3, ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ClassroomStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';

// Four shortcut rows, not five small tabs (§12) — the class name as the
// screen title, pushed screens for Students/Attendance/Fees/Reports (§12:
// "each a stack screen pushed from Class Home, not sibling tabs"). Row shape
// (icon well + label + chevron) matches .quick-action-card, not a centred
// label-only tile — UI_REFINED.md §11, icons per its own suggestion.
// The live summary strip (GET /classroom/analytics/classes/:classId) is
// Phase 8/11 work — this is the Phase 2 navigation shell only.
const SHORTCUTS: { route: 'Attendance' | 'Students' | 'Fees' | 'Reports'; label: string; icon: LucideIcon }[] = [
  { route: 'Attendance', label: "Mark Today's Attendance", icon: ClipboardCheck },
  { route: 'Students', label: 'Students', icon: Users },
  { route: 'Fees', label: 'Fees this Month', icon: Wallet },
  { route: 'Reports', label: 'Reports', icon: BarChart3 },
];

export function ClassHomeScreen({ route, navigation }: NativeStackScreenProps<ClassroomStackParamList, 'ClassHome'>) {
  const { colors } = useTheme();
  const { classId, className } = route.params;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md, minHeight: 64,
  },
  iconWell: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontWeight: '600', fontSize: 15 },
});
