// Native port of client/src/components/Notifications.tsx's NotificationBell
// panel (docs/mobile-app-plan.md §11, §26 Phase 7) — full rewrite of the
// dropdown into its own pushed screen (More -> Notifications, §10), reading
// state from NotificationContext (the provider RootNavigator mounts around
// MainTabs). Deliberately NOT implemented here: tap-to-navigate via a
// notification's `link` field — mapping the web's route-string convention
// onto mobile's own stack/tab routes is exactly the kind of deep-link work
// Phase 7b's own acceptance criteria ("tapping it deep-links correctly")
// scopes to the push-notification phase, not this one; tapping a row here
// only marks it read, matching this phase's own acceptance bar
// ("list/unread-count/mark-read all work").
import React, { useEffect } from 'react';
import { View, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Bell, CheckCheck } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { useNotifications } from '../../notifications/NotificationContext';
import { NOTIFICATION_TYPE_META } from '../../config';
import { formatTimestamp } from '../../lib/historyTime';
import type { AppNotification } from '../../types';

type Props = NativeStackScreenProps<MoreStackParamList, 'Notifications'>;

export function NotificationsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const {
    unreadCount, notifications, loadingList, hasMore, error, loadFirstPage, loadMore, markRead, markAllRead,
  } = useNotifications();

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', loadFirstPage);
    return unsub;
  }, [navigation, loadFirstPage]);

  function handleRowPress(n: AppNotification) {
    if (!n.read) markRead(n.id);
  }

  const showInitialLoading = loadingList && notifications.length === 0;
  const showEmpty = !showInitialLoading && notifications.length === 0 && !error;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {unreadCount > 0 && (
        <Pressable
          onPress={() => markAllRead()}
          style={styles.markAllRow}
          accessibilityRole="button"
          testID="notifications-mark-all"
        >
          <CheckCheck size={14} color={colors.orange} />
          <ThemedText style={{ color: colors.orange, fontWeight: '600' }}>Mark all read</ThemedText>
        </Pressable>
      )}

      {!!error && (
        <View style={[styles.errorBanner, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <ThemedText style={{ color: '#e5484d' }}>{error}</ThemedText>
        </View>
      )}

      {showInitialLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.loadingText}>Loading notifications…</ThemedText>
        </View>
      )}

      {showEmpty && (
        <View style={styles.center} testID="notifications-empty-state">
          <Bell size={28} color={colors.textMuted} strokeWidth={1.8} />
          <ThemedText variant="title" style={styles.emptyTitle}>You&rsquo;re all caught up</ThemedText>
        </View>
      )}

      {!showInitialLoading && notifications.length > 0 && (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          testID="notifications-list"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const meta = NOTIFICATION_TYPE_META[item.type];
            const Icon = meta?.icon ?? Bell;
            return (
              <Pressable
                onPress={() => handleRowPress(item)}
                accessibilityRole="button"
                accessibilityLabel={item.read ? item.title : `${item.title}, unread`}
              >
                <Card
                  style={[
                    styles.row,
                    !item.read && { borderColor: colors.orange, backgroundColor: colors.surface2 },
                  ]}
                >
                  <View style={[styles.rowIcon, { backgroundColor: colors.surface2 }]}>
                    <Icon size={16} color={colors.orange} />
                  </View>
                  <View style={styles.rowBody}>
                    <ThemedText style={styles.rowTitle}>{item.title}</ThemedText>
                    <ThemedText variant="muted" numberOfLines={3} style={styles.rowMessage}>{item.message}</ThemedText>
                    <ThemedText variant="muted" style={styles.rowTime}>{formatTimestamp(item.createdAt)}</ThemedText>
                  </View>
                  {!item.read && <View style={[styles.dot, { backgroundColor: colors.orange }]} />}
                </Card>
              </Pressable>
            );
          }}
          ListFooterComponent={
            hasMore ? (
              <Pressable
                onPress={() => loadMore()}
                disabled={loadingList}
                style={styles.loadMore}
                accessibilityRole="button"
                testID="notifications-load-more"
              >
                {loadingList ? (
                  <ActivityIndicator color={colors.orange} />
                ) : (
                  <ThemedText style={{ color: colors.orange, fontWeight: '600' }}>Load more</ThemedText>
                )}
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  markAllRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingVertical: spacing.sm, minHeight: 44,
  },
  errorBanner: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  loadingText: { marginTop: spacing.xs },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  list: { paddingVertical: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm,
  },
  rowIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMessage: { fontSize: 13 },
  rowTime: { fontSize: 11, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  loadMore: { alignItems: 'center', paddingVertical: spacing.md, minHeight: 44, justifyContent: 'center' },
});
