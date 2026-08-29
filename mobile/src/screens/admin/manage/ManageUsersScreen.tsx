import React from 'react';
import { View, FlatList, TextInput, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Card } from '../../../components/Card';
import { SelectField } from '../../../components/SelectField';
import { Pager } from '../../../components/Pager';
import { useTheme } from '../../../theme/ThemeContext';
import { useAuth } from '../../../auth/AuthContext';
import { spacing } from '../../../theme/tokens';
import { ROLE_LABELS } from '../../../config';
import { useManageUsersScreen } from './useManageUsersScreen';
import type { AdminUser, Role, UserStatus } from '../../../types';

const ROLES: Role[] = ['teacher', 'school_admin', 'resource_person', 'super_admin'];
const STATUSES: UserStatus[] = ['active', 'pending', 'rejected'];
const STATUS_LABELS: Record<UserStatus, string> = { active: 'Active', pending: 'Pending', rejected: 'Rejected' };
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : 'Never';
}

// Users sub-tab of Admin > Manage. Role change is super_admin only, matching
// ManagePage.tsx exactly — everyone else sees the role as plain text.
export function ManageUsersScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const s = useManageUsersScreen();

  function handleRolePick(target: AdminUser, role: Role) {
    const confirm = s.stageRoleChange(target, role);
    if (!confirm) return;
    Alert.alert(confirm.title, confirm.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirm.confirmLabel,
        style: confirm.tone === 'danger' ? 'destructive' : 'default',
        onPress: () => { void s.confirmRoleChange(target, role); },
      },
    ]);
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      ListHeaderComponent={
        <>
          <View style={[styles.searchBar, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
            <Search size={16} color={colors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={s.users.search}
              onChangeText={s.users.setSearch}
              placeholder="Search name or email"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Search users"
            />
          </View>

          <View style={styles.filters}>
            <View style={styles.filterField}>
              <SelectField
                label="Role"
                options={[{ value: '', label: 'All roles' }, ...ROLE_OPTIONS]}
                value={s.roleFilter}
                onChange={(v) => s.setRoleFilter(v as Role | '')}
              />
            </View>
            <View style={styles.filterField}>
              <SelectField
                label="Status"
                options={[{ value: '', label: 'All statuses' }, ...STATUSES.map((st) => ({ value: st, label: STATUS_LABELS[st] }))]}
                value={s.statusFilter}
                onChange={(v) => s.setStatusFilter(v as UserStatus | '')}
              />
            </View>
          </View>

          {!!s.roleError && <ThemedText style={{ color: colors.semantic.danger.text }}>{s.roleError}</ThemedText>}

          {s.users.loading && (
            <View style={styles.center}>
              <ActivityIndicator color={colors.orange} />
            </View>
          )}
          {!s.users.loading && !!s.users.error && (
            <ThemedText style={{ color: colors.semantic.danger.text }}>{s.users.error}</ThemedText>
          )}
          {!s.users.loading && !s.users.error && s.users.items.length === 0 && (
            <ThemedText variant="muted" style={styles.empty}>
              {s.users.isFiltering ? 'No users match your search or filters.' : 'No users yet.'}
            </ThemedText>
          )}
        </>
      }
      data={s.users.loading || s.users.error ? [] : s.users.items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Card style={styles.row}>
          <View style={styles.rowMain}>
            <ThemedText style={styles.rowTitle}>{item.name}</ThemedText>
            <ThemedText variant="muted" style={styles.rowSub}>{item.email}</ThemedText>
            <ThemedText variant="muted" style={styles.rowSub}>
              {item.school || '—'}{item.schoolCode ? ` (${item.schoolCode})` : ''} · Last login {formatDate(item.lastLogin)}
            </ThemedText>
            <View style={[styles.statusPill, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <ThemedText variant="muted" style={styles.statusText}>{STATUS_LABELS[item.status]}</ThemedText>
            </View>
          </View>
          {isSuperAdmin ? (
            <View style={styles.roleField}>
              <SelectField
                label="Role"
                accessibilityLabel={`Role for ${item.name}`}
                options={ROLE_OPTIONS}
                value={item.role}
                onChange={(v) => handleRolePick(item, v as Role)}
              />
            </View>
          ) : (
            <ThemedText style={styles.roleLabel}>{ROLE_LABELS[item.role]}</ThemedText>
          )}
        </Card>
      )}
      ListFooterComponent={
        !s.users.loading && !s.users.error && s.users.items.length > 0 ? (
          <Pager
            noun={{ one: 'user', many: 'users' }}
            page={s.users.page}
            totalPages={s.users.totalPages}
            total={s.users.total}
            rangeStart={s.users.rangeStart}
            rangeEnd={s.users.rangeEnd}
            hasPrev={s.users.hasPrev}
            hasNext={s.users.hasNext}
            onPageChange={s.users.setPage}
            busy={s.users.loading}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: spacing.md, minHeight: 44, marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  filters: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  filterField: { flex: 1 },
  center: { alignItems: 'center', paddingVertical: spacing.lg },
  empty: { textAlign: 'center', paddingVertical: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12 },
  statusPill: { alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: 2 },
  statusText: { fontSize: 11, fontWeight: '600' },
  roleField: { width: 150 },
  roleLabel: { fontSize: 13, fontWeight: '600', paddingTop: 4 },
});
