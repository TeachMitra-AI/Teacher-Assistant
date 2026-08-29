// Coach chat-history sidebar — mobile port of client/src/components/
// Sidebar.tsx, opened via the hamburger icon Header.tsx shows in place of
// the app icon on the Coach tab (variant="coach"; wired from
// CoachScreen.tsx). Same Modal-over-Pressable-backdrop convention as every
// other sheet in this app (ClassSwitcherModal.tsx) rather than a
// drawer-navigator dependency — no new native module, so no repeat of the
// autolinking rebuild this app just went through for Phase 12.
//
// Ported: the brand block (icon + हिंदी/English name, in place of a plain
// "Chats" title — matches Sidebar.tsx's own .sidebar-brand-row), New chat,
// Recent list (pinned-first, same sort as web), an inline search filter,
// per-row Rename/Pin/Share/Delete + Clear all (the same action set as
// HistoryItemMenu.tsx, in the same order), and the footer ProfileMenu (the
// same Getting Started/Settings/Need Help/Sign out menu Header.tsx's avatar
// opens elsewhere — see ProfileMenu.tsx's variant="sidebar" branch). Closes
// via the X button OR a right-to-left swipe on the panel (PanResponder, a
// core RN API — no gesture-handler dependency, so no repeat of the
// autolinking rebuild this app just went through for Phase 12). NOT ported:
// ChatSearchOverlay's separate full-screen overlay (folded into this inline
// filter instead, since there is no second surface competing for it here).
import React, { useMemo, useRef, useState } from 'react';
import {
  View, Pressable, Modal, FlatList, TextInput, Alert, Share, PanResponder,
  ActivityIndicator, useWindowDimensions, StyleSheet, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X, Plus, Search, MessageSquareText, Pin, MoreHorizontal, Pencil, PinOff, Share2, Trash2,
} from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { ProfileAvatar } from '../../components/ProfileMenu';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, shadow } from '../../theme/tokens';
import { formatTimestamp } from '../../lib/historyTime';
import { RenameChatModal } from './RenameChatModal';
import type { HistoryItem } from '../../types';

// Mobile port of the web's HistoryItemMenu popover positioning
// (client/src/components/HistoryItemMenu.tsx's computePosition) — anchored
// under (or, near the bottom of the screen, above) the row's own
// MoreHorizontal button, rather than the old always-bottom action sheet, so
// the menu opens where the chat actually is instead of jumping to the
// bottom of the screen. Only used to decide which way the popover opens, so
// an approximation of its height is enough.
const POPOVER_APPROX_HEIGHT = 190;

interface PopoverAnchor { x: number; y: number; width: number; height: number; }
interface PopoverPosition { top?: number; bottom?: number; right: number; }

function computeActionsPosition(anchor: PopoverAnchor, screenWidth: number, screenHeight: number): PopoverPosition {
  const right = screenWidth - (anchor.x + anchor.width);
  if (screenHeight - (anchor.y + anchor.height) < POPOVER_APPROX_HEIGHT) {
    return { bottom: screenHeight - anchor.y + 6, right };
  }
  return { top: anchor.y + anchor.height + 6, right };
}

// Pure swipe-to-close decision logic, factored out of the PanResponder
// config below and exported so it can be unit-tested directly — PanResponder
// itself only exposes the raw native responder props on `panHandlers`
// (`onMoveShouldSetResponder`/`onResponderRelease`, not the
// `onMoveShouldSetPanResponder`/`onPanResponderRelease` names its config
// takes), computing gesture state internally from real touch history, so
// driving these two callbacks through a fake event/gestureState pair in a
// test wouldn't actually exercise them. This is the one part of the gesture
// that's genuinely this file's own logic; PanResponder and RN's native
// responder system are trusted platform behavior underneath it.
export function shouldClaimSidebarSwipe(dx: number, dy: number): boolean {
  // Requires a mostly-horizontal drag before claiming the gesture, so a
  // vertical drag on the history list below still scrolls it normally.
  return Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy) * 1.5;
}

export function isSidebarCloseSwipe(dx: number): boolean {
  return dx < -60;
}

interface HistorySidebarProps {
  visible: boolean;
  items: HistoryItem[];
  loading: boolean;
  activeId: string | null;
  isPinned: (id: string) => boolean;
  titleFor: (item: HistoryItem) => string;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
  onClearAll: () => void;
}

export function HistorySidebar({
  visible, items, loading, activeId, isPinned, titleFor, pinnedIds,
  onTogglePin, onRename, onClose, onNewChat, onSelect, onDelete, onClearAll,
}: HistorySidebarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const drawerWidth = Math.min(340, screenWidth * 0.86);

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Which row's action popover (Rename/Pin/Share/Delete) is open, if any.
  const [actionsFor, setActionsFor] = useState<HistoryItem | null>(null);
  // Where that row's MoreHorizontal button actually is on screen, measured
  // on press (below) — null until the measurement resolves, in which case
  // the popover falls back to a fixed spot near the top of the drawer
  // rather than not rendering at all.
  const [actionsAnchor, setActionsAnchor] = useState<PopoverAnchor | null>(null);
  // One native-view ref per visible row's MoreHorizontal button, keyed by
  // item id, so the press handler below can measure whichever row was
  // actually tapped without re-creating a ref on every render.
  const moreButtonRefs = useRef(new Map<string, View>()).current;
  // Which row is being renamed, if any — a separate target from actionsFor
  // so the rename dialog stays open after the action popover that launched
  // it has already closed.
  const [renameTarget, setRenameTarget] = useState<HistoryItem | null>(null);

  function openActionsFor(item: HistoryItem) {
    setActionsAnchor(null);
    setActionsFor(item);
    moreButtonRefs.get(item.id)?.measureInWindow((x, y, width, height) => {
      setActionsAnchor({ x, y, width, height });
    });
  }

  // Swipe-to-close (right-to-left, matching the drawer's own left-anchored
  // open direction) — a second way to close, alongside the X button. Not
  // memoized: a plain closure over the current render's `onClose` (like
  // every other inline handler in this file) rather than a ref, since this
  // codebase's stricter react-hooks/refs lint rule forbids reading a ref's
  // `.current` anywhere in the render body — including inside a useMemo
  // factory — and PanResponder.create() is cheap enough to not need memoing.
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => shouldClaimSidebarSwipe(gesture.dx, gesture.dy),
    onPanResponderRelease: (_, gesture) => {
      if (isSidebarCloseSwipe(gesture.dx)) onClose();
    },
  });

  function closeSearch() {
    setSearchOpen(false);
    setSearch('');
  }

  // Pinned chats float to the top, newest-pinned first, then everything else
  // in the order the server already returns (most recent first) — same sort
  // as the web Sidebar; filtered by the inline search first when it's open.
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? items.filter((item) => titleFor(item).toLowerCase().includes(q)) : items;
    if (pinnedIds.length === 0) return filtered;
    return [...filtered].sort((a, b) => Number(isPinned(b.id)) - Number(isPinned(a.id)));
  }, [items, search, pinnedIds, isPinned, titleFor]);

  function shareChat(item: HistoryItem) {
    // Native share sheet (any app the teacher has, not just WhatsApp) — the
    // mobile-idiomatic equivalent of the web's wa.me compose link, same
    // "reviewed and sent by the teacher themselves" property.
    void Share.share({ message: `${titleFor(item)}\n\n${item.text}` });
  }

  function confirmDelete(item: HistoryItem) {
    Alert.alert(
      'Delete this chat?',
      `"${titleFor(item)}" will be permanently removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(item) },
      ]
    );
  }

  function confirmClearAll() {
    Alert.alert(
      'Delete your entire question history?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: onClearAll },
      ]
    );
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close sidebar">
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.panel,
              {
                width: drawerWidth,
                backgroundColor: colors.surface,
                borderRightColor: colors.border,
                paddingTop: insets.top + spacing.sm,
              },
            ]}
          >
            {/* panHandlers live on this plain View, not the Pressable above —
                Pressable owns the same six responder prop names internally
                for its own press handling (Pressability), so handlers
                spread onto a Pressable risk being shadowed rather than
                actually wired up; a plain View has no such conflict. The
                open/close decision itself (shouldClaimSidebarSwipe/
                isSidebarCloseSwipe above) is unit-tested directly
                (CoachScreen.test.tsx) rather than by simulating touch here,
                since `adb shell input swipe`-style synthetic gestures aren't
                a reliable proxy for the continuous native touch stream
                PanResponder needs to compute real gesture state from. */}
            <View style={styles.panelInner} testID="sidebar-swipe-area" {...panResponder.panHandlers}>
            <View style={styles.headerRow}>
              <View style={styles.brandRow}>
                <View style={[styles.brandLogo, { backgroundColor: colors.orangeSoft }]}>
                  <ThemedText style={styles.brandEmoji}>👨‍🏫</ThemedText>
                </View>
                <View style={styles.brandText}>
                  <ThemedText style={styles.brandTitle}>शिक्षक सहायक</ThemedText>
                  <ThemedText variant="muted" style={styles.brandSub}>Teacher Assistant</ThemedText>
                </View>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                  accessibilityRole="button"
                  accessibilityLabel="Search chats"
                  accessibilityState={{ selected: searchOpen }}
                  style={[styles.iconBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                >
                  <Search size={16} color={colors.text} />
                </Pressable>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close sidebar"
                  style={[styles.iconBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                >
                  <X size={16} color={colors.text} />
                </Pressable>
              </View>
            </View>

            {searchOpen && (
              <TextInput
                style={[styles.searchInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface2 }]}
                value={search}
                onChangeText={setSearch}
                placeholder="Search chats"
                placeholderTextColor={colors.textMuted}
                autoFocus
                accessibilityLabel="Search chats"
                testID="sidebar-search-input"
              />
            )}

            <Pressable
              onPress={onNewChat}
              accessibilityRole="button"
              accessibilityLabel="New chat"
              testID="sidebar-new-chat"
              style={[styles.newChatBtn, { backgroundColor: colors.orange }]}
            >
              <Plus size={16} color="#fff" strokeWidth={2.4} />
              <ThemedText style={styles.newChatText}>New chat</ThemedText>
            </Pressable>

            <View style={styles.sectionRow}>
              <ThemedText variant="muted" style={styles.sectionLabel}>Recent</ThemedText>
              {items.length > 0 && (
                <Pressable onPress={confirmClearAll} accessibilityRole="button" accessibilityLabel="Clear all chats">
                  <ThemedText style={[styles.clearAll, { color: colors.semantic.danger.text }]}>Clear all</ThemedText>
                </Pressable>
              )}
            </View>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.orange} />
              </View>
            ) : visibleItems.length === 0 ? (
              <View style={styles.center}>
                <MessageSquareText size={22} color={colors.textMuted} strokeWidth={1.8} />
                <ThemedText style={styles.emptyTitle}>
                  {search.trim() ? 'No matching chats' : 'No conversations yet'}
                </ThemedText>
                {!search.trim() && (
                  <ThemedText variant="muted" style={styles.emptyHint}>Your recent questions will appear here.</ThemedText>
                )}
              </View>
            ) : (
              <FlatList
                data={visibleItems}
                keyExtractor={(item) => item.id}
                style={styles.list}
                testID="sidebar-history-list"
                renderItem={({ item }) => {
                  const active = item.id === activeId;
                  return (
                    <View style={[styles.row, active && { backgroundColor: colors.orangeSoft }]}>
                      <Pressable
                        onPress={() => onSelect(item)}
                        style={styles.rowMain}
                        accessibilityRole="button"
                        accessibilityLabel={titleFor(item)}
                      >
                        <View style={styles.rowTitleLine}>
                          {isPinned(item.id) && <Pin size={11} color={colors.orange} />}
                          <ThemedText style={styles.rowTitle} numberOfLines={1}>{titleFor(item)}</ThemedText>
                        </View>
                        <ThemedText variant="muted" style={styles.rowMeta} numberOfLines={1}>
                          {[item.context.grade, item.context.subject].filter(Boolean).join(' · ')}
                          {(item.context.grade || item.context.subject) ? ' • ' : ''}
                          {formatTimestamp(item.createdAt)}
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        ref={(node) => {
                          if (node) moreButtonRefs.set(item.id, node);
                          else moreButtonRefs.delete(item.id);
                        }}
                        onPress={() => openActionsFor(item)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Chat actions"
                        testID={`sidebar-actions-${item.id}`}
                        style={styles.moreBtn}
                      >
                        <MoreHorizontal size={16} color={colors.textMuted} />
                      </Pressable>
                    </View>
                  );
                }}
              />
            )}

            {/* Fixed below the independently-scrollable history list above
                (that list's own `flex: 1` makes it grow to fill the
                remaining space, so this footer never moves) — same
                ProfileMenu/account-menu Header.tsx's avatar opens everywhere
                else (see ProfileMenu.tsx's variant="sidebar" branch). */}
            <View style={{ paddingBottom: insets.bottom }}>
              <ProfileAvatar variant="sidebar" />
            </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Per-row action popover — anchored to the row's own MoreHorizontal
          button (openActionsFor/computeActionsPosition above) rather than a
          bottom sheet, so it opens where the chat is instead of always at
          the bottom of the screen. Falls back to a fixed spot near the top
          of the drawer until the measurement resolves (actionsAnchor is
          still null right after opening, and stays null under the Jest test
          renderer, which has no real native layout pass). */}
      <Modal visible={actionsFor !== null} transparent animationType="fade" onRequestClose={() => setActionsFor(null)}>
        <Pressable style={styles.actionsOverlay} onPress={() => setActionsFor(null)} accessibilityLabel="Close">
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.actionsPopover,
              Platform.OS === 'ios' ? shadow.ios : shadow.android,
              { backgroundColor: colors.surface, borderColor: colors.border },
              actionsAnchor
                ? computeActionsPosition(actionsAnchor, screenWidth, screenHeight)
                : { top: insets.top + 64, right: spacing.md },
            ]}
          >
            {actionsFor && (
              <>
                <Pressable
                  style={styles.actionRow}
                  onPress={() => { const item = actionsFor; setActionsFor(null); setRenameTarget(item); }}
                  accessibilityRole="button"
                >
                  <Pencil size={17} color={colors.text} />
                  <ThemedText style={styles.actionLabel}>Rename chat</ThemedText>
                </Pressable>
                <Pressable
                  style={styles.actionRow}
                  onPress={() => { onTogglePin(actionsFor.id); setActionsFor(null); }}
                  accessibilityRole="button"
                >
                  {isPinned(actionsFor.id) ? <PinOff size={17} color={colors.text} /> : <Pin size={17} color={colors.text} />}
                  <ThemedText style={styles.actionLabel}>{isPinned(actionsFor.id) ? 'Unpin chat' : 'Pin chat'}</ThemedText>
                </Pressable>
                <Pressable
                  style={styles.actionRow}
                  onPress={() => { shareChat(actionsFor); setActionsFor(null); }}
                  accessibilityRole="button"
                >
                  <Share2 size={17} color={colors.text} />
                  <ThemedText style={styles.actionLabel}>Share chat</ThemedText>
                </Pressable>
                <Pressable
                  style={styles.actionRow}
                  onPress={() => { const item = actionsFor; setActionsFor(null); confirmDelete(item); }}
                  accessibilityRole="button"
                >
                  <Trash2 size={17} color={colors.semantic.danger.text} />
                  <ThemedText style={[styles.actionLabel, { color: colors.semantic.danger.text }]}>Delete chat</ThemedText>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <RenameChatModal
        key={renameTarget?.id ?? 'none'}
        visible={renameTarget !== null}
        initialTitle={renameTarget ? titleFor(renameTarget) : ''}
        onSubmit={(title) => { if (renameTarget) onRename(renameTarget.id, title); setRenameTarget(null); }}
        onClose={() => setRenameTarget(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  panel: { borderRightWidth: StyleSheet.hairlineWidth },
  panelInner: { flex: 1, paddingHorizontal: spacing.md, gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  brandLogo: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  brandEmoji: { fontSize: 15 },
  brandText: { flexShrink: 1 },
  brandTitle: { fontSize: 15, fontWeight: '700' },
  brandSub: { fontSize: 11 },
  headerActions: { flexDirection: 'row', gap: spacing.xs },
  iconBtn: {
    width: 34, height: 34, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14,
  },
  newChatBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderRadius: radius.sm, paddingVertical: spacing.sm,
  },
  newChatText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  sectionLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  clearAll: { fontSize: 12, fontWeight: '600' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  emptyTitle: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  emptyHint: { fontSize: 12, textAlign: 'center' },
  list: { flex: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm,
    paddingHorizontal: spacing.xs, minHeight: 56,
  },
  rowMain: { flex: 1, paddingVertical: spacing.xs, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowTitle: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  rowMeta: { fontSize: 11 },
  moreBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  // No scrim: this is a small anchored popover (matching the web's
  // HistoryItemMenu), not a modal sheet — the overlay only exists to catch
  // an outside tap and close it.
  actionsOverlay: { flex: 1 },
  actionsPopover: {
    position: 'absolute', minWidth: 180, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  actionLabel: { fontSize: 15, fontWeight: '600' },
});
