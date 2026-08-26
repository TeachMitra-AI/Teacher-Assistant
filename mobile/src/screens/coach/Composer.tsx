// Native composer: single-line-growing TextInput + send button (docs/mobile-app-plan.md
// §26 Phase 4 mobile-UI checklist: input composer, send button, touch
// targets). Deliberately narrower than client/src/components/Composer.tsx —
// no attachments/voice/Classroom Mode controls; see docs/mobile-app-plan.md's
// Phase 4 status note for why those are out of scope this phase. Box styling
// (surface-2 panel, focus ring, circular send) ported from .composer-box /
// .composer-send in UI_REFINED.md §10.4; the web's second control row is
// deliberately NOT ported — see that section for why the current
// send-beside-input arrangement is kept.
import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { ArrowUp } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { MAX_QUERY_LENGTH } from '../../config';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

export function Composer({ value, onChange, onSubmit, loading }: ComposerProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const canSend = !loading && value.trim().length > 0;
  const showCharCount = value.length > MAX_QUERY_LENGTH * 0.8;
  const nearLimit = value.length > MAX_QUERY_LENGTH * 0.9;

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
        {showCharCount && (
          <ThemedText
            variant="muted"
            style={[styles.charCount, nearLimit && { color: colors.orange, fontWeight: '700' }]}
            accessibilityLiveRegion="polite"
          >
            {value.length}/{MAX_QUERY_LENGTH}
          </ThemedText>
        )}
        <View style={styles.row}>
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
  charCount: { fontSize: 11, textAlign: 'right', paddingHorizontal: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  // Visual circle matches .composer-send's 38dp exactly; the touchable area
  // stays 44x44dp (§13's minimum touch target) via padding around it, not by
  // growing the visible circle.
  sendHitArea: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 }, // .composer-send:disabled's exact value (index.css:2237)
});
