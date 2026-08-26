import React, { useEffect, useState } from 'react';
import { View, FlatList, Pressable, Switch, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { GraduationCap, Plus, Archive, RotateCcw } from 'lucide-react-native';
import type { ClassroomStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { useClassListScreen } from './useClassListScreen';
import { ClassFormModal } from './ClassFormModal';

// Real Class List (docs/mobile-app-plan.md Phase 8 Step 1) — replaces the
// Phase 2 MOCK_CLASSES stub with GET /classroom/classes via
// useClassListScreen/classroomApi.listClasses. Row content and flat
// surface-2 styling matches .classroom-class-item (UI_REFINED.md §11);
// deliberately does NOT show a per-class "today's attendance %" teaser — no
// batch endpoint exists for it (would mean an analytics call per row) and
// the web's own ClassList.tsx doesn't show one either. Today's live summary
// belongs to Class Home (Phase 8 Step 2), scoped to one class via the
// existing per-class analytics endpoint.
//
// Phase 8 Step 4: create (in-content "+ Add class" — NOT the native
// headerRight: this screen's header is a FULL override
// (ClassroomStack.tsx's `options={{ header: () => <Header /> }}`), which
// replaces native-stack's header rendering entirely and silently ignores
// headerRight/headerTitle set via navigation.setOptions — confirmed live on
// device: a headerRight button here never rendered. Sharing Header.tsx
// itself across all 4 tab roots for one Classroom-only action wasn't
// warranted, so this stays a plain in-content control instead), archive/
// restore (per-row action), and a "Show archived classes" toggle —
// interaction pattern (not markup) ported from the web's ClassList.tsx:
// archiving asks for confirmation (Alert.alert, this app's established
// destructive-confirm convention — UI_REFINED.md §16), restoring does not,
// matching the web's own asymmetry (only archive has a ConfirmDialog there).
type Props = NativeStackScreenProps<ClassroomStackParamList, 'ClassList'>;

export function ClassListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const {
    classes,
    loading,
    error,
    reload,
    showArchived,
    toggleShowArchived,
    creating,
    createError,
    createClass,
    archivingId,
    archiveError,
    toggleArchive,
  } = useClassListScreen();

  const [createOpen, setCreateOpen] = useState(false);
  // See StudentsScreen.tsx's identical `formNonce` for why this exists —
  // forces a fresh ClassFormModal mount (and thus blank fields) on every
  // open, even two consecutive "Add class" taps.
  const [createNonce, setCreateNonce] = useState(0);

  function openCreate() {
    setCreateOpen(true);
    setCreateNonce((n) => n + 1);
  }

  // Reload on focus so a class created/archived elsewhere isn't stale on
  // return — same pattern as ResourceListScreen.tsx/Step 1's original
  // ClassListScreen (React Navigation doesn't remount a stack root on
  // pop/focus).
  useEffect(() => {
    const unsub = navigation.addListener('focus', reload);
    return unsub;
  }, [navigation, reload]);

  async function handleCreate(name: string, grade: string, section: string) {
    const ok = await createClass({ name, grade: grade || undefined, section: section || undefined });
    if (ok) setCreateOpen(false);
  }

  function handleArchivePress(cls: (typeof classes)[number]) {
    if (cls.archived) {
      void toggleArchive(cls);
      return;
    }
    Alert.alert(
      'Archive this class?',
      `"${cls.name}" will move out of your active classes. Its students, attendance, and fee history are kept, and you can restore it any time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            void toggleArchive(cls);
          },
        },
      ]
    );
  }

  const visibleClasses = showArchived ? classes : classes.filter((c) => !c.archived);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Pressable
        onPress={openCreate}
        style={[styles.addRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel="Add class"
        testID="classlist-add-button"
      >
        <Plus size={18} color={colors.orange} />
        <ThemedText style={[styles.addRowLabel, { color: colors.orange }]}>Add class</ThemedText>
      </Pressable>

      <View style={styles.archivedToggle}>
        <Pressable onPress={toggleShowArchived} accessibilityRole="switch" accessibilityState={{ checked: showArchived }}>
          <ThemedText style={styles.archivedToggleLabel}>Show archived classes</ThemedText>
        </Pressable>
        <Switch value={showArchived} onValueChange={toggleShowArchived} testID="archived-toggle-switch" />
      </View>

      {!!archiveError && (
        <ThemedText style={[styles.archiveError, { color: colors.semantic.danger.text }]}>{archiveError}</ThemedText>
      )}

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.loadingText}>Loading your classes…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </View>
      )}

      {!loading && !error && visibleClasses.length === 0 && (
        <View style={styles.center} testID="classroom-empty-state">
          <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
            <GraduationCap size={26} color={colors.textMuted} strokeWidth={1.8} />
          </View>
          <ThemedText variant="title" style={styles.emptyTitle}>
            {classes.length === 0 ? 'No classes yet' : 'No active classes'}
          </ThemedText>
          <ThemedText variant="muted" style={styles.emptyHint}>
            {classes.length === 0
              ? 'Add your first class to get started.'
              : 'Toggle "Show archived classes" above to see your archived ones.'}
          </ThemedText>
        </View>
      )}

      {!loading && !error && visibleClasses.length > 0 && (
        <FlatList
          data={visibleClasses}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          testID="classroom-class-list"
          renderItem={({ item }) => {
            const meta = [item.grade, item.section].filter(Boolean).join(' · ') || 'No grade/section set';
            return (
              <View style={[styles.row, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                <Pressable
                  style={styles.rowMain}
                  onPress={() => navigation.navigate('ClassHome', { classId: item.id, className: item.name })}
                  accessibilityRole="button"
                >
                  <ThemedText style={styles.name}>{item.name}</ThemedText>
                  <ThemedText variant="muted" style={styles.meta}>
                    {meta}
                    {item.feeAmount != null ? ` · ₹${item.feeAmount}/month` : ''}
                    {item.archived ? ' · Archived' : ''}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => handleArchivePress(item)}
                  disabled={archivingId === item.id}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={item.archived ? `Restore ${item.name}` : `Archive ${item.name}`}
                  style={styles.archiveBtn}
                >
                  {archivingId === item.id ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : item.archived ? (
                    <RotateCcw size={16} color={colors.textMuted} />
                  ) : (
                    <Archive size={16} color={colors.textMuted} />
                  )}
                </Pressable>
              </View>
            );
          }}
        />
      )}

      <ClassFormModal
        key={createNonce}
        visible={createOpen}
        submitting={creating}
        error={createError}
        onSubmit={handleCreate}
        onClose={() => setCreateOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  addRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, minHeight: 44, marginBottom: spacing.md,
  },
  addRowLabel: { fontSize: 14, fontWeight: '600' },
  archivedToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  archivedToggleLabel: { fontSize: 13, fontWeight: '600' },
  archiveError: { fontSize: 12, marginBottom: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  loadingText: { marginTop: spacing.xs },
  emptyIconWell: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.xl },
  list: { gap: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  rowMain: { flex: 1, padding: spacing.md, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 },
  archiveBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
