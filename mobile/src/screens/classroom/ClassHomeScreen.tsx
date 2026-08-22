import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ClassroomStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';

type Props = NativeStackScreenProps<ClassroomStackParamList, 'ClassHome'>;

// Four large shortcut cards, not five small tabs (§12) — the class name as
// the screen title, pushed screens for Students/Attendance/Fees/Reports
// (§12: "each a stack screen pushed from Class Home, not sibling tabs").
// The live summary strip (GET /classroom/analytics/classes/:classId) is
// Phase 8/11 work — this is the Phase 2 navigation shell only.
const SHORTCUTS = [
  { route: 'Attendance', label: "Mark Today's Attendance" },
  { route: 'Students', label: 'Students' },
  { route: 'Fees', label: 'Fees this Month' },
  { route: 'Reports', label: 'Reports' },
] as const;

export function ClassHomeScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { classId, className } = route.params;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.grid}>
        {SHORTCUTS.map((s) => (
          <Pressable
            key={s.route}
            style={styles.gridItem}
            onPress={() => navigation.navigate(s.route, { classId, className })}
          >
            <Card style={styles.card}>
              <ThemedText style={styles.label}>{s.label}</ThemedText>
            </Card>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { width: '47%' },
  card: { minHeight: 100, alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '600', textAlign: 'center' },
});
