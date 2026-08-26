import React, { useLayoutEffect, useState } from 'react';
import { View, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Users, UserPlus, Pencil } from 'lucide-react-native';
import type { ClassroomStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { useStudentsScreen } from './useStudentsScreen';
import { StudentFormModal } from './StudentFormModal';
import type { Student } from '../../types';

// Students list + Add/Edit (Phase 8 Step 3), replacing the Phase 2
// PlaceholderScreen. Interaction pattern (not markup) follows the web's
// StudentRoster.tsx: name required, roll number optional, list sorted by
// name. Deactivate/restore stays out of scope this step (§ useStudentsScreen.ts).
type Props = NativeStackScreenProps<ClassroomStackParamList, 'Students'>;

export function StudentsScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { classId } = route.params;
  const { students, loading, error, reload, creating, createError, createStudent, savingEdit, editError, editStudent } =
    useStudentsScreen(classId);

  // null = closed, 'add' = create form, a Student = editing that student.
  const [formTarget, setFormTarget] = useState<'add' | Student | null>(null);
  // Bumped on every open (see the modal's `key` below) — without it, opening
  // "Add" twice in a row reuses the same key ('add') and React never
  // remounts StudentFormModal between them, so a successful first add's
  // leftover text would silently reappear on the second open. A fresh nonce
  // per open guarantees fresh form state every time, success or cancel.
  const [formNonce, setFormNonce] = useState(0);

  function openForm(target: 'add' | Student) {
    setFormTarget(target);
    setFormNonce((n) => n + 1);
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => openForm('add')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add student"
          testID="students-add-button"
          style={[styles.headerBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          <UserPlus size={18} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, colors]);

  async function handleSubmit(name: string, rollNumber: string) {
    const ok =
      formTarget === 'add'
        ? await createStudent({ name, rollNumber: rollNumber || undefined })
        : formTarget
          ? await editStudent(formTarget.id, { name, rollNumber: rollNumber || undefined })
          : false;
    if (ok) setFormTarget(null);
  }

  const isAdd = formTarget === 'add';
  const editingStudent = formTarget && formTarget !== 'add' ? formTarget : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.loadingText}>Loading students…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </View>
      )}

      {!loading && !error && students.length === 0 && (
        <View style={styles.center} testID="students-empty-state">
          <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
            <Users size={26} color={colors.textMuted} strokeWidth={1.8} />
          </View>
          <ThemedText variant="title" style={styles.emptyTitle}>No students yet</ThemedText>
          <ThemedText variant="muted" style={styles.emptyHint}>Add your first student to get started.</ThemedText>
        </View>
      )}

      {!loading && !error && students.length > 0 && (
        <FlatList
          data={students}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          testID="students-list"
          renderItem={({ item }) => (
            <View style={[styles.row, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <View style={styles.rowText}>
                <ThemedText style={styles.name}>{item.name}</ThemedText>
                <ThemedText variant="muted" style={styles.meta}>
                  {item.rollNumber ? `Roll no. ${item.rollNumber}` : 'No roll number'}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => openForm(item)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}`}
                style={styles.editBtn}
              >
                <Pencil size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          )}
        />
      )}

      <StudentFormModal
        key={`${isAdd ? 'add' : (editingStudent?.id ?? 'closed')}-${formNonce}`}
        visible={formTarget !== null}
        title={isAdd ? 'Add student' : `Edit ${editingStudent?.name ?? 'student'}`}
        submitLabel={isAdd ? 'Add' : 'Save'}
        initialName={editingStudent?.name}
        initialRollNumber={editingStudent?.rollNumber ?? ''}
        submitting={isAdd ? creating : savingEdit}
        error={isAdd ? createError : editError}
        onSubmit={handleSubmit}
        onClose={() => setFormTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  loadingText: { marginTop: spacing.xs },
  emptyIconWell: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.xl },
  list: { gap: spacing.sm, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, minHeight: 56,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 },
  editBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerBtn: {
    width: 36, height: 36, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm,
  },
});
