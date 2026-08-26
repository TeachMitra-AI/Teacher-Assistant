import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ClassroomStackParamList } from '../../../navigation/types';
import { ThemedText } from '../../../components/ThemedText';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { MarkAttendanceScreen } from './MarkAttendanceScreen';
import { MonthlyAttendanceScreen } from './MonthlyAttendanceScreen';

type AttendanceView = 'mark' | 'monthly';

// Entry point for the Attendance stack screen (§13, §12). A small segmented
// control, not another pushed screen — "Mark Attendance" and "Monthly
// Summary" are both scoped to the SAME selected class, exactly matching the
// web's AttendancePanel.tsx mark/monthly segmented control (§12: "a
// segmented control inside the Attendance screen").
type Props = NativeStackScreenProps<ClassroomStackParamList, 'Attendance'>;

export function AttendanceScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { classId, className } = route.params;
  const [view, setView] = useState<AttendanceView>('mark');

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.tabRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <Pressable
          onPress={() => setView('mark')}
          style={[styles.tab, view === 'mark' && { backgroundColor: colors.surface }]}
          accessibilityRole="tab"
          accessibilityState={{ selected: view === 'mark' }}
          testID="attendance-tab-mark"
        >
          <ThemedText style={[styles.tabLabel, view === 'mark' && styles.tabLabelActive]}>Mark Attendance</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setView('monthly')}
          style={[styles.tab, view === 'monthly' && { backgroundColor: colors.surface }]}
          accessibilityRole="tab"
          accessibilityState={{ selected: view === 'monthly' }}
          testID="attendance-tab-monthly"
        >
          <ThemedText style={[styles.tabLabel, view === 'monthly' && styles.tabLabelActive]}>Monthly Summary</ThemedText>
        </Pressable>
      </View>

      {view === 'mark' ? (
        <MarkAttendanceScreen classId={classId} />
      ) : (
        <MonthlyAttendanceScreen
          classId={classId}
          onSelectStudent={({ studentId, studentName, month }) =>
            navigation.navigate('StudentAttendanceHistory', { studentId, studentName, classId, className, month })
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabRow: {
    flexDirection: 'row', margin: spacing.lg, marginBottom: 0, padding: 3,
    borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm - 2, alignItems: 'center' },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  tabLabelActive: { fontWeight: '700' },
});
