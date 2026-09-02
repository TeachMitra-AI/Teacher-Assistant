// Native welcome/empty state — the mobile analogue of
// client/src/components/WelcomeScreen.tsx's quick-action grid (same four
// prompts/copy from client/src/config.ts's QUICK_ACTIONS) plus the Today's
// Highlight card (client/src/components/DailyHighlight.tsx), ported in
// Phase 7c's "Newly approved features" pass — see docs/mobile-app-plan.md.
import React, { useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { NotebookPen, Target, Lightbulb, ClipboardCheck, type LucideIcon } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { getDailyHighlight } from '../../lib/welcome';
import { DailyHighlightCard } from './DailyHighlightCard';

interface QuickAction {
  icon: LucideIcon;
  label: string;
  description: string;
  prompt: string;
  hideOnMobile?: boolean;
}

// Copy ported verbatim from client/src/config.ts's QUICK_ACTIONS, including
// its `hideOnMobile` flag on the 4th action — the web hides it at mobile
// width (client/src/config.ts, enforced by `.quick-action-card--mobile-
// hidden`) so the composer stays reachable without scrolling; mirrored here
// for the same reason and to match the web's mobile view exactly.
const QUICK_ACTIONS: QuickAction[] = [
  { icon: NotebookPen, label: 'Lesson Plan', description: 'Structured plans with objectives and activities', prompt: 'Create a lesson plan for ' },
  { icon: Target, label: 'Classroom Activity', description: 'Engaging, ready-to-run activities', prompt: 'Suggest a classroom activity for ' },
  { icon: Lightbulb, label: 'Explain a Concept', description: 'Simple explanations for your grade', prompt: 'Explain this concept simply: ' },
  { icon: ClipboardCheck, label: 'Assessment', description: 'Quizzes and worksheets to check learning', prompt: 'Create a short assessment for ', hideOnMobile: true },
];

interface EmptyStateProps {
  name: string;
  onPickPrompt: (prompt: string) => void;
}

export function EmptyState({ name, onPickPrompt }: EmptyStateProps) {
  const { colors } = useTheme();
  const greeting = name ? `Hi ${name} 👋` : 'Hi there 👋';
  // Computed once per mount, matching client/src/components/WelcomeScreen.tsx's
  // own useMemo — the underlying selection is already deterministic by date
  // (see lib/welcome.ts), this just avoids recomputing on every re-render.
  const highlight = useMemo(() => getDailyHighlight(), []);

  return (
    <View style={styles.container}>
      <ThemedText variant="title" style={styles.greeting}>
        {greeting}
      </ThemedText>
      <ThemedText variant="muted" style={styles.subtitle}>
        What can I help you with today?
      </ThemedText>

      <DailyHighlightCard highlight={highlight} />

      <View style={styles.grid}>
        {QUICK_ACTIONS.filter((a) => !a.hideOnMobile).map((action) => (
          <Pressable
            key={action.label}
            onPress={() => onPickPrompt(action.prompt)}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            testID={`quick-action-${action.label}`}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={[styles.iconWell, { backgroundColor: colors.orangeSoft }]}>
              <action.icon size={18} color={colors.orange} />
            </View>
            <View style={styles.cardText}>
              <ThemedText style={styles.cardTitle}>{action.label}</ThemedText>
              <ThemedText variant="muted" style={styles.cardDesc}>
                {action.description}
              </ThemedText>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.xs, alignItems: 'center' },
  greeting: { fontSize: 22, textAlign: 'center' },
  subtitle: { marginBottom: spacing.lg, textAlign: 'center' },
  // Single column, matching the web's `.quick-action-grid` mobile override
  // (grid-template-columns: 1fr) — see this file's header comment. Explicit
  // width so these stay full-width rows despite the container's centered
  // alignItems (which only the greeting/highlight text should shrink-wrap).
  //
  // marginTop tops up the container's own `gap: spacing.xs` (4dp) between
  // this grid and the DailyHighlightCard above it to spacing.md (12dp) total
  // — matching the web's phone-width gap between `.daily-highlight-card` and
  // `.quick-action-grid` (`.welcome-screen`'s 0.75rem flex gap, index.css's
  // mobile breakpoint) instead of the much tighter default the shared
  // container gap alone would leave between just these two children.
  grid: { gap: spacing.sm, width: '100%', marginTop: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    minHeight: 72,
  },
  iconWell: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontWeight: '600', fontSize: 15 },
  cardDesc: { fontSize: 12, lineHeight: 16 },
});
