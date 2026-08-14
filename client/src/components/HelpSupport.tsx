import {
  createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode,
} from 'react';
import { Bug, MessageCircle, Lightbulb, Send, X, ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '../auth';
import { useToast } from './Toast';
import { ApiError } from '../api';
import { createSupportTicket, captureAutoContext } from '../lib/support';
import { BUG_CATEGORIES, FEEDBACK_CATEGORIES, MAX_SUPPORT_DESCRIPTION_LENGTH, SUPPORT_WHATSAPP_NUMBER } from '../config';

// Help & Support — one globally-mounted panel (same "provider owns its own
// overlay" shape as ToastProvider) rather than a component instantiated at
// each entry point. ProfileMenu (used by both TopBar and the Coach page's
// Sidebar) and the Settings card both just call useHelpSupport().openMenu();
// error surfaces (network-error toast, the top-level ErrorBoundary) call
// openBugReport() with a category pre-selected. Reuses the app's existing
// form controls (.style-grid /
// .style-option, .text-input, .btn-primary) rather than inventing new ones.
//
// Phase 1 only (see docs/help-support-architecture.md): no attachment, no
// AI-conversation opt-in, no admin inbox. Contact Support creates no ticket
// at all for the WhatsApp path — only its in-app fallback does, filed as
// `type: 'feedback', category: 'other'` (there is no separate ticket type for
// it — see the architecture discussion on why this app has exactly two:
// bug | feedback).

type View = 'menu' | 'bug' | 'feedback' | 'contact' | 'contact-message' | 'success';

interface BugReportPrefill {
  category?: string;
}

interface HelpSupportContextValue {
  openMenu: () => void;
  openBugReport: (prefill?: BugReportPrefill) => void;
}

const HelpSupportContext = createContext<HelpSupportContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useHelpSupport() {
  const ctx = useContext(HelpSupportContext);
  if (!ctx) throw new Error('useHelpSupport must be used within HelpSupportProvider');
  return ctx;
}

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

interface SuccessInfo {
  type: 'bug' | 'feedback';
  id?: string;
}

export function HelpSupportProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [bugPrefill, setBugPrefill] = useState<BugReportPrefill>({});
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  const openMenu = useCallback(() => {
    setBugPrefill({});
    setView('menu');
    setOpen(true);
  }, []);

  const openBugReport = useCallback((prefill: BugReportPrefill = {}) => {
    setBugPrefill(prefill);
    setView('bug');
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ openMenu, openBugReport }), [openMenu, openBugReport]);

  function handleSuccess(info: SuccessInfo) {
    setSuccess(info);
    setView('success');
  }

  function handleError(err: unknown, fallback: string) {
    show(err instanceof ApiError ? err.message : fallback, 'error');
  }

  return (
    <HelpSupportContext.Provider value={value}>
      {children}
      <div className={`help-overlay${open ? ' show' : ''}`} onClick={close} aria-hidden={!open}>
        <div className="help-sheet" role="dialog" aria-modal="true" aria-label="Help &amp; Support" onClick={(e) => e.stopPropagation()}>
          {view === 'menu' && <MenuView onClose={close} onPick={setView} />}
          {view === 'bug' && (
            <BugView
              prefillCategory={bugPrefill.category}
              onBack={() => setView('menu')}
              onClose={close}
              onSuccess={(id) => handleSuccess({ type: 'bug', id })}
              onError={handleError}
              userInfo={user}
            />
          )}
          {view === 'feedback' && (
            <FeedbackView
              onBack={() => setView('menu')}
              onClose={close}
              onSuccess={() => handleSuccess({ type: 'feedback' })}
              onError={handleError}
              userInfo={user}
            />
          )}
          {view === 'contact' && (
            <ContactView
              onBack={() => setView('menu')}
              onClose={close}
              onMessageInstead={() => setView('contact-message')}
              userInfo={user}
            />
          )}
          {view === 'contact-message' && (
            <ContactMessageView
              onBack={() => setView(SUPPORT_WHATSAPP_NUMBER ? 'contact' : 'menu')}
              onClose={close}
              onSuccess={() => handleSuccess({ type: 'feedback' })}
              onError={handleError}
              userInfo={user}
            />
          )}
          {view === 'success' && success && <SuccessView info={success} onClose={close} />}
        </div>
      </div>
    </HelpSupportContext.Provider>
  );
}

// ---- Shared bits ------------------------------------------------------------

function PanelHeader({ title, onBack, onClose }: { title: string; onBack?: () => void; onClose: () => void }) {
  return (
    <div className="help-head">
      {onBack ? (
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
      ) : (
        <span className="help-head-spacer" aria-hidden="true" />
      )}
      <h2 className="help-title">{title}</h2>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

type UserInfo = ReturnType<typeof useAuth>['user'];

// ---- Menu -------------------------------------------------------------------

function MenuView({ onClose, onPick }: { onClose: () => void; onPick: (v: View) => void }) {
  return (
    <>
      <PanelHeader title="Need Help?" onClose={onClose} />
      <p className="help-subtitle">Report a bug, reach us directly, or share feedback.</p>
      <div className="help-options">
        <button type="button" className="help-option" onClick={() => onPick('bug')}>
          <span className="help-option-icon"><Bug size={18} aria-hidden="true" /></span>
          <span className="help-option-text">
            <span className="help-option-title">Report a Bug</span>
            <span className="help-option-desc">Something broke or didn&rsquo;t work as expected</span>
          </span>
        </button>
        <button type="button" className="help-option" onClick={() => onPick('contact')}>
          <span className="help-option-icon"><MessageCircle size={18} aria-hidden="true" /></span>
          <span className="help-option-text">
            <span className="help-option-title">Contact Support</span>
            <span className="help-option-desc">Message us directly</span>
          </span>
        </button>
        <button type="button" className="help-option" onClick={() => onPick('feedback')}>
          <span className="help-option-icon"><Lightbulb size={18} aria-hidden="true" /></span>
          <span className="help-option-text">
            <span className="help-option-title">Send Feedback</span>
            <span className="help-option-desc">Suggest an improvement or tell us what you think</span>
          </span>
        </button>
      </div>
    </>
  );
}

// ---- Report a Bug -----------------------------------------------------------

function BugView({
  prefillCategory, onBack, onClose, onSuccess, onError, userInfo,
}: {
  prefillCategory?: string;
  onBack: () => void;
  onClose: () => void;
  onSuccess: (id: string) => void;
  onError: (err: unknown, fallback: string) => void;
  userInfo: UserInfo;
}) {
  const [category, setCategory] = useState(prefillCategory ?? '');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!category || description.trim().length === 0) return;
    setSubmitting(true);
    try {
      const ticket = await createSupportTicket({
        type: 'bug',
        category,
        description: description.trim(),
        context: captureAutoContext(currentTheme(), userInfo?.preferences.defaultLanguage),
      });
      onSuccess(ticket.id);
    } catch (err) {
      onError(err, 'Could not send your report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PanelHeader title="Report a Bug" onBack={onBack} onClose={onClose} />
      <form onSubmit={handleSubmit}>
        <label className="field-label">What went wrong?</label>
        <div className="style-grid" role="radiogroup" aria-label="Bug category">
          {BUG_CATEGORIES.map((c) => (
            <button
              type="button"
              key={c.value}
              className={`style-option${category === c.value ? ' selected' : ''}`}
              onClick={() => setCategory(c.value)}
              aria-pressed={category === c.value}
            >
              <span className="style-label">{c.label}</span>
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="bug-description">Describe what happened</label>
        <textarea
          id="bug-description"
          className="text-input"
          rows={4}
          maxLength={MAX_SUPPORT_DESCRIPTION_LENGTH}
          placeholder="What were you doing, and what happened instead?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="help-char-count">{description.length} / {MAX_SUPPORT_DESCRIPTION_LENGTH}</p>

        <button className="btn-primary help-submit" type="submit" disabled={submitting || !category || description.trim().length === 0}>
          {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : 'Send report'}
        </button>
      </form>
    </>
  );
}

// ---- Send Feedback -----------------------------------------------------------

function FeedbackView({
  onBack, onClose, onSuccess, onError, userInfo,
}: {
  onBack: () => void;
  onClose: () => void;
  onSuccess: () => void;
  onError: (err: unknown, fallback: string) => void;
  userInfo: UserInfo;
}) {
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!category) return;
    setSubmitting(true);
    try {
      await createSupportTicket({
        type: 'feedback',
        category,
        description: message.trim(),
        context: captureAutoContext(currentTheme(), userInfo?.preferences.defaultLanguage),
      });
      onSuccess();
    } catch (err) {
      onError(err, 'Could not send your feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PanelHeader title="Send Feedback" onBack={onBack} onClose={onClose} />
      <form onSubmit={handleSubmit}>
        <label className="field-label">What kind of feedback?</label>
        <div className="style-grid" role="radiogroup" aria-label="Feedback type">
          {FEEDBACK_CATEGORIES.map((c) => (
            <button
              type="button"
              key={c.value}
              className={`style-option${category === c.value ? ' selected' : ''}`}
              onClick={() => setCategory(c.value)}
              aria-pressed={category === c.value}
            >
              <span className="style-label">{c.label}</span>
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="feedback-message">Anything you&rsquo;d like to add? (optional)</label>
        <textarea
          id="feedback-message"
          className="text-input"
          rows={3}
          maxLength={MAX_SUPPORT_DESCRIPTION_LENGTH}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <button className="btn-primary help-submit" type="submit" disabled={submitting || !category}>
          {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : 'Send feedback'}
        </button>
      </form>
    </>
  );
}

// ---- Contact Support ---------------------------------------------------------

function ContactView({
  onBack, onClose, onMessageInstead, userInfo,
}: {
  onBack: () => void;
  onClose: () => void;
  onMessageInstead: () => void;
  userInfo: UserInfo;
}) {
  const hasWhatsApp = Boolean(SUPPORT_WHATSAPP_NUMBER);

  function openWhatsApp() {
    const who = userInfo ? `${userInfo.displayName || userInfo.name} (${userInfo.school.name})` : 'a teacher';
    const text = `Hi, I'm ${who} using Teacher Assistant and I need some help.`;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    onClose();
  }

  return (
    <>
      <PanelHeader title="Contact Support" onBack={onBack} onClose={onClose} />
      <div className="help-options">
        {hasWhatsApp && (
          <button type="button" className="help-option" onClick={openWhatsApp}>
            <span className="help-option-icon"><MessageCircle size={18} aria-hidden="true" /></span>
            <span className="help-option-text">
              <span className="help-option-title">Message us on WhatsApp</span>
              <span className="help-option-desc">Usually the fastest way to reach us</span>
            </span>
          </button>
        )}
        <button type="button" className="help-option" onClick={onMessageInstead}>
          <span className="help-option-icon"><Send size={18} aria-hidden="true" /></span>
          <span className="help-option-text">
            <span className="help-option-title">{hasWhatsApp ? 'Send a message instead' : 'Send us a message'}</span>
            <span className="help-option-desc">We&rsquo;ll get back to you as soon as we can</span>
          </span>
        </button>
      </div>
    </>
  );
}

function ContactMessageView({
  onBack, onClose, onSuccess, onError, userInfo,
}: {
  onBack: () => void;
  onClose: () => void;
  onSuccess: () => void;
  onError: (err: unknown, fallback: string) => void;
  userInfo: UserInfo;
}) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (message.trim().length === 0) return;
    setSubmitting(true);
    try {
      // No dedicated "contact" ticket type — a direct message is stored the
      // same way general feedback is (see the architecture discussion on
      // why this app has exactly two ticket types, bug | feedback).
      await createSupportTicket({
        type: 'feedback',
        category: 'other',
        description: message.trim(),
        context: captureAutoContext(currentTheme(), userInfo?.preferences.defaultLanguage),
      });
      onSuccess();
    } catch (err) {
      onError(err, 'Could not send your message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PanelHeader title="Send a Message" onBack={onBack} onClose={onClose} />
      <form onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="contact-message">What&rsquo;s on your mind?</label>
        <textarea
          id="contact-message"
          className="text-input"
          rows={4}
          maxLength={MAX_SUPPORT_DESCRIPTION_LENGTH}
          placeholder="Tell us what you need help with"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button className="btn-primary help-submit" type="submit" disabled={submitting || message.trim().length === 0}>
          {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : 'Send message'}
        </button>
      </form>
    </>
  );
}

// ---- Success -----------------------------------------------------------------

function SuccessView({ info, onClose }: { info: SuccessInfo; onClose: () => void }) {
  return (
    <>
      <PanelHeader title={info.type === 'bug' ? 'Report sent' : 'Thank you'} onClose={onClose} />
      <div className="help-success">
        {info.type === 'bug' ? (
          <>
            <p>Thanks — we&rsquo;ve got it and will look into this.</p>
            {info.id && <p className="help-success-ref">Reference: #{info.id.slice(-8)}</p>}
          </>
        ) : (
          <p>Thanks for letting us know!</p>
        )}
        <button className="btn-primary help-submit" type="button" onClick={onClose}>Done</button>
      </div>
    </>
  );
}
