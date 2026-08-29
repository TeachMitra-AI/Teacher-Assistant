// Pending teachers sub-tab of Admin > Manage — shown to every admin role
// (matching ManagePage.tsx: "every admin role can SEE the pending queue").
// Approve/Reject only render for the two roles the server actually lets
// act; a resource_person gets read-only visibility, same as web.
import React from 'react';
import { View, FlatList, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Pager } from '../../../components/Pager';
import { useTheme } from '../../../theme/ThemeContext';
import { useAuth } from '../../../auth/AuthContext';
import { spacing } from '../../../theme/tokens';
import { useManagePendingScreen } from './useManagePendingScreen';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function ManagePendingScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const canDecide = user?.role === 'school_admin' || user?.role === 'super_admin';
  const s = useManagePendingScreen();

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
              value={s.pending.search}
              onChangeText={s.pending.setSearch}
              placeholder="Search name or email"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Search pending teachers"
            />
          </View>

          {!!s.decideError && <ThemedText style={{ color: colors.semantic.danger.text }}>{s.decideError}</ThemedText>}

          {s.pending.loading && (
            <View style={styles.center}>
              <ActivityIndicator color={colors.orange} />
            </View>
          )}
          {!s.pending.loading && !!s.pending.error && (
            <ThemedText style={{ color: colors.semantic.danger.text }}>{s.pending.error}</ThemedText>
          )}
          {!s.pending.loading && !s.pending.error && s.pending.items.length === 0 && (
            <ThemedText variant="muted" style={styles.empty}>
              {s.pending.isFiltering ? 'No pending sign-ups match your search.' : 'No sign-ups waiting for approval.'}
            </ThemedText>
          )}
        </>
      }
      data={s.pending.loading || s.pending.error ? [] : s.pending.items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Card style={styles.row}>
          <View style={styles.rowMain}>
            <ThemedText style={styles.rowTitle}>{item.name}</ThemedText>
            <ThemedText variant="muted" style={styles.rowSub}>{item.email}</ThemedText>
            <ThemedText variant="muted" style={styles.rowSub}>
              {item.school || '—'}{item.schoolCode ? ` (${item.schoolCode})` : ''} · {formatDate(item.createdAt)}
            </ThemedText>
          </View>
          {canDecide && (
            <View style={styles.actions}>
              <Button
                title="Approve"
                onPress={() => s.decide(item, 'approve')}
                loading={s.decidingId === item.id}
                disabled={s.decidingId !== null}
                testID={`pending-approve-${item.id}`}
              />
              <Button
                title="Reject"
                variant="text"
                onPress={() => s.decide(item, 'reject')}
                disabled={s.decidingId !== null}
                testID={`pending-reject-${item.id}`}
              />
            </View>
          )}
        </Card>
      )}
      ListFooterComponent={
        !s.pending.loading && !s.pending.error && s.pending.items.length > 0 ? (
          <Pager
            noun={{ one: 'pending sign-up', many: 'pending sign-ups' }}
            page={s.pending.page}
            totalPages={s.pending.totalPages}
            total={s.pending.total}
            rangeStart={s.pending.rangeStart}
            rangeEnd={s.pending.rangeEnd}
            hasPrev={s.pending.hasPrev}
            hasNext={s.pending.hasNext}
            onPageChange={s.pending.setPage}
            busy={s.pending.loading}
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
  center: { alignItems: 'center', paddingVertical: spacing.lg },
  empty: { textAlign: 'center', paddingVertical: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12 },
  actions: { gap: spacing.xs },
});
