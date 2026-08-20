import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ClassroomStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';

// Card list, "+ New Class" (§11). MOCK DATA for Phase 2 — exists only to
// exercise the nested-stack navigation pattern (ClassList -> ClassHome ->
// {Students, Attendance, Fees, Reports}, §12) on a real device before real
// data exists. Phase 8 replaces this list with GET /classroom/classes via
// the already-ported classroomApi.listClasses (mobile/src/api/classroomApi.ts).
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
        <Pressable key={c.classId} onPress={() => navigation.navigate('ClassHome', c)}>
          <Card style={styles.card}>
            <ThemedText style={styles.name}>{c.className}</ThemedText>
            <ThemedText variant="muted">Tap to open</ThemedText>
          </Card>
        </Pressable>
      ))}
      <ThemedText variant="muted" style={styles.note}>
        Mock classes shown above — Phase 8 wires this list to GET /classroom/classes.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  card: { gap: 4 },
  name: { fontSize: 16, fontWeight: '600' },
  note: { marginTop: 8, textAlign: 'center' },
});
