import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Info } from 'lucide-react-native';
import type { ClassroomStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';

// Card list, "+ New Class" (§11). MOCK DATA for Phase 2 — exists only to
// exercise the nested-stack navigation pattern (ClassList -> ClassHome ->
// {Students, Attendance, Fees, Reports}, §12) on a real device before real
// data exists. Phase 8 replaces this list with GET /classroom/classes via
// the already-ported classroomApi.listClasses (mobile/src/api/classroomApi.ts).
// Row styling (this pass, Phase 7c): flat surface-2 row matching
// .classroom-class-item, not an elevated Card (UI_REFINED.md §11).
const MOCK_CLASSES = [
  { classId: 'mock-1', className: 'Grade 6 - Section A' },
  { classId: 'mock-2', className: 'Grade 7 - Section B' },
];

type Props = NativeStackScreenProps<ClassroomStackParamList, 'ClassList'>;

export function ClassListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {MOCK_CLASSES.map((c) => (
        <Pressable
          key={c.classId}
          onPress={() => navigation.navigate('ClassHome', c)}
          style={[styles.row, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          <ThemedText style={styles.name}>{c.className}</ThemedText>
          <ThemedText variant="muted" style={styles.meta}>Tap to open</ThemedText>
        </Pressable>
      ))}
      <View style={[styles.note, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <Info size={15} color={colors.textMuted} />
        <ThemedText variant="muted" style={styles.noteText}>
          Mock classes shown above — Phase 8 wires this list to GET /classroom/classes.
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.md },
  row: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.sm,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17 },
});
