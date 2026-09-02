// Native composer: single-line-growing TextInput + send button (docs/mobile-app-plan.md
// §26 Phase 4 mobile-UI checklist: input composer, send button, touch
// targets). Attachments (ATTACHMENTS_ENABLED) and the Assistant Mode /
// Classroom Mode selector (CLASSROOM_MODE_ENABLED) were ported after Phase 4
// shipped, mirroring client/src/components/Composer.tsx's second control row
// (AddMenu + ClassroomModeMenu on the left, char count + send on the right) —
// see that file's own doc comment for why a MODE lives on the opposite side
// from an "add". Box styling (surface-2 panel, focus ring, circular send)
// ported from .composer-box / .composer-send in UI_REFINED.md §10.4.
import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { ArrowUp } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { MAX_QUERY_LENGTH, ATTACHMENTS_ENABLED, CLASSROOM_MODE_ENABLED, MAX_ATTACHMENTS_COUNT } from '../../config';
import type { useAttachments } from '../../lib/useAttachments';
import { AttachmentTray } from './AttachmentTray';
import { AddMenu } from './AddMenu';
import { ClassroomModeMenu } from './ClassroomModeMenu';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  attachments: ReturnType<typeof useAttachments>;
  classroomMode: boolean;
  onClassroomModeChange: (on: boolean) => void;
}

export function Composer({
  value, onChange, onSubmit, loading, attachments, classroomMode, onClassroomModeChange,
}: ComposerProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  // Matches the web's handleSubmit: text is always required, even with
  // attachments staged — an attachment-only send has no question to ask.
  const canSend = !loading && value.trim().length > 0;
  const showCharCount = value.length > MAX_QUERY_LENGTH * 0.8;
  const nearLimit = value.length > MAX_QUERY_LENGTH * 0.9;
  const atMaxAttachments = attachments.attachments.length >= MAX_ATTACHMENTS_COUNT;

  const trayItems = attachments.attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind, previewUri: a.uri }));

  return (
    <View style={styles.dock}>
      {/* Outer ring wrapper: a 3dp orangeSoft padding that only shows once
          focused, matching .composer-box:focus-within's box-shadow ring
          (UI_REFINED.md §10.4) without relying on RN's unreliable
          cross-platform shadow rendering for a colored ring effect. */}
      <View style={[styles.ring, { backgroundColor: focused ? colors.orangeSoft : 'transparent' }]}>
      <View
        style={[
          styles.panel,
          { backgroundColor: colors.surface2, borderColor: focused ? colors.orange : colors.border },
        ]}
      >
        {ATTACHMENTS_ENABLED && attachments.error && (
          <ThemedText style={[styles.attachmentError, { color: colors.semantic.danger.text }]} accessibilityRole="alert">
            {attachments.error}
          </ThemedText>
        )}
        {ATTACHMENTS_ENABLED && (
          <AttachmentTray attachments={trayItems} onRemove={attachments.remove} disabled={loading} variant="preview" />
        )}
        {showCharCount && (
          <ThemedText
            variant="muted"
            style={[styles.charCount, nearLimit && { color: colors.orange, fontWeight: '700' }]}
            accessibilityLiveRegion="polite"
          >
            {value.length}/{MAX_QUERY_LENGTH}
          </ThemedText>
        )}
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={value}
          onChangeText={(text) => onChange(text.slice(0, MAX_QUERY_LENGTH))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Ask anything about teaching…"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={MAX_QUERY_LENGTH}
          accessibilityLabel="Your question"
          testID="coach-composer-input"
        />
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            {ATTACHMENTS_ENABLED && (
              <AddMenu onAdd={attachments.add} disabled={loading} atMax={atMaxAttachments} />
            )}
            {CLASSROOM_MODE_ENABLED && (
              <ClassroomModeMenu classroomMode={classroomMode} onClassroomModeChange={onClassroomModeChange} disabled={loading} />
            )}
          </View>
          <Pressable
            onPress={onSubmit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send question"
            testID="coach-composer-send"
            hitSlop={4}
            style={styles.sendHitArea}
          >
            <View
              style={[styles.send, { backgroundColor: colors.orange }, !canSend && styles.sendDisabled]}
            >
              <ArrowUp size={18} color="#fff" />
            </View>
          </Pressable>
        </View>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { padding: spacing.md },
  ring: { borderRadius: radius.md + 3, padding: 3 },
  // .composer-box: --surface-2 panel at --radius (14) with a 1px --border,
  // sitting inside the dock's padding rather than being the dock itself
  // (UI_REFINED.md §10.4).
  panel: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  attachmentError: { fontSize: 12, paddingHorizontal: spacing.xs },
  charCount: { fontSize: 11, textAlign: 'right', paddingHorizontal: spacing.xs },
  input: {
    fontSize: 16,
    maxHeight: 120,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  // Web's second control row (.composer-controls): everything that acts on
  // the whole turn (add/mode on the left) or the send action (right) lives on
  // its own row below the growing text, so neither competes with the other
  // for cramped horizontal space.
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  // Visual circle matches .composer-send's 38dp exactly; the touchable area
  // stays 44x44dp (§13's minimum touch target) via padding around it, not by
  // growing the visible circle.
  sendHitArea: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 }, // .composer-send:disabled's exact value (index.css:2237)
});
