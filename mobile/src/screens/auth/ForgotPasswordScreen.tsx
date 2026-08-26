// docs/mobile-app-plan.md §16: password reset stays a web-only flow for V1
// — the email link opens the web app's /reset-password/<token> page, and the
// teacher signs back into mobile with the new password once it's changed.
// This screen only covers the "request a reset email" half.
import React, { useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const { forgotPassword } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit() {
    setError('');
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      // forgot-password is deliberately byte-identical whether or not the
      // address exists server-side (no user enumeration) — the only errors
      // that can reach here are malformed input (already caught above) or a
      // genuine network/server failure.
      setError(err instanceof ApiError ? err.message : 'Network error. Please check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Card style={styles.gap}>
          <ThemedText variant="title">Reset your password</ThemedText>
          {sent ? (
            <>
              <ThemedText accessibilityRole="alert">
                If an account exists for that email, a reset link has been sent. Open it on your phone or computer
                to set a new password, then come back here to sign in.
              </ThemedText>
              <Button title="Back to sign in" onPress={() => navigation.goBack()} />
            </>
          ) : (
            <>
              <ThemedText variant="muted">
                Enter your account email and we&apos;ll send a link to reset your password.
              </ThemedText>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />
              {error ? (
                <View style={[styles.errorBanner, { backgroundColor: colors.semantic.danger.bg }]} accessibilityRole="alert">
                  <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
                </View>
              ) : null}
              <Button title="Send reset link" onPress={submit} loading={busy} disabled={busy} />
              <Button title="Back to sign in" variant="text" onPress={() => navigation.goBack()} disabled={busy} />
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center' },
  gap: { gap: spacing.md },
  errorBanner: { borderRadius: 10, padding: spacing.sm },
});
