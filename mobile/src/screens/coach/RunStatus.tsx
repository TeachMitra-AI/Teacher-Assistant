// Native port of client/src/components/RunStatus.tsx (docs/mobile-app-plan.md
// §23's explicit instruction to port its staged-loading-message copy). Same
// reasoning as the web version: POST /coach is a single non-streaming
// request that can legitimately take up to LLM_TOTAL_TIMEOUT_MS (60s default,
// server/.env.example) — a frozen-looking spinner for that long reads as a
// hang, so this shows three pulsing skeleton lines (content is coming, no
// stage/percentage claimed — see lib/runStatus.ts) plus the elapsed time.
import React, { useEffect, useState } from 'react';
import { View, Animated, StyleSheet, Easing } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { formatElapsed, waitingMessage } from '../../lib/runStatus';

interface RunStatusProps {
  /** Date.now() at submit. */
  startedAt: number;
}

export function RunStatus({ startedAt }: RunStatusProps) {
  const { colors } = useTheme();
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);
  // useState (not useRef) so the Animated.Value's identity is stable across
  // renders without reading a ref during render — the new react-hooks/refs
  // lint rule (eslint-config-expo, current version) now flags the common
  // `useRef(x).current` lazy-singleton pattern as an error.
  const [pulse] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    // Re-read the clock rather than accumulating — a backgrounded app
    // throttles timers, and a counter that just adds 1000/tick would drift
    // behind the real wait exactly when the wait is longest.
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.ease, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.ease, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.skeleton}>
        <Animated.View style={[styles.skLine, { backgroundColor: colors.border, opacity: pulse, width: '90%' }]} />
        <Animated.View style={[styles.skLine, { backgroundColor: colors.border, opacity: pulse, width: '75%' }]} />
        <Animated.View style={[styles.skLine, { backgroundColor: colors.border, opacity: pulse, width: '55%' }]} />
      </View>
      <View style={styles.row}>
        <ThemedText variant="muted" style={styles.message} accessibilityLiveRegion="polite">
          {waitingMessage(elapsedMs)}
        </ThemedText>
        <ThemedText variant="muted" style={styles.time} accessibilityElementsHidden>
          {formatElapsed(elapsedMs)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm },
  skeleton: { gap: spacing.sm },
  skLine: { height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  message: { fontSize: 13, flexShrink: 1 },
  time: { fontSize: 12 },
});
