// Native login/register screen (docs/mobile-app-plan.md §26 Phase 3).
// Ports LoginPage.tsx's flow logic (mode/view state machine, outcome
// handling, the two-step school-picker retry) — not its JSX, which is
// desktop-split-panel layout that doesn't translate to a phone screen.
import React, { useCallback, useState } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { GOOGLE_SIGN_IN_AVAILABLE, useGoogleIdToken } from '../../auth/useGoogleIdToken';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import type { AuthOutcome, SchoolOption } from '../../types';

type Mode = 'login' | 'register';
type ViewState = 'form' | 'pending' | 'rejected' | 'school_picker';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Remembers what to re-submit once a school has been picked — sign-in needs
// the credentials again because the first attempt intentionally issued no
// session (matching LoginPage.tsx's own Attempt type).
type Attempt = { via: 'password'; email: string; password: string } | { via: 'google'; idToken: string };

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function AuthScreen({ navigation }: Props) {
  const { login, register, loginWithGoogle } = useAuth();
  const { colors } = useTheme();

  const [mode, setMode] = useState<Mode>('login');
  const [view, setView] = useState<ViewState>('form');
  const [schoolCode, setSchoolCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [schoolChoices, setSchoolChoices] = useState<SchoolOption[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean; schoolCode?: boolean }>({});

  function touch(field: keyof typeof touched) {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }
  const emailError =
    touched.email && email.length > 0 && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : '';
  const passwordError =
    touched.password && password.length > 0 && password.length < 8
      ? 'Password must be at least 8 characters.'
      : '';
  const schoolCodeError =
    touched.schoolCode && /\s/.test(schoolCode) ? 'School code should not contain spaces.' : '';

  function switchMode(next: Mode) {
    setMode(next);
    setView('form');
    setError('');
    setTouched({});
  }

  function backToForm() {
    setView('form');
    setError('');
    setAttempt(null);
    setSchoolChoices([]);
  }

  function describeError(err: unknown) {
    return err instanceof ApiError ? err.message : 'Network error. Please check your connection.';
  }

  // Every auth call funnels through here so the non-success outcomes are
  // handled identically however they were reached — password or Google,
  // first attempt or after picking a school.
  function applyOutcome(outcome: AuthOutcome, retry: Attempt | null) {
    if (outcome.kind === 'signed_in') return; // RootNavigator swaps this screen out once `user` is set.
    if (outcome.kind === 'pending') return setView('pending');
    if (outcome.kind === 'rejected') return setView('rejected');
    if (outcome.kind === 'needs_school') {
      setSchoolChoices(outcome.schools);
      setAttempt(retry);
      setView('school_picker');
      return;
    }
    if (outcome.kind === 'not_registered') {
      setError('No account here uses that Google address yet. Switch to Register and enter your school code to sign up.');
      return;
    }
    if (outcome.kind === 'unavailable') {
      setError('Google sign-in is not set up on this server yet. Please use your email and password.');
    }
  }

  async function handleSubmit() {
    setError('');
    setTouched({ schoolCode: true, email: true, password: true });

    if (!EMAIL_RE.test(email.trim())) return;
    if (password.length < 8) return;
    if (mode === 'register' && /\s/.test(schoolCode)) return;

    setBusy(true);
    try {
      if (mode === 'login') {
        const credentials = { email: email.trim(), password };
        applyOutcome(await login(credentials), { via: 'password', ...credentials });
      } else {
        applyOutcome(
          await register({ schoolCode: schoolCode.trim(), name: name.trim(), email: email.trim(), password }),
          null
        );
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function chooseSchool(school: SchoolOption) {
    if (!attempt) return;
    setError('');
    setBusy(true);
    try {
      const outcome =
        attempt.via === 'password'
          ? await login({ email: attempt.email, password: attempt.password, schoolId: school.id })
          : await loginWithGoogle(attempt.idToken, { schoolId: school.id });
      applyOutcome(outcome, attempt);
    } catch (err) {
      setError(describeError(err));
      setView('form');
    } finally {
      setBusy(false);
    }
  }

  const handleGoogleToken = useCallback(
    async (idToken: string) => {
      setError('');
      if (mode === 'register' && !schoolCode.trim()) {
        setError('Enter your school code first, then continue with Google.');
        return;
      }
      setBusy(true);
      try {
        const options = mode === 'register' ? { schoolCode: schoolCode.trim(), name: name.trim() || undefined } : undefined;
        applyOutcome(await loginWithGoogle(idToken, options), { via: 'google', idToken });
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
    },
    [mode, schoolCode, name, loginWithGoogle]
  );
  const handleGoogleError = useCallback((message: string) => setError(message), []);
  const { request: googleRequest, promptAsync: promptGoogle } = useGoogleIdToken(handleGoogleToken, handleGoogleError);
  const googleBlocked = mode === 'register' && !schoolCode.trim();

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brand}>
          <ThemedText style={styles.brandEmoji}>👨‍🏫</ThemedText>
          <ThemedText variant="title" style={styles.brandTitle}>
            शिक्षक सहायक
          </ThemedText>
          <ThemedText variant="muted">
            {view === 'pending'
              ? 'Almost there — your account needs approval.'
              : view === 'rejected'
                ? 'This account was not approved.'
                : view === 'school_picker'
                  ? 'You have an account at more than one school.'
                  : mode === 'login'
                    ? 'Welcome back — sign in to continue.'
                    : 'Create your teacher account.'}
          </ThemedText>
        </View>

        {view === 'pending' && (
          <Card style={styles.gap}>
            <ThemedText accessibilityRole="alert">
              Your registration has been received. A school administrator needs to approve it before you can sign
              in — you&apos;ll be able to log in with your email and password once they do.
            </ThemedText>
            <Button title="Back to sign in" onPress={() => switchMode('login')} />
          </Card>
        )}

        {view === 'rejected' && (
          <Card style={styles.gap}>
            <ThemedText accessibilityRole="alert">
              A school administrator did not approve this account. Please check with your school administrator if
              you think this is a mistake.
            </ThemedText>
            <Button title="Back to sign in" onPress={() => switchMode('login')} />
          </Card>
        )}

        {view === 'school_picker' && (
          <Card style={styles.gap}>
            <ThemedText>Which school are you signing in to?</ThemedText>
            {schoolChoices.map((school) => (
              <Button
                key={school.id}
                title={`${school.name} (${school.code})`}
                onPress={() => chooseSchool(school)}
                disabled={busy}
              />
            ))}
            {error ? <ErrorBanner message={error} /> : null}
            <Button title="Back" variant="text" onPress={backToForm} disabled={busy} />
          </Card>
        )}

        {view === 'form' && (
          <>
            <View style={[styles.tabs, { borderColor: colors.border }]}>
              <TabButton label="Sign in" active={mode === 'login'} onPress={() => switchMode('login')} />
              <TabButton label="Register" active={mode === 'register'} onPress={() => switchMode('register')} />
            </View>

            <View style={styles.gap}>
              {mode === 'register' && (
                <>
                  <TextField
                    label="School code"
                    value={schoolCode}
                    onChangeText={setSchoolCode}
                    onBlur={() => touch('schoolCode')}
                    placeholder="e.g. RAMPUR01"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    error={schoolCodeError}
                    help={schoolCodeError ? undefined : 'Provided by your school administrator.'}
                  />
                  <TextField label="Your name" value={name} onChangeText={setName} placeholder="Full name" autoComplete="name" />
                </>
              )}

              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                onBlur={() => touch('email')}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                error={emailError}
              />

              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                onBlur={() => touch('password')}
                placeholder={mode === 'login' ? 'Your password' : 'At least 8 characters'}
                autoCapitalize="none"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                isPassword
                error={passwordError}
                help={passwordError || mode === 'login' ? undefined : 'At least 8 characters.'}
              />

              {error ? <ErrorBanner message={error} /> : null}

              <Button
                title={mode === 'login' ? 'Sign in' : 'Create account'}
                onPress={handleSubmit}
                loading={busy}
                disabled={busy}
                testID="authSubmitButton"
              />

              {GOOGLE_SIGN_IN_AVAILABLE && (
                <>
                  <View style={styles.dividerRow}>
                    <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                    <ThemedText variant="muted" style={styles.dividerText}>
                      or
                    </ThemedText>
                    <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                  </View>
                  <Button
                    title={mode === 'login' ? 'Continue with Google' : 'Sign up with Google'}
                    variant="secondary"
                    disabled={!googleRequest || busy}
                    onPress={() =>
                      googleBlocked
                        ? setError('Enter your school code first, then continue with Google.')
                        : promptGoogle()
                    }
                  />
                  {googleBlocked && (
                    <ThemedText variant="muted" style={styles.hint}>
                      Enter your school code above before continuing with Google.
                    </ThemedText>
                  )}
                </>
              )}

              <View style={styles.footerLinks}>
                {mode === 'login' ? (
                  <>
                    <Pressable onPress={() => navigation.navigate('ForgotPassword')} hitSlop={8}>
                      <ThemedText style={{ color: colors.orange }}>Forgot your password?</ThemedText>
                    </Pressable>
                    <ThemedText variant="muted">
                      First time here?{' '}
                      <ThemedText onPress={() => switchMode('register')} style={{ color: colors.orange }}>
                        Create an account
                      </ThemedText>{' '}
                      with your school code.
                    </ThemedText>
                  </>
                ) : (
                  <ThemedText variant="muted">
                    Already registered?{' '}
                    <ThemedText onPress={() => switchMode('login')} style={{ color: colors.orange }}>
                      Sign in instead
                    </ThemedText>
                    .
                  </ThemedText>
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && { backgroundColor: colors.surface }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <ThemedText style={active ? { fontWeight: '700', color: colors.orange } : { color: colors.textMuted }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner} accessibilityRole="alert">
      <ThemedText style={styles.errorText}>{message}</ThemedText>
    </View>
  );
}

export function AuthLoadingScreen() {
  const { colors } = useTheme();
  return (
    <View style={[styles.flex, styles.center, { backgroundColor: colors.bg }]}>
      <ActivityIndicator color={colors.orange} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
  brand: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  brandEmoji: { fontSize: 40 },
  brandTitle: { fontSize: 24 },
  gap: { gap: spacing.md },
  tabs: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 4, marginBottom: spacing.lg },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 12 },
  hint: { fontSize: 12, textAlign: 'center' },
  footerLinks: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  errorBanner: { backgroundColor: 'rgba(229,72,77,0.12)', borderRadius: 10, padding: spacing.sm },
  errorText: { color: '#e5484d' },
});
