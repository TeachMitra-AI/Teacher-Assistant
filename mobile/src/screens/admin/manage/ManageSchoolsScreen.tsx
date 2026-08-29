// Schools sub-tab of Admin > Manage (super_admin only — gated by
// AdminManageScreen.tsx). Native port of ManagePage.tsx's Schools section:
// a create-school form above a searchable, server-paginated list.
import React from 'react';
import { View, FlatList, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Pager } from '../../../components/Pager';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { useManageSchoolsScreen } from './useManageSchoolsScreen';

export function ManageSchoolsScreen() {
  const { colors } = useTheme();
  const s = useManageSchoolsScreen();

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      ListHeaderComponent={
        <>
          <Card style={styles.formCard}>
            <ThemedText variant="title" style={styles.formTitle}>Add school</ThemedText>
            <TextInput
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
              value={s.name}
              onChangeText={s.setName}
              placeholder="School name"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="School name"
            />
            <TextInput
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
              value={s.code}
              onChangeText={s.setCode}
              placeholder="Code (e.g. RAMPUR03)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              accessibilityLabel="School code"
            />
            <TextInput
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
              value={s.district}
              onChangeText={s.setDistrict}
              placeholder="District (optional)"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="District"
            />
            <TextInput
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
              value={s.state}
              onChangeText={s.setState}
              placeholder="State (optional)"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="State"
            />
            {!!s.createError && <ThemedText style={{ color: colors.semantic.danger.text }}>{s.createError}</ThemedText>}
            {s.created && !s.createError && <ThemedText style={{ color: colors.semantic.success.text }}>School created</ThemedText>}
            <Button title={s.creating ? 'Adding…' : 'Add school'} onPress={s.createSchool} loading={s.creating} testID="manage-add-school" />
          </Card>

          <View style={[styles.searchBar, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
            <Search size={16} color={colors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={s.schools.search}
              onChangeText={s.schools.setSearch}
              placeholder="Search name, code, or district"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Search schools"
            />
          </View>

          {s.schools.loading && (
            <View style={styles.center}>
              <ActivityIndicator color={colors.orange} />
            </View>
          )}
          {!s.schools.loading && !!s.schools.error && (
            <ThemedText style={{ color: colors.semantic.danger.text }}>{s.schools.error}</ThemedText>
          )}
          {!s.schools.loading && !s.schools.error && s.schools.items.length === 0 && (
            <ThemedText variant="muted" style={styles.empty}>
              {s.schools.isFiltering ? 'No schools match your search.' : 'No schools yet.'}
            </ThemedText>
          )}
        </>
      }
      data={s.schools.loading || s.schools.error ? [] : s.schools.items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Card style={styles.row}>
          <View style={styles.rowMain}>
            <ThemedText style={styles.rowTitle}>{item.name}</ThemedText>
            <ThemedText variant="muted" style={styles.rowSub}>
              {item.code}{item.district ? ` · ${item.district}` : ''}
            </ThemedText>
          </View>
          <ThemedText variant="muted">{item.users} teacher{item.users === 1 ? '' : 's'}</ThemedText>
        </Card>
      )}
      ListFooterComponent={
        !s.schools.loading && !s.schools.error && s.schools.items.length > 0 ? (
          <Pager
            noun={{ one: 'school', many: 'schools' }}
            page={s.schools.page}
            totalPages={s.schools.totalPages}
            total={s.schools.total}
            rangeStart={s.schools.rangeStart}
            rangeEnd={s.schools.rangeEnd}
            hasPrev={s.schools.hasPrev}
            hasNext={s.schools.hasNext}
            onPageChange={s.schools.setPage}
            busy={s.schools.loading}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  formCard: { gap: spacing.sm, marginBottom: spacing.md },
  formTitle: { fontSize: 16 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 44, fontSize: 15 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 44, marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  center: { alignItems: 'center', paddingVertical: spacing.lg },
  empty: { textAlign: 'center', paddingVertical: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12 },
});
