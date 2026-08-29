// Multi-select role checkbox grid — shared by AdminNotificationsScreen's
// "Specific role(s)" target picker and AdminSettingsScreen's AI Access
// role-list control, the only two places mobile needs to toggle roles in
// and out of a Role[] (everywhere else uses SelectField's single-select).
// Native analogue of the web's .role-access-grid checkboxes.
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { ROLE_LABELS } from '../../config';
import type { Role } from '../../types';

interface RoleCheckboxGroupProps {
  roles: Role[];
  value: Role[];
  onToggle: (role: Role) => void;
  disabled?: boolean;
}

export function RoleCheckboxGroup({ roles, value, onToggle, disabled }: RoleCheckboxGroupProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {roles.map((role) => {
        const checked = value.includes(role);
        return (
          <Pressable
            key={role}
            onPress={() => onToggle(role)}
            disabled={disabled}
            style={[
              styles.option,
              { borderColor: checked ? colors.orange : colors.border, backgroundColor: checked ? colors.orangeSoft : colors.surface2 },
              disabled && styles.disabled,
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled }}
            accessibilityLabel={ROLE_LABELS[role]}
          >
            <View style={[styles.box, { borderColor: checked ? colors.orange : colors.border, backgroundColor: checked ? colors.orange : 'transparent' }]}>
              {checked && <Check size={12} color="#fff" />}
            </View>
            <ThemedText style={styles.label}>{ROLE_LABELS[role]}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
  },
  disabled: { opacity: 0.6 },
  box: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, fontWeight: '600' },
});
