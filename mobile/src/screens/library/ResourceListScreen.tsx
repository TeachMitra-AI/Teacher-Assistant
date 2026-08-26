// Native port of client/src/pages/LibraryPage.tsx (docs/mobile-app-plan.md
// §26 Phase 5) — list/search/filter/delete over the already-ported
// GET/DELETE /api/resources contract (api/resources.ts, Phase 1). Full JSX
// rewrite (desktop grid -> a scrollable card list); the request logic and
// filter/search/empty-state behavior match the web page exactly.
import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Search, Trash2, Library as LibraryIcon } from 'lucide-react-native';
import type { LibraryStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { listResources, deleteResource } from '../../api/resources';
import { ApiError } from '../../api/client';
import { RESOURCE_TYPE_META, RESOURCE_TYPES } from '../../config';
import type { LibraryResource, ResourceType } from '../../types';
import { navigationRef } from '../../navigation/navigationRef';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function snippet(text: string, max = 140): string {
  const clean = text.replace(/[#*_`>-]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

type Props = NativeStackScreenProps<LibraryStackParamList, 'ResourceList'>;

export function ResourceListScreen({ navigation }: Props) {
  const { colors } = useTheme();

  const [items, setItems] = useState<LibraryResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeType, setActiveType] = useState<ResourceType | ''>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce the search box so we don't fire a request on every keystroke —
  // matches LibraryPage.tsx's own 300ms debounce.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resources = await listResources({ type: activeType, q: debouncedSearch });
      setItems(resources);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your library.');
    } finally {
      setLoading(false);
    }
  }, [activeType, debouncedSearch]);

  useEffect(() => {
    // Standard fetch-on-mount pattern, not the synchronous-setState
    // anti-pattern this rule targets — see AuthContext.tsx's identical,
    // already-documented case (Phase 3).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Reload whenever the list regains focus (e.g. returning from Edit after a
  // save, or from a delete on the View screen) — React Navigation does not
  // remount ResourceList on a stack pop, so a stale list would otherwise show.
  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  function handleDelete(item: LibraryResource) {
    Alert.alert('Delete resource?', `Delete "${item.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const previous = items;
          setItems((list) => list.filter((r) => r.id !== item.id));
          try {
            await deleteResource(item.id);
          } catch (err) {
            setItems(previous);
            Alert.alert('Could not delete', err instanceof ApiError ? err.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  const isFiltering = activeType !== '' || debouncedSearch !== '';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.searchBar, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <Search size={16} color={colors.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by title or content…"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search your library"
        />
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
        data={['' as const, ...RESOURCE_TYPES]}
        keyExtractor={(t) => t || 'all'}
        renderItem={({ item: t }) => {
          const active = activeType === t;
          const meta = t ? RESOURCE_TYPE_META[t] : null;
          const Icon = meta?.icon;
          return (
            <Pressable
              onPress={() => setActiveType(t)}
              style={[
                styles.filterChip,
                { borderColor: active ? colors.orange : colors.border, backgroundColor: active ? colors.orange : colors.surface },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              {Icon && <Icon size={13} color={active ? '#fff' : colors.textMuted} />}
              <ThemedText style={{ color: active ? '#fff' : colors.text, fontSize: 13, fontWeight: '600' }}>
                {t ? meta!.label : 'All'}
              </ThemedText>
            </Pressable>
          );
        }}
      />

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.loadingText}>Loading your library…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
        </View>
      )}

      {!loading && !error && items.length === 0 && (
        <View style={styles.center} testID="library-empty-state">
          {/* 60dp circular icon well, matching .library-empty-icon
              (UI_REFINED.md §12.1/§16) rather than a bare icon. */}
          <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
            <LibraryIcon size={26} color={colors.textMuted} strokeWidth={1.8} />
          </View>
          {isFiltering ? (
            <>
              <ThemedText variant="title" style={styles.emptyTitle}>No matching resources</ThemedText>
              <ThemedText variant="muted">Try a different search or filter.</ThemedText>
            </>
          ) : (
            <>
              <ThemedText variant="title" style={styles.emptyTitle}>Your library is empty</ThemedText>
              <ThemedText variant="muted" style={styles.emptyHint}>
                Save useful AI answers from Coach and they&rsquo;ll appear here.
              </ThemedText>
              <Button
                title="Ask Coach a question"
                variant="secondary"
                onPress={() => navigationRef.isReady() && navigationRef.navigate('CoachTab')}
                style={styles.emptyCta}
              />
            </>
          )}
        </View>
      )}

      {!loading && !error && items.length > 0 && (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          testID="library-list"
          renderItem={({ item }) => {
            const Icon = RESOURCE_TYPE_META[item.type].icon;
            return (
              <Card style={styles.card}>
                <Pressable
                  style={styles.cardMain}
                  onPress={() => navigation.navigate('ResourceView', { resourceId: item.id })}
                  accessibilityRole="button"
                >
                  <View style={styles.cardTypeRow}>
                    <Icon size={13} color={colors.orange} />
                    {/* .library-card-type: uppercase, 700, letter-spacing —
                        an eyebrow label, not a muted caption (UI_REFINED.md
                        §12.1). */}
                    <ThemedText style={[styles.cardType, { color: colors.orange }]}>
                      {RESOURCE_TYPE_META[item.type].label}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.cardTitle} numberOfLines={2}>{item.title}</ThemedText>
                  {!!item.content && (
                    <ThemedText variant="muted" numberOfLines={2} style={styles.cardSnippet}>
                      {snippet(item.content)}
                    </ThemedText>
                  )}
                  <ThemedText variant="muted" style={styles.cardMeta}>
                    {[item.grade, item.subject].filter(Boolean).join(' · ')}
                    {(item.grade || item.subject) ? ' • ' : ''}
                    {formatDate(item.updatedAt)}
                  </ThemedText>
                </Pressable>
                {/* Full-height right-edge rail with a left border, matching
                    .library-card-delete (UI_REFINED.md §12.1) — a proper
                    40x(card-height) touch target instead of a floating icon. */}
                <Pressable
                  onPress={() => handleDelete(item)}
                  style={[styles.deleteRail, { borderLeftColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.title}`}
                >
                  <Trash2 size={16} color={colors.textMuted} />
                </Pressable>
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  filterRow: { marginTop: spacing.sm, flexGrow: 0 },
  filterContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  loadingText: { marginTop: spacing.xs },
  emptyIconWell: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.xl },
  emptyCta: { marginTop: spacing.sm },
  list: { paddingVertical: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  // padding:0 + overflow hidden so the delete rail can sit flush against the
  // card's right edge and respect its rounded corners (Card's own base
  // style sets padding:16, overridden here — see the rail comment above).
  card: { flexDirection: 'row', alignItems: 'stretch', padding: 0, overflow: 'hidden' },
  cardMain: { flex: 1, gap: 4, padding: spacing.md },
  cardTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardType: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardSnippet: { fontSize: 13 },
  cardMeta: { fontSize: 12, marginTop: 2 },
  deleteRail: { width: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth },
});
