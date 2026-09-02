// Native port of client/src/components/ClassroomModeMenu.tsx — the Assistant
// Mode / Classroom Mode selector, next to AddMenu in the Composer's controls
// row. Same "explicit Off/On choice, not a single tick-to-toggle item" design
// as the web version: the button shows the CURRENT choice, and opening it
// presents both options spelled out with what each one does. Bottom sheet
// instead of an anchored popover — same reasoning as AddMenu.tsx.
import React, { useState } from 'react';
import { View, Pressable, Modal, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GraduationCap, ChevronDown, Check } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';

interface ClassroomModeMenuProps {
  classroomMode: boolean;
  onClassroomModeChange: (on: boolean) => void;
  disabled?: boolean;
}

const OPTIONS: { on: boolean; label: string; description: string }[] = [
  { on: false, label: 'Assistant Mode', description: 'Just answer my question' },
  {
    on: true,
    label: 'Classroom Mode',
    description: 'Also create a lesson plan, worksheet, quiz, homework and exit ticket',
  },
];

export function ClassroomModeMenu({ classroomMode, onClassroomModeChange, disabled = false }: ClassroomModeMenuProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const selected = OPTIONS.find((o) => o.on === classroomMode)?.label ?? 'Assistant Mode';
  const accessibleLabel = classroomMode ? `Assistant Mode: ${selected}` : 'Assistant Mode';

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibleLabel}
        testID="composer-classroom-mode-menu"
        style={[
          styles.btn,
          { backgroundColor: classroomMode ? colors.orangeSoft : colors.surface2, borderColor: classroomMode ? colors.orange : colors.border },
          disabled && styles.btnDisabled,
        ]}
      >
        <ThemedText style={[styles.label, classroomMode && { color: colors.orange, fontWeight: '700' }]} numberOfLines={1}>
          {selected}
        </ThemedText>
        <ChevronDown size={14} color={classroomMode ? colors.orange : colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.sheet,
              { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + spacing.md },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            {OPTIONS.map((option) => {
              const active = option.on === classroomMode;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => {
                    onClassroomModeChange(option.on);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={option.label}
                  style={styles.row}
                >
                  <View style={[styles.rowIcon, { backgroundColor: colors.orangeSoft }]}>
                    <GraduationCap size={18} color={colors.orange} />
                  </View>
                  <View style={styles.rowText}>
                    <ThemedText style={styles.rowLabel}>{option.label}</ThemedText>
                    <ThemedText variant="muted" style={styles.rowDesc}>{option.description}</ThemedText>
                  </View>
                  {active && <Check size={18} color={colors.orange} />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 168,
    height: 34, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
  },
  btnDisabled: { opacity: 0.5 },
  label: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowDesc: { fontSize: 12 },
});
