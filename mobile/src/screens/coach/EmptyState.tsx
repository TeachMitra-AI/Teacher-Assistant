// Native welcome/empty state — the mobile analogue of
// client/src/components/WelcomeScreen.tsx's quick-action grid (same four
// prompts/copy from client/src/config.ts's QUICK_ACTIONS), without the
// desktop-only greeting-of-the-day/DailyHighlight/first-run-onboarding-intro
// machinery those depend on (client/src/lib/welcome.ts, the onboarding
// system) — none of that exists on mobile yet; see docs/mobile-app-plan.md's
// Phase 4 status note.
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { NotebookPen, Target, Lightbulb, ClipboardCheck, type LucideIcon } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';

interface QuickAction {
  icon: LucideIcon;
  label: string;
  description: string;
  prompt: string;
}

// Copy ported verbatim from client/src/config.ts's QUICK_ACTIONS.
const QUICK_ACTIONS: QuickAction[] = [
  { icon: NotebookPen, label: 'Lesson Plan', description: 'Structured plans with objectives and activities', prompt: 'Create a lesson plan for ' },
  { icon: Target, label: 'Classroom Activity', description: 'Engaging, ready-to-run activities', prompt: 'Suggest a classroom activity for ' },
  { icon: Lightbulb, label: 'Explain a Concept', description: 'Simple explanations for your grade', prompt: 'Explain this concept simply: ' },
  { icon: ClipboardCheck, label: 'Assessment', description: 'Quizzes and worksheets to check learning', prompt: 'Create a short assessment for ' },
];

interface EmptyStateProps {
  name: string;
  onPickPrompt: (prompt: string) => void;
}

export function EmptyState({ name, onPickPrompt }: EmptyStateProps) {
  const { colors } = useTheme();
  const greeting = name ? `Hi ${name} 👋` : 'Hi there 👋';

  return (
    <View style={styles.container}>
      <ThemedText variant="title" style={styles.greeting}>
        {greeting}
      </ThemedText>
      <ThemedText variant="muted" style={styles.subtitle}>
        What can I help you with today?
      </ThemedText>

      <View style={styles.grid}>
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.label}
            onPress={() => onPickPrompt(action.prompt)}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            testID={`quick-action-${action.label}`}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <action.icon size={20} color={colors.orange} />
            <ThemedText style={styles.cardTitle}>{action.label}</ThemedText>
            <ThemedText variant="muted" style={styles.cardDesc}>
              {action.description}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.xs },
  greeting: { fontSize: 22 },
  subtitle: { marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
    minHeight: 100,
  },
  cardTitle: { fontWeight: '600', fontSize: 14 },
  cardDesc: { fontSize: 12, lineHeight: 16 },
});
