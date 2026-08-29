import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ThemedText } from '../components/ThemedText';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { spacing, radius } from '../theme/tokens';
import { ONBOARDING_FEATURES } from '../config';
import type { AppStackParamList } from '../navigation/types';
import type { Role } from '../types';

// Reached from the profile menu's "Getting started" item (ProfileMenu.tsx),
// matching the web's OnboardingIntro content (client/src/components/
// OnboardingIntro.tsx) — same feature list, same admin-only filtering. Web
// reopens that same intro INLINE on the Coach welcome screen rather than
// navigating anywhere (`reopenIntro(); navigate('/')`); mobile instead
// pushes this as its own screen, since that route already existed in the
// navigator (AppNavigator.tsx) before this content was ported — the content
// is what changed here, not the navigation shape.
const ADMIN_ROLES: Role[] = ['school_admin', 'resource_person', 'super_admin'];

type Props = NativeStackScreenProps<AppStackParamList, 'GettingStarted'>;

export function GettingStartedScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const features = ONBOARDING_FEATURES.filter((f) => isAdmin || !f.adminOnly);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <ThemedText variant="muted" style={styles.eyebrow}>Getting started</ThemedText>
      <ThemedText variant="title" style={styles.title}>Here&rsquo;s what you can do</ThemedText>

      <View style={styles.grid}>
        {features.map((feature) => (
          <View key={feature.title} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.iconWell, { backgroundColor: colors.orangeSoft }]}>
              <feature.icon size={18} color={colors.orange} strokeWidth={2} />
            </View>
            <View style={styles.cardText}>
              <ThemedText style={styles.cardTitle}>{feature.title}</ThemedText>
              <ThemedText variant="muted" style={styles.cardDesc}>{feature.description}</ThemedText>
            </View>
          </View>
        ))}
      </View>

      <Button
        title="Got it — let's start"
        onPress={() => { if (navigation.canGoBack()) navigation.goBack(); }}
        testID="getting-started-cta"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 20, marginBottom: spacing.sm },
  grid: { gap: spacing.sm, marginBottom: spacing.md },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md,
  },
  iconWell: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontWeight: '600', fontSize: 15 },
  cardDesc: { fontSize: 12, lineHeight: 16 },
});
