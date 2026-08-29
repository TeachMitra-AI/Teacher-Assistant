// Pushed from AdminSupportScreen's ticket list (Admin > Support > tap a
// ticket) — native port of AdminSupportTicketPage.tsx: description,
// auto-captured context, internal notes thread + add-note form, status
// change, reporter info, timestamps. Header title is set by
// AppNavigator.tsx's `Ticket #<ref>` options — no dynamic retitle needed
// here (unlike HelpSupportScreen's internal-view switch), since the ticket
// id is already known from route.params before this screen mounts.
import React from 'react';
import { View, ScrollView, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AppStackParamList } from '../../../navigation/types';
import { ThemedText } from '../../../components/ThemedText';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { useAdminSupportTicketScreen } from './useAdminSupportTicketScreen';
import type { SupportTicketStatus } from '../../../types';

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open', triaged: 'Triaged', resolved: 'Resolved', wont_fix: "Won't fix",
};
const STATUSES = Object.keys(STATUS_LABELS) as SupportTicketStatus[];
const TYPE_LABELS = { bug: 'Bug', feedback: 'Feedback' } as const;

// Known, human-labeled context keys — mirrors
// AdminSupportTicketPage.tsx's CONTEXT_LABELS, minus the browser-only keys
// (userAgent/viewport) mobile's SupportTicketContext never sends.
const CONTEXT_LABELS: Record<string, string> = {
  buildId: 'Build', theme: 'Theme', language: 'Language',
  grade: 'Grade', subject: 'Subject', classroomType: 'Classroom type',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

type Props = NativeStackScreenProps<AppStackParamList, 'AdminSupportTicket'>;

export function AdminSupportTicketScreen({ route }: Props) {
  const { colors } = useTheme();
  const s = useAdminSupportTicketScreen(route.params.id);

  if (s.loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.orange} />
        <ThemedText variant="muted">Loading ticket…</ThemedText>
      </View>
    );
  }

  if (s.error || !s.ticket) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ThemedText style={{ color: colors.semantic.danger.text }}>{s.error || 'Could not load this ticket.'}</ThemedText>
      </View>
    );
  }

  const ticket = s.ticket;
  const contextEntries = ticket.context ? Object.entries(ticket.context).filter(([key]) => CONTEXT_LABELS[key]) : [];

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <View style={styles.head}>
        <View style={[styles.typeTag, { backgroundColor: colors.surface2 }]}>
          <ThemedText style={styles.typeTagText}>{TYPE_LABELS[ticket.type]}</ThemedText>
        </View>
        <View style={[styles.statusPill, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <ThemedText variant="muted" style={styles.statusText}>{STATUS_LABELS[ticket.status]}</ThemedText>
        </View>
      </View>

      <View style={styles.statusActions}>
        {STATUSES.filter((st) => st !== ticket.status).map((st) => (
          <Button
            key={st}
            title={STATUS_LABELS[st]}
            variant="text"
            disabled={s.updatingStatus}
            onPress={() => s.changeStatus(st)}
            testID={`ticket-status-${st}`}
          />
        ))}
      </View>

      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Description</ThemedText>
        <ThemedText>{ticket.description || 'No description provided.'}</ThemedText>
      </Card>

      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Auto-captured context</ThemedText>
        {contextEntries.length === 0 ? (
          <ThemedText variant="muted">Nothing was captured for this ticket.</ThemedText>
        ) : (
          contextEntries.map(([key, value]) => (
            <View key={key} style={styles.kvRow}>
              <ThemedText variant="muted" style={styles.kvKey}>{CONTEXT_LABELS[key]}</ThemedText>
              <ThemedText style={styles.kvValue}>{value}</ThemedText>
            </View>
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Reported by</ThemedText>
        {ticket.user ? (
          <>
            <ThemedText>{ticket.user.name}</ThemedText>
            <ThemedText variant="muted">{ticket.user.email} · {ticket.user.role}</ThemedText>
            {ticket.school && <ThemedText variant="muted">{ticket.school.name} ({ticket.school.code})</ThemedText>}
          </>
        ) : (
          <ThemedText variant="muted">No reporter on file.</ThemedText>
        )}
      </Card>

      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Timestamps</ThemedText>
        <View style={styles.kvRow}>
          <ThemedText variant="muted" style={styles.kvKey}>Created</ThemedText>
          <ThemedText style={styles.kvValue}>{formatDateTime(ticket.createdAt)}</ThemedText>
        </View>
        <View style={styles.kvRow}>
          <ThemedText variant="muted" style={styles.kvKey}>Updated</ThemedText>
          <ThemedText style={styles.kvValue}>{formatDateTime(ticket.updatedAt)}</ThemedText>
        </View>
      </Card>

      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Internal notes</ThemedText>
        <ThemedText variant="muted" style={styles.hint}>Never visible to the teacher who filed this ticket.</ThemedText>
        {ticket.notes.length === 0 && <ThemedText variant="muted">No notes yet.</ThemedText>}
        {ticket.notes.map((note) => (
          <View key={note.id} style={[styles.note, { borderTopColor: colors.border }]}>
            <ThemedText style={styles.noteBody}>{note.body}</ThemedText>
            <ThemedText variant="muted" style={styles.noteMeta}>{note.author.name} · {formatDateTime(note.createdAt)}</ThemedText>
          </View>
        ))}

        <TextInput
          style={[styles.noteInput, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
          value={s.noteBody}
          onChangeText={s.setNoteBody}
          placeholder="Add a note…"
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          maxLength={2000}
          accessibilityLabel="Add a note"
        />
        {!!s.noteError && <ThemedText style={{ color: colors.semantic.danger.text }}>{s.noteError}</ThemedText>}
        <Button
          title={s.submittingNote ? 'Sending…' : 'Add note'}
          onPress={s.addNote}
          loading={s.submittingNote}
          disabled={s.noteBody.trim().length === 0}
          testID="ticket-add-note"
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  typeTag: { borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  typeTagText: { fontSize: 11, fontWeight: '700' },
  statusPill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: '600' },
  statusActions: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { gap: spacing.xs },
  cardTitle: { fontSize: 15 },
  hint: { fontSize: 12 },
  kvRow: { flexDirection: 'row', gap: spacing.sm },
  kvKey: { width: 90, fontSize: 13 },
  kvValue: { flex: 1, fontSize: 13 },
  note: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.xs, gap: 2 },
  noteBody: { fontSize: 14 },
  noteMeta: { fontSize: 11 },
  noteInput: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 14, minHeight: 72, textAlignVertical: 'top', marginTop: spacing.xs,
  },
});
