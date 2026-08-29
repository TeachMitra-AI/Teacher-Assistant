// Mobile port of client/src/components/TeachingContextMenu.tsx — the
// teaching-context icon in Header.tsx's top-right corner (Coach only,
// variant="coach"; wired from CoachScreen.tsx, same navigation.setOptions
// pattern HistorySidebar's hamburger icon uses). Replaces the old always-
// visible Grade/Subject/Language pills: all five fields (plus Classroom/
// Focus under "More context") live behind one icon instead, matching how
// the web version consolidated them. Same context/language state
// CoachScreen already owns — no new state, no duplicated vocab lists.
//
// Web renders this as a small anchored popover; here it's a bottom sheet
// (same Modal-over-Pressable-backdrop convention as HistorySidebar's action
// sheet), since five dropdown fields need more room than a popover pinned to
// a header icon comfortably gives on a phone. Each field reuses SelectField
// (built for the Generator form) rather than a new picker component — an
// explicit "Any" option is prepended for the four fields that can be unset
// (Grade/Subject/Classroom/Focus), matching the web <select>'s
// `<option value="">Any</option>`; Language has no such option since it
// always has a value (defaults to English), same as the web version.
import React from 'react';
import { View, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '../../components/ThemedText';
import { SelectField, type SelectOption } from '../../components/SelectField';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { GRADES, SUBJECTS, LANGUAGES, CLASSROOM_TYPES, ISSUE_TYPES } from '../../config';
import type { QueryContext } from '../../types';

const ANY = { value: '', label: 'Any' };

function withAny(values: string[]): SelectOption[] {
  return [ANY, ...values.map((v) => ({ value: v, label: v }))];
}

const GRADE_OPTIONS = withAny(GRADES);
const SUBJECT_OPTIONS = withAny(SUBJECTS);
const CLASSROOM_OPTIONS = withAny(CLASSROOM_TYPES);
const ISSUE_OPTIONS = withAny(ISSUE_TYPES);

interface TeachingContextMenuProps {
  visible: boolean;
  onClose: () => void;
  language: string;
  onLanguageChange: (value: string) => void;
  context: QueryContext;
  onContextChange: (key: keyof QueryContext, value: string) => void;
}

export function TeachingContextMenu({
  visible, onClose, language, onLanguageChange, context, onContextChange,
}: TeachingContextMenuProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <ThemedText style={styles.title}>Teaching context</ThemedText>

          <ScrollView contentContainerStyle={styles.fields} keyboardShouldPersistTaps="handled">
            <SelectField label="Grade" options={GRADE_OPTIONS} value={context.grade ?? ''} onChange={(v) => onContextChange('grade', v)} />
            <SelectField label="Subject" options={SUBJECT_OPTIONS} value={context.subject ?? ''} onChange={(v) => onContextChange('subject', v)} />
            <SelectField label="Language" options={LANGUAGES} value={language} onChange={onLanguageChange} />

            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <ThemedText variant="muted" style={styles.sectionLabel}>More context</ThemedText>

            <SelectField label="Classroom" options={CLASSROOM_OPTIONS} value={context.classroomType ?? ''} onChange={(v) => onContextChange('classroomType', v)} />
            <SelectField label="Focus" options={ISSUE_OPTIONS} value={context.issueType ?? ''} onChange={(v) => onContextChange('issueType', v)} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '80%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
  title: { fontSize: 17, fontWeight: '700', marginBottom: spacing.md },
  fields: { gap: spacing.md, paddingBottom: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, marginTop: spacing.xs },
  sectionLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
});
