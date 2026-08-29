// Mobile port of client/src/components/HelpSupport.tsx — same menu ->
// bug/feedback/contact/contact-message -> success flow, same categories,
// same POST /support/tickets contract (api/support.ts). Web mounts this as
// a globally-available overlay (HelpSupportProvider); mobile instead pushes
// it as its own screen (AppNavigator.tsx already had this route registered
// before this content was ported — the content is what changed, not the
// navigation shape, same reasoning as GettingStartedScreen.tsx). The
// menu<->sub-view navigation web does with onBack/onClose is done here with
// local `view` state (multi-step-within-one-screen, not real screens) plus
// a custom header back arrow that steps back one view at a time; the native
// back gesture/button always leaves the screen entirely, standard for this
// app's other pushed screens.
import React, { useLayoutEffect, useState } from 'react';
import { View, Pressable, ScrollView, Linking, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Bug, MessageCircle, Lightbulb, Send, ArrowLeft } from 'lucide-react-native';
import { ThemedText } from '../components/ThemedText';
import { TextField } from '../components/TextField';
import { Button } from '../components/Button';
import { OptionList } from '../components/OptionList';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { spacing, radius } from '../theme/tokens';
import { ApiError } from '../api/client';
import { createSupportTicket, captureAutoContext } from '../api/support';
import { BUG_CATEGORIES, FEEDBACK_CATEGORIES, MAX_SUPPORT_DESCRIPTION_LENGTH, SUPPORT_WHATSAPP_NUMBER } from '../config';
import type { AppStackParamList } from '../navigation/types';

type HelpView = 'menu' | 'bug' | 'feedback' | 'contact' | 'contact-message' | 'success';
interface SuccessInfo { type: 'bug' | 'feedback'; id?: string }

type Props = NativeStackScreenProps<AppStackParamList, 'HelpSupport'>;

const TITLES: Record<HelpView, string> = {
  menu: 'Need Help?',
  bug: 'Report a Bug',
  feedback: 'Send Feedback',
  contact: 'Contact Support',
  'contact-message': 'Send a Message',
  success: 'Done',
};

export function HelpSupportScreen({ navigation }: Props) {
  const { colors, mode } = useTheme();
  const { user } = useAuth();
  const theme = mode === 'dark' ? 'dark' : 'light';
  const [view, setView] = useState<HelpView>('menu');
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  // The step this view's back arrow returns to — contact-message came from
  // 'contact' only when WhatsApp is offered there too (see ContactView);
  // otherwise it was opened directly from the menu.
  const backTarget: HelpView | null =
    view === 'menu' || view === 'success' ? null
      : view === 'contact-message' && !SUPPORT_WHATSAPP_NUMBER ? 'menu'
      : view === 'contact-message' ? 'contact'
      : 'menu';

  useLayoutEffect(() => {
    navigation.setOptions({
      title: view === 'success' ? (success?.type === 'bug' ? 'Report sent' : 'Thank you') : TITLES[view],
      headerLeft: backTarget
        ? () => (
          <Pressable onPress={() => setView(backTarget)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeft size={20} color={colors.text} />
          </Pressable>
        )
        : undefined,
    });
  }, [navigation, view, success, backTarget, colors.text]);

  function handleSuccess(info: SuccessInfo) {
    setSuccess(info);
    setView('success');
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {view === 'menu' && <MenuView onPick={setView} />}
      {view === 'bug' && (
        <BugView
          onSuccess={(id) => handleSuccess({ type: 'bug', id })}
          language={user?.preferences.defaultLanguage}
          theme={theme}
        />
      )}
      {view === 'feedback' && (
        <FeedbackView
          onSuccess={() => handleSuccess({ type: 'feedback' })}
          language={user?.preferences.defaultLanguage}
          theme={theme}
        />
      )}
      {view === 'contact' && <ContactView onMessageInstead={() => setView('contact-message')} userInfo={user} />}
      {view === 'contact-message' && (
        <ContactMessageView
          onSuccess={() => handleSuccess({ type: 'feedback' })}
          language={user?.preferences.defaultLanguage}
          theme={theme}
        />
      )}
      {view === 'success' && success && <SuccessView info={success} onDone={() => navigation.goBack()} />}
    </ScrollView>
  );
}

// ---- Menu -------------------------------------------------------------------

function MenuView({ onPick }: { onPick: (v: HelpView) => void }) {
  return (
    <View style={styles.section}>
      <ThemedText variant="muted">Report a bug, reach us directly, or share feedback.</ThemedText>
      <View style={styles.options}>
        <OptionRow icon={Bug} title="Report a Bug" desc="Something broke or didn't work as expected" onPress={() => onPick('bug')} />
        <OptionRow icon={MessageCircle} title="Contact Support" desc="Message us directly" onPress={() => onPick('contact')} />
        <OptionRow icon={Lightbulb} title="Send Feedback" desc="Suggest an improvement or tell us what you think" onPress={() => onPick('feedback')} />
      </View>
    </View>
  );
}

function OptionRow({ icon: Icon, title, desc, onPress }: { icon: typeof Bug; title: string; desc: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.optionRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="button"
    >
      <View style={[styles.optionIcon, { backgroundColor: colors.orangeSoft }]}>
        <Icon size={18} color={colors.orange} />
      </View>
      <View style={styles.optionText}>
        <ThemedText style={styles.optionTitle}>{title}</ThemedText>
        <ThemedText variant="muted" style={styles.optionDesc}>{desc}</ThemedText>
      </View>
    </Pressable>
  );
}

// ---- Report a Bug -----------------------------------------------------------

function BugView({ onSuccess, language, theme }: { onSuccess: (id: string) => void; language?: string; theme: 'light' | 'dark' }) {
  const { colors } = useTheme();
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!category || description.trim().length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const ticket = await createSupportTicket({
        type: 'bug',
        category,
        description: description.trim(),
        context: captureAutoContext(theme, language),
      });
      onSuccess(ticket.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.section}>
      <OptionList label="What went wrong?" options={BUG_CATEGORIES} value={category} onChange={setCategory} />
      <TextField
        label="Describe what happened"
        value={description}
        onChangeText={(t) => setDescription(t.slice(0, MAX_SUPPORT_DESCRIPTION_LENGTH))}
        placeholder="What were you doing, and what happened instead?"
        multiline
        numberOfLines={4}
        help={`${description.length} / ${MAX_SUPPORT_DESCRIPTION_LENGTH}`}
      />
      {!!error && <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>}
      <Button
        title="Send report"
        onPress={handleSubmit}
        loading={submitting}
        disabled={submitting || !category || description.trim().length === 0}
      />
    </View>
  );
}

// ---- Send Feedback -----------------------------------------------------------

function FeedbackView({ onSuccess, language, theme }: { onSuccess: () => void; language?: string; theme: 'light' | 'dark' }) {
  const { colors } = useTheme();
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!category) return;
    setSubmitting(true);
    setError('');
    try {
      await createSupportTicket({
        type: 'feedback',
        category,
        description: message.trim(),
        context: captureAutoContext(theme, language),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.section}>
      <OptionList label="What kind of feedback?" options={FEEDBACK_CATEGORIES} value={category} onChange={setCategory} />
      <TextField
        label="Anything you'd like to add? (optional)"
        value={message}
        onChangeText={(t) => setMessage(t.slice(0, MAX_SUPPORT_DESCRIPTION_LENGTH))}
        multiline
        numberOfLines={3}
      />
      {!!error && <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>}
      <Button title="Send feedback" onPress={handleSubmit} loading={submitting} disabled={submitting || !category} />
    </View>
  );
}

// ---- Contact Support ---------------------------------------------------------

function ContactView({
  onMessageInstead, userInfo,
}: {
  onMessageInstead: () => void;
  userInfo: ReturnType<typeof useAuth>['user'];
}) {
  const hasWhatsApp = !!SUPPORT_WHATSAPP_NUMBER;

  function openWhatsApp() {
    const who = userInfo ? `${userInfo.displayName || userInfo.name} (${userInfo.school.name})` : 'a teacher';
    const text = `Hi, I'm ${who} using Teacher Assistant and I need some help.`;
    void Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`);
  }

  return (
    <View style={styles.section}>
      <View style={styles.options}>
        {hasWhatsApp && (
          <OptionRow icon={MessageCircle} title="Message us on WhatsApp" desc="Usually the fastest way to reach us" onPress={openWhatsApp} />
        )}
        <OptionRow
          icon={Send}
          title={hasWhatsApp ? 'Send a message instead' : 'Send us a message'}
          desc="We'll get back to you as soon as we can"
          onPress={onMessageInstead}
        />
      </View>
    </View>
  );
}

function ContactMessageView({ onSuccess, language, theme }: { onSuccess: () => void; language?: string; theme: 'light' | 'dark' }) {
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (message.trim().length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      // No dedicated "contact" ticket type — a direct message is stored the
      // same way general feedback is (mirrors the web's ContactMessageView).
      await createSupportTicket({
        type: 'feedback',
        category: 'other',
        description: message.trim(),
        context: captureAutoContext(theme, language),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.section}>
      <TextField
        label="What's on your mind?"
        value={message}
        onChangeText={(t) => setMessage(t.slice(0, MAX_SUPPORT_DESCRIPTION_LENGTH))}
        placeholder="Tell us what you need help with"
        multiline
        numberOfLines={4}
        autoFocus
      />
      {!!error && <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>}
      <Button title="Send message" onPress={handleSubmit} loading={submitting} disabled={submitting || message.trim().length === 0} />
    </View>
  );
}

// ---- Success -----------------------------------------------------------------

function SuccessView({ info, onDone }: { info: SuccessInfo; onDone: () => void }) {
  return (
    <View style={styles.section}>
      {info.type === 'bug' ? (
        <>
          <ThemedText>Thanks — we&rsquo;ve got it and will look into this.</ThemedText>
          {!!info.id && <ThemedText variant="muted">Reference: #{info.id.slice(-8)}</ThemedText>}
        </>
      ) : (
        <ThemedText>Thanks for letting us know!</ThemedText>
      )}
      <Button title="Done" onPress={onDone} testID="help-success-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg },
  section: { gap: spacing.md },
  options: { gap: spacing.sm },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, minHeight: 64,
  },
  optionIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontWeight: '600', fontSize: 15 },
  optionDesc: { fontSize: 12, lineHeight: 16 },
});
