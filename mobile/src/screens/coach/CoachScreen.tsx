// Native Coach chat screen — the mobile-native redesign of
// client/src/pages/CoachPage.tsx's core question→answer loop, over the same
// POST /api/coach contract (docs/mobile-app-plan.md §26 Phase 4). Full
// rewrite per §9 (no salvageable web JSX); reused: the request/response
// contract (api/coach.ts), the Turn/CoachResponse/QueryContext types (Phase
// 1), and RunStatus's loading copy (lib/runStatus.ts, §23).
//
// The chat-history sidebar (HistorySidebar.tsx, opened from Header's
// hamburger icon) and the teaching-context menu (TeachingContextMenu.tsx,
// opened from Header's right-side icon) — both wired the same way, via
// navigation.setOptions in the useLayoutEffect below — were ported after
// Phase 4 shipped, as was edit-in-place on a sent message (handleEditTurn
// below, mirroring the web's own CoachPage.tsx one-for-one). Still deferred:
// file/photo attachments (POST /coach/attachment, a new API+UI surface),
// voice input (needs a native speech module), Classroom Mode, LaTeX math
// rendering, and copy-to-clipboard on a sent message (needs expo-clipboard,
// not currently installed).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, FlatList, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CoachStackParamList } from '../../navigation/types';
import { useAuth } from '../../auth/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import { ApiError } from '../../api/client';
import { askCoach, sendCoachFeedback, listHistory, deleteHistoryItem, clearHistory } from '../../api/coach';
import { useHistoryOverrides } from '../../lib/useHistoryOverrides';
import { Header } from '../../components/Header';
import { EmptyState } from './EmptyState';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { HistorySidebar } from './HistorySidebar';
import { TeachingContextMenu } from './TeachingContextMenu';
import type { HistoryItem, QueryContext, Turn } from '../../types';

const EMPTY_CONTEXT: QueryContext = { grade: '', subject: '', classroomType: '', issueType: '' };
// Default state before a teacher touches TeachingContextMenu — matches the
// web's own default (English, no grade/subject/classroom/focus tags).
const DEFAULT_LANGUAGE = 'en';
const HISTORY_LIMIT = 20;

function newTurnId(): string {
  return `t${Date.now()}${Math.random().toString(36).slice(2)}`;
}

type Props = NativeStackScreenProps<CoachStackParamList, 'Chat'>;

export function CoachScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const displayName = user?.displayName || user?.name || '';

  const [turns, setTurns] = useState<Turn[]>([]);
  const [query, setQuery] = useState('');
  const listRef = useRef<FlatList<Turn>>(null);
  const isSubmitting = turns.some((t) => t.status === 'pending');

  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [context, setContext] = useState<QueryContext>(EMPTY_CONTEXT);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  // Language isn't counted: it always has a value (defaults to English), so
  // it can never distinguish "set" from "unset" the way the other four can
  // — same reasoning as the web's TeachingContextMenu.
  const contextActiveCount = [context.grade, context.subject, context.classroomType, context.issueType].filter(Boolean).length;

  function setCtx(key: keyof QueryContext, value: string) {
    setContext((c) => ({ ...c, [key]: value }));
  }

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const {
    isPinned, titleFor, pinnedIds, togglePin,
    rename: renameHistoryItem, forget: forgetHistoryItem,
  } = useHistoryOverrides(history);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const queries = await listHistory(HISTORY_LIMIT);
      // Defensive against a response shape that doesn't include `queries`
      // (listHistory would then resolve to undefined rather than throw) —
      // this array is handed straight to a .filter()/.map() below.
      setHistory(Array.isArray(queries) ? queries : []);
    } catch {
      // History is non-critical; fail quietly — same as the web sidebar's
      // loadHistory.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount pattern — see useClassListScreen.ts's
    // identical, already-documented case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHistory();
  }, [loadHistory]);

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const openContextMenu = useCallback(() => setContextMenuOpen(true), []);

  // Header is rendered by the navigator (CoachStack's `header` option), not
  // as this screen's child, so the sidebar-open/context-menu-open handlers
  // have to reach it via setOptions — same pattern StudentsScreen.tsx uses
  // for its dynamic headerRight.
  useLayoutEffect(() => {
    navigation.setOptions({
      header: () => (
        <Header
          variant="coach"
          onMenuPress={openSidebar}
          onContextPress={openContextMenu}
          contextActiveCount={contextActiveCount}
        />
      ),
    });
  }, [navigation, openSidebar, openContextMenu, contextActiveCount]);

  function scrollToEnd() {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

  async function runTurn(id: string, queryText: string, lang: string, ctx: QueryContext) {
    try {
      const res = await askCoach(queryText, lang, ctx);
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'done', response: res, rating: null } : t)));
      void loadHistory();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to get a response. Please try again.';
      const errorIsNetwork = err instanceof ApiError && err.status === 0;
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error', error: message, errorIsNetwork } : t)));
    } finally {
      scrollToEnd();
    }
  }

  function submitQuery(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = newTurnId();
    setTurns((ts) => [
      ...ts,
      {
        id,
        query: trimmed,
        language,
        context,
        status: 'pending',
        rating: null,
        startedAt: Date.now(),
      },
    ]);
    setQuery('');
    scrollToEnd();
    void runTurn(id, trimmed, language, context);
  }

  function handleRetry(turn: Turn) {
    setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, status: 'pending', error: undefined, startedAt: Date.now() } : t)));
    // A retry repeats the request exactly as it was first submitted — the
    // turn's own snapshotted language/context, not whatever the teaching-
    // context menu currently holds (mirrors the web's handleRetry).
    void runTurn(turn.id, turn.query, turn.language, turn.context);
  }

  // Edit-and-resubmit a sent prompt (MessageBubble's Edit action). Updates
  // the SAME turn in place — same id, same snapshotted language/context it
  // was first submitted with — rather than appending a new one, so the
  // thread never grows a duplicate message. Mirrors handleRetry above, just
  // with the query text also changing (mirrors the web's handleEditTurn).
  function handleEditTurn(turnId: string, newQuery: string) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn) return;
    setTurns((ts) => ts.map((t) => (t.id === turnId
      ? { ...t, query: newQuery, status: 'pending', error: undefined, response: undefined, rating: null, restored: false, startedAt: Date.now() }
      : t)));
    scrollToEnd();
    void runTurn(turnId, newQuery, turn.language, turn.context);
  }

  async function handleFeedback(turnId: string, rating: 'helpful' | 'not_helpful') {
    const turn = turns.find((t) => t.id === turnId);
    const queryId = turn?.response?.queryId;
    if (!queryId) return;
    setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, rating } : t)));
    try {
      await sendCoachFeedback(queryId, rating);
    } catch {
      // Rollback on failure — no toast system exists on mobile yet (that's a
      // web-only affordance, client/src/components/Toast.tsx); silently
      // reverting the optimistic state is the honest fallback.
      setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, rating: null } : t)));
    }
  }

  function handleNewChat() {
    setTurns([]);
    setQuery('');
    // A new conversation must not inherit the previous one's remembered
    // grade/subject/classroom/focus — a stale slot produces a confident,
    // wrong answer (mirrors the web's handleNewChat). Language is left
    // alone, same as the web.
    setContext(EMPTY_CONTEXT);
    setSidebarOpen(false);
  }

  function selectHistory(item: HistoryItem) {
    const mergedContext = { ...EMPTY_CONTEXT, ...item.context };
    setTurns([{
      id: item.id,
      query: item.query,
      language: item.language,
      context: mergedContext,
      status: 'done',
      rating: item.rating,
      // Reopening a chat must not spend model calls — the answer is restored
      // as-is (D24's `restored` flag, mirrored from the web).
      restored: true,
      response: {
        success: true,
        text: item.text,
        language: item.language,
        context: item.context,
        queryId: item.id,
        ...(item.classroom ? { classroom: item.classroom } : {}),
      },
    }]);
    // The reopened chat's own language/context become the live state too,
    // so a NEW question asked right after continues in the same language/
    // context rather than silently reverting to the default (mirrors the
    // web's selectHistory).
    setLanguage(item.language);
    setContext(mergedContext);
    setQuery('');
    setSidebarOpen(false);
    scrollToEnd();
  }

  async function handleDeleteHistory(item: HistoryItem) {
    const previous = history;
    setHistory((h) => h.filter((x) => x.id !== item.id));
    try {
      await deleteHistoryItem(item.id);
      forgetHistoryItem(item.id);
    } catch {
      setHistory(previous); // rollback on failure
    }
  }

  async function handleClearHistory() {
    if (history.length === 0) return;
    const previous = history;
    setHistory([]);
    try {
      await clearHistory();
    } catch {
      setHistory(previous); // rollback on failure
    }
  }

  const activeHistoryId = turns.length === 1 ? turns[0].response?.queryId ?? null : null;

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: colors.bg }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {turns.length === 0 ? (
          <ScrollView contentContainerStyle={styles.emptyContainer} testID="coach-empty-state" keyboardShouldPersistTaps="handled">
            <EmptyState name={displayName} onPickPrompt={setQuery} />
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={turns}
            keyExtractor={(t) => t.id}
            renderItem={({ item }) => (
              <MessageBubble turn={item} onRetry={handleRetry} onFeedback={handleFeedback} onEdit={handleEditTurn} />
            )}
            contentContainerStyle={styles.list}
            onContentSizeChange={scrollToEnd}
            testID="coach-message-list"
          />
        )}
        <View style={{ paddingBottom: insets.bottom }}>
          <Composer value={query} onChange={setQuery} onSubmit={() => submitQuery(query)} loading={isSubmitting} />
        </View>
      </KeyboardAvoidingView>

      <HistorySidebar
        visible={sidebarOpen}
        items={history}
        loading={historyLoading}
        activeId={activeHistoryId}
        isPinned={isPinned}
        titleFor={titleFor}
        pinnedIds={pinnedIds}
        onTogglePin={togglePin}
        onRename={renameHistoryItem}
        onClose={() => setSidebarOpen(false)}
        onOpen={openSidebar}
        onNewChat={handleNewChat}
        onSelect={selectHistory}
        onDelete={handleDeleteHistory}
        onClearAll={handleClearHistory}
      />

      <TeachingContextMenu
        visible={contextMenuOpen}
        onClose={() => setContextMenuOpen(false)}
        language={language}
        onLanguageChange={setLanguage}
        context={context}
        onContextChange={setCtx}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.lg },
  emptyContainer: { flexGrow: 1 },
});
