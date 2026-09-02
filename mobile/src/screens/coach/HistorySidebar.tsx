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
// opens elsewhere — see ProfileMenu.tsx's variant="sidebar" branch). NOT
// ported: ChatSearchOverlay's separate full-screen overlay (folded into this
// inline filter instead, since there is no second surface competing for it
// here).
//
// Gesture-driven open/close (both PanResponder + core Animated, still no
// gesture-handler dependency): the panel's `translateX` is a single Animated
// .Value the whole file shares — the hamburger/X buttons, a right-to-left
// drag on the open panel, AND a left-to-right drag starting at the screen's
// left edge (edgePanResponder, active only while the Modal itself isn't
// mounted yet) all drive the same value, so every path animates through the
// same spring. The panel stays inside <Modal> deliberately — that's what
// gives it the full-bleed-under-the-status-bar look the paddingTop below
// accounts for; a plain absolutely-positioned View here would be clipped to
// the navigator's content area (below Header.tsx's custom header) instead of
// the true screen top. The one thing that isn't fully continuous: the edge
// gesture can't live-preview *inside* the Modal before it's mounted (Modal
// is a separate native surface, not a normal child), so opening mounts the
// Modal on the drag's first qualifying move (already tracking the finger's
// current dx at that point) rather than a frame earlier — imperceptible in
// practice since it happens within the same gesture, before the finger has
// moved far enough to visibly matter.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Image, Pressable, Modal, FlatList, TextInput, Alert, Share, PanResponder, Animated,
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

// Width of the invisible left-edge strip that starts the open-swipe gesture
// — narrow enough to stay clear of the Composer/message content (both sit
// inside this screen's own horizontal padding, never flush to x=0), wide
// enough to be a comfortable real-finger target (roughly iOS's own edge-back
// hit zone).
const EDGE_WIDTH = 24;

interface PopoverAnchor { x: number; y: number; width: number; height: number; }
interface PopoverPosition { top?: number; bottom?: number; right: number; }

function computeActionsPosition(anchor: PopoverAnchor, screenWidth: number, screenHeight: number): PopoverPosition {
  const right = screenWidth - (anchor.x + anchor.width);
  if (screenHeight - (anchor.y + anchor.height) < POPOVER_APPROX_HEIGHT) {
    return { bottom: screenHeight - anchor.y + 6, right };
  }
  return { top: anchor.y + anchor.height + 6, right };
}

// Pure swipe decision logic, factored out of the PanResponder configs below
// and exported so it can be unit-tested directly — PanResponder itself only
// exposes the raw native responder props on `panHandlers`
// (`onMoveShouldSetResponder`/`onResponderRelease`, not the
// `onMoveShouldSetPanResponder`/`onPanResponderRelease` names its config
// takes), computing gesture state internally from real touch history, so
// driving these callbacks through a fake event/gestureState pair in a test
// wouldn't actually exercise them. This is the one part of the gesture
// that's genuinely this file's own logic; PanResponder, Animated, and RN's
// native responder system are trusted platform behavior underneath it.
export function shouldClaimSidebarSwipe(dx: number, dy: number): boolean {
  // Requires a mostly-horizontal drag before claiming the gesture, so a
  // vertical drag on the history list below still scrolls it normally.
  return Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy) * 1.5;
}

// Same shape as shouldClaimSidebarSwipe but direction-locked to rightward —
// the edge detector only ever needs to claim an opening drag, and requiring
// dx > 0 (rather than abs(dx)) keeps a leftward wobble right at the screen
// edge from claiming the responder away from whatever's underneath it.
export function shouldClaimEdgeOpenSwipe(dx: number, dy: number): boolean {
  return dx > 15 && dx > Math.abs(dy) * 1.5;
}

// vx is gestureState's velocity in points/ms (PanResponder's own unit); a
// fast flick commits the gesture even if released before crossing the
// distance threshold, same as a native drawer's fling-to-dismiss. Defaults
// to 0 so callers driven purely by distance (or existing tests) are
// unaffected.
export function isSidebarCloseSwipe(dx: number, vx = 0): boolean {
  return dx < -60 || vx < -0.5;
}

export function isSidebarOpenSwipe(dx: number, vx = 0): boolean {
  return dx > 60 || vx > 0.5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  /** Called once a left-to-right edge swipe commits to opening — the mirror
   * of onClose, since this component doesn't own `visible` itself (it's
   * CoachScreen's sidebarOpen state, same as the hamburger button). */
  onOpen: () => void;
  onNewChat: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
  onClearAll: () => void;
}

export function HistorySidebar({
  visible, items, loading, activeId, isPinned, titleFor, pinnedIds,
  onTogglePin, onRename, onClose, onOpen, onNewChat, onSelect, onDelete, onClearAll,
}: HistorySidebarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const drawerWidth = Math.min(340, screenWidth * 0.86);
  const closedX = -drawerWidth;

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

  // translateX is the single source of truth for the panel's horizontal
  // position — every open/close path (buttons, swipe-to-close, edge
  // swipe-to-open) animates or drags this same value, so they all settle
  // through the same spring instead of each having its own transition. A
  // lazy useState initializer (not useRef().current) keeps it a stable
  // identity across renders without tripping this codebase's react-hooks/
  // refs lint rule, which — correctly, for ordinary values — forbids
  // reading a ref during render; an Animated.Value is the sanctioned
  // exception (RN's own docs put it straight in JSX/style), since mutating
  // it via .setValue()/Animated.spring() deliberately bypasses React's
  // render cycle to update the native view directly.
  // modalVisible (distinct from the `visible` prop) is when the Modal is
  // actually mounted: it flips true the instant either an open animation
  // starts OR an opening drag is first recognized, and only flips back to
  // false once the close animation finishes — see animateTo below.
  const [translateX] = useState(() => new Animated.Value(visible ? 0 : closedX));
  const [modalVisible, setModalVisible] = useState(visible);

  // Drives translateX toward `target` (0 = open, closedX = closed), seeded
  // with the gesture's release velocity when there is one so the settle
  // speed matches how fast the teacher was actually dragging (a slow drag
  // eases in gently; a fast flick keeps going) — same idea as a native
  // drawer's fling-to-dismiss. Not memoized, for the same reason the old
  // panResponder below wasn't: it closes over the current render's
  // `drawerWidth`/`closedX`, and Animated.spring() is cheap to recreate.
  function animateTo(target: number, velocity = 0) {
    Animated.spring(translateX, {
      toValue: target,
      velocity,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start(({ finished }) => {
      if (finished && target === closedX) setModalVisible(false);
    });
  }

  // Keeps the Modal (and translateX) in sync when open/close is driven by
  // the hamburger button, the X button, or a backdrop tap — i.e. whenever
  // the parent's `visible` prop changes rather than a drag settling it
  // directly (that path calls animateTo itself, below). Genuinely needs to
  // be an effect (not a render-phase state adjustment): opening also has to
  // kick off the native Animated.spring, which is an imperative action on
  // an external system, not a pure state derivation.
  useEffect(() => {
    if (visible) {
      // Mounting the Modal has to happen before animateTo(0) below can be
      // seen, and both belong to this one prop-change response, not a
      // fetch-style effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModalVisible(true);
      animateTo(0);
    } else {
      animateTo(closedX);
    }
    // animateTo intentionally omitted: it's a fresh closure every render
    // (see above) and re-running this effect for that alone would replay
    // the animation on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropOpacity = translateX.interpolate({
    inputRange: [closedX, 0],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Swipe-to-close (right-to-left) on the open panel — a second way to
  // close, alongside the X button, now tracking the finger live instead of
  // only deciding on release. Not memoized: a plain closure over the current
  // render's `onClose` (like every other inline handler in this file)
  // rather than a ref, since this codebase's stricter react-hooks/refs lint
  // rule forbids reading a ref's `.current` anywhere in the render body —
  // including inside a useMemo factory — and PanResponder.create() is cheap
  // enough to not need memoing.
  const closePanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => shouldClaimSidebarSwipe(gesture.dx, gesture.dy),
    onPanResponderMove: (_, gesture) => translateX.setValue(clamp(gesture.dx, closedX, 0)),
    onPanResponderRelease: (_, gesture) => {
      if (isSidebarCloseSwipe(gesture.dx, gesture.vx)) {
        animateTo(closedX, gesture.vx);
        onClose();
      } else {
        animateTo(0, gesture.vx);
      }
    },
    onPanResponderTerminate: () => animateTo(0),
  });

  // Swipe-to-open (left-to-right) starting from the screen's left edge —
  // lives outside the Modal (see the file header comment) so it can detect
  // the gesture while the sidebar is still closed. Mounts the Modal as soon
  // as the drag is recognized so translateX's live updates during the drag
  // are actually visible, then hands off to the same animateTo/onOpen path
  // a completed swipe would use.
  const edgePanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !modalVisible && shouldClaimEdgeOpenSwipe(gesture.dx, gesture.dy),
    onPanResponderGrant: () => setModalVisible(true),
    onPanResponderMove: (_, gesture) => translateX.setValue(clamp(closedX + gesture.dx, closedX, 0)),
    onPanResponderRelease: (_, gesture) => {
      if (isSidebarOpenSwipe(gesture.dx, gesture.vx)) {
        animateTo(0, gesture.vx);
        onOpen();
      } else {
        animateTo(closedX, gesture.vx);
      }
    },
    onPanResponderTerminate: () => animateTo(closedX),
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
      {/* Edge-swipe-to-open target — outside the Modal on purpose (see the
          file header comment); pointerEvents only turns on once the sidebar
          is fully closed and idle, so it never competes with the panel's own
          swipe-to-close responder below or with the Modal's backdrop tap. */}
      <View
        style={[styles.edgeDetector, { width: EDGE_WIDTH }]}
        pointerEvents={modalVisible ? 'none' : 'auto'}
        testID="sidebar-edge-swipe-area"
        {...edgePanResponder.panHandlers}
      />

      <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onClose}>
        <View style={styles.modalRoot}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close sidebar" />
          </Animated.View>
          <Animated.View
            style={[
              styles.panel,
              {
                width: drawerWidth,
                backgroundColor: colors.surface,
                borderRightColor: colors.border,
                transform: [{ translateX }],
              },
            ]}
          >
            {/* panHandlers live on this plain View, not a Pressable —
                Pressable owns the same six responder prop names internally
                for its own press handling (Pressability), so handlers
                spread onto a Pressable risk being shadowed rather than
                actually wired up; a plain View has no such conflict. The
                open/close decision itself (shouldClaimSidebarSwipe/
                isSidebarCloseSwipe/isSidebarOpenSwipe above) is unit-tested
                directly (CoachScreen.test.tsx) rather than by simulating
                touch here, since `adb shell input swipe`-style synthetic
                gestures aren't a reliable proxy for the continuous native
                touch stream PanResponder needs to compute real gesture state
                from. */}
            <View
              style={[styles.panelInner, { paddingTop: insets.top + spacing.sm }]}
              testID="sidebar-swipe-area"
              {...closePanResponder.panHandlers}
            >
            <View style={styles.headerRow}>
              <View style={styles.brandRow}>
                <Image source={require('../../../assets/logo.png')} style={styles.brandLogo} />
                <View style={styles.brandText}>
                  <ThemedText style={styles.brandTitle}>SarasTech</ThemedText>
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
          </Animated.View>
        </View>
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
  // Left-edge swipe-to-open target — lives outside the Modal, so it's sized/
  // positioned relative to the navigator's normal content area rather than
  // the true full-bleed screen; that's fine here since it's invisible and
  // only needs to catch a touch starting near the visible left edge.
  edgeDetector: { position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 1 },
  modalRoot: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRightWidth: StyleSheet.hairlineWidth },
  panelInner: { flex: 1, paddingHorizontal: spacing.md, gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  brandLogo: { width: 30, height: 30, borderRadius: 8 },
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
