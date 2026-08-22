// Native Coach chat screen — the mobile-native redesign of
// client/src/pages/CoachPage.tsx's core question→answer loop, over the same
// POST /api/coach contract (docs/mobile-app-plan.md §26 Phase 4). Full
// rewrite per §9 (no salvageable web JSX); reused: the request/response
// contract (api/coach.ts), the Turn/CoachResponse/QueryContext types (Phase
// 1), and RunStatus's loading copy (lib/runStatus.ts, §23).
//
// Deliberately out of scope this phase (documented in
// docs/mobile-app-plan.md's Phase 4 status note, not silently dropped):
// chat history sidebar/search (GET /queries), file/photo attachments
// (POST /coach/attachment), voice input, Classroom Mode, the
// grade/subject/language context picker (TeachingContextMenu — every request
// here sends language 'en' and an empty context), LaTeX math rendering, and
// edit-in-place/copy/share/save-to-library on a sent message. §26 Phase 4's
// own goal is "chat UI over POST /api/coach, matching the web's core
// question→answer loop" — these are each either a separate phase's own
// screen (Library, Notifications) or a follow-up once the core loop is
// verified on-device.
import React, { useRef, useState } from 'react';
import { View, FlatList, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import { ApiError } from '../../api/client';
import { askCoach, sendCoachFeedback } from '../../api/coach';
import { EmptyState } from './EmptyState';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import type { QueryContext, Turn } from '../../types';

const EMPTY_CONTEXT: QueryContext = { grade: '', subject: '', classroomType: '', issueType: '' };
// No language/context picker yet (see file header) — every request is
// English with no grade/subject tags, matching the web's own default state
// before a teacher touches TeachingContextMenu.
const DEFAULT_LANGUAGE = 'en';

function newTurnId(): string {
  return `t${Date.now()}${Math.random().toString(36).slice(2)}`;
}

export function CoachScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const displayName = user?.displayName || user?.name || '';

  const [turns, setTurns] = useState<Turn[]>([]);
  const [query, setQuery] = useState('');
  const listRef = useRef<FlatList<Turn>>(null);
  const isSubmitting = turns.some((t) => t.status === 'pending');

  function scrollToEnd() {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

  async function runTurn(id: string, queryText: string) {
    try {
      const res = await askCoach(queryText, DEFAULT_LANGUAGE, EMPTY_CONTEXT);
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'done', response: res, rating: null } : t)));
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
        language: DEFAULT_LANGUAGE,
        context: EMPTY_CONTEXT,
        status: 'pending',
        rating: null,
        startedAt: Date.now(),
      },
    ]);
    setQuery('');
    scrollToEnd();
    void runTurn(id, trimmed);
  }

  function handleRetry(turn: Turn) {
    setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, status: 'pending', error: undefined, startedAt: Date.now() } : t)));
    void runTurn(turn.id, turn.query);
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

  return (
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
          renderItem={({ item }) => <MessageBubble turn={item} onRetry={handleRetry} onFeedback={handleFeedback} />}
          contentContainerStyle={styles.list}
          onContentSizeChange={scrollToEnd}
          testID="coach-message-list"
        />
      )}
      <View style={{ paddingBottom: insets.bottom }}>
        <Composer value={query} onChange={setQuery} onSubmit={() => submitQuery(query)} loading={isSubmitting} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.lg },
  emptyContainer: { flexGrow: 1 },
});
