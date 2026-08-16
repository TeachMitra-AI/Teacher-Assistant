import type { LucideIcon } from 'lucide-react';
import {
  NotebookPen, Target, Lightbulb, ClipboardCheck,
  LayoutDashboard, ShieldCheck, FileText, LifeBuoy,
  MessageCircle, Library, PencilRuler, Sparkles,
  Megaphone, BookOpenCheck, ClipboardList, FileBarChart, Settings2, BellRing,
} from 'lucide-react';
import type { Role, ResponseStyle, ResourceType, NotificationType } from './types';

// Languages supported for AI responses (UI itself stays in English).
//
// SERVER COUNTERPART: server/src/actions/vocab/languages.js (LANGUAGE_CODES)
// holds the same `value` codes, where the AI Action Router canonicalizes an
// explicit request ("in Hindi", "हिंदी में") into one of them. Deliberate,
// documented duplication (CHANGE-11 — CommonJS server vs ESM client), pinned by
// server/test/actions/vocabDrift.test.js. CHANGE BOTH IN THE SAME COMMIT: a code
// here with no counterpart there is a language the router can never select, and
// one there with no counterpart here would be prefilled into a <select> that
// cannot show it.
export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिंदी' },
  { value: 'bn', label: 'বাংলা' },
  { value: 'te', label: 'తెలుగు' },
  { value: 'mr', label: 'मराठी' },
  { value: 'ta', label: 'தமிழ்' },
  { value: 'gu', label: 'ગુજરાતી' },
  { value: 'kn', label: 'ಕನ್ನಡ' },
  { value: 'or', label: 'ଓଡ଼ିଆ' },
  { value: 'hinglish', label: 'Hinglish' },
];

// Maps a response language to a BCP-47 code for speech synthesis.
export const SPEECH_LOCALE: Record<string, string> = {
  en: 'en-US',
  hi: 'hi-IN',
  bn: 'bn-IN',
  te: 'te-IN',
  mr: 'mr-IN',
  ta: 'ta-IN',
  gu: 'gu-IN',
  kn: 'kn-IN',
  or: 'or-IN',
  hinglish: 'hi-IN',
};

// SERVER COUNTERPART: server/src/actions/vocab/grades.js (GRADES) and
// server/src/actions/vocab/subjects.js (SUBJECTS) hold these same canonical
// lists, where the AI Action Router maps what a teacher typed ("class 5",
// "पाँचवीं", "maths") onto them. Deliberate, documented duplication (CHANGE-11 —
// CommonJS server vs ESM client), pinned by server/test/actions/vocabDrift.test.js.
//
// CHANGE BOTH IN THE SAME COMMIT, and note that this pair drifts SILENTLY: the
// router would prefill a band this datalist does not offer, which looks like a
// typo the teacher made rather than an error. Nothing would fail.
export const GRADES = ['Pre-Primary', 'Class 1-2', 'Class 3-5', 'Class 6-8', 'Class 9-10', 'Class 11-12'];
export const SUBJECTS = ['Mathematics', 'Science', 'English', 'Hindi', 'Social Studies', 'Languages', 'General'];
export const CLASSROOM_TYPES = ['Single Grade', 'Multi-Grade', 'Mixed Ability', 'Large Class (40+)', 'Small Class (<20)'];
export const ISSUE_TYPES = ['Classroom Management', 'Concept Explanation', 'Student Engagement', 'Assessment', 'Differentiation', 'Resource Constraints'];

// Welcome-screen quick actions — seed the composer with a starter prompt for
// the teacher to finish, rather than submitting immediately.
export interface QuickAction {
  icon: LucideIcon;
  label: string;
  description: string;
  prompt: string;
  // Presentation-only: hide this card on the mobile welcome view to keep the
  // above-the-fold list short. The action remains fully available on tablet/
  // desktop and its underlying functionality is unaffected.
  hideOnMobile?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { icon: NotebookPen, label: 'Create a Lesson Plan', description: 'Structured plans with objectives and activities', prompt: 'Create a lesson plan for ' },
  { icon: Target, label: 'Create Classroom Activity', description: 'Engaging, ready-to-run classroom activities', prompt: 'Suggest a classroom activity for ' },
  { icon: Lightbulb, label: 'Explain a Concept', description: 'Simple explanations pitched to your grade', prompt: 'Explain this concept simply: ' },
  { icon: ClipboardCheck, label: 'Create Assessment', description: 'Quizzes and worksheets to check learning', prompt: 'Create a short assessment for ', hideOnMobile: true },
];

// First-run onboarding feature intro (Phase 1). Purely informational — unlike
// QUICK_ACTIONS these neither seed a prompt nor navigate; they explain, once,
// what each area of the app is for on a teacher's first visit (see
// preferences.onboarding.seenWelcomeIntro for the shown-once gate). `adminOnly`
// items appear only for admin roles, mirroring the ADMIN_SHORTCUTS split, so a
// first-time admin also learns about the approval queue and dashboard. Adding a
// future feature here is a one-line append — the same extensibility QUICK_ACTIONS
// has — which is why onboarding copy lives in config, not hard-coded in the view.
export interface OnboardingFeature {
  icon: LucideIcon;
  title: string;
  description: string;
  adminOnly?: boolean;
}

export const ONBOARDING_FEATURES: OnboardingFeature[] = [
  { icon: MessageCircle, title: 'Coach', description: 'Ask any teaching question and get instant, classroom-ready guidance.' },
  { icon: Library, title: 'My Library', description: 'Save answers you find useful and reopen them anytime.' },
  { icon: ClipboardCheck, title: 'Generator', description: 'Build printable quizzes and worksheets with a ready answer key.' },
  { icon: PencilRuler, title: 'Workspace', description: 'Open a saved resource to edit, refine, or print it.' },
  { icon: Sparkles, title: 'AI Assist', description: 'In the Workspace, preview an AI edit, then apply and save it.' },
  { icon: ShieldCheck, title: 'Manage & Dashboard', description: 'Approve new teachers and track your school’s usage.', adminOnly: true },
];

// Admin-only shortcuts on the welcome screen. Unlike quick actions, these
// *navigate* to existing pages rather than seeding a prompt — they surface
// the dashboard/management areas without duplicating their functionality.
export interface AdminShortcut {
  icon: LucideIcon;
  label: string;
  description: string;
  to: string;
}

export const ADMIN_SHORTCUTS: AdminShortcut[] = [
  { icon: LayoutDashboard, label: 'Dashboard', description: 'Usage analytics and teaching insights', to: '/admin' },
  // HIDDEN FROM THE HOMEPAGE (2026-08-15) — see docs/hide-homepage-items.md.
  // Commented out rather than deleted so it can be restored: uncomment the
  // line below and the Manage card reappears. The Manage PAGE is untouched
  // and still reachable from the admin tabs (components/AdminTabs.tsx).
  // { icon: ShieldCheck, label: 'Manage', description: 'Schools, users, and roles', to: '/admin/manage' },
];

// A separate shortcut, not folded into ADMIN_SHORTCUTS above — that array is
// shown to every admin role, and Support is super_admin only (see
// AdminTabs.tsx). Kept as its own constant so WelcomeScreen can include it
// conditionally without widening the AdminShortcut list every other admin
// role already sees.
//
// CURRENTLY UNUSED (2026-08-15) — the Support Inbox card is hidden from the
// homepage, so nothing imports this today. Left fully intact rather than
// commented out: it is an `export`, so it costs no build error, and keeping
// it whole means restoring the card is a one-line change in
// WelcomeScreen.tsx. See docs/hide-homepage-items.md.
export const SUPER_ADMIN_SHORTCUT: AdminShortcut = {
  icon: LifeBuoy, label: 'Support Inbox', description: 'Bug reports and feedback from teachers', to: '/admin/support',
};

// The generic follow-up chip row that used to sit under every Coach answer
// ("Make it simpler", "Create a worksheet", "5-minute activity", "Translate
// to …") was removed — see docs/remove-coach-followup-chips.md. It cost
// vertical space on every response while rarely matching the question asked,
// and each of those actions already has a better home: the Quiz & Worksheet
// Generator (pages/GeneratorPage.tsx), the workspace's AI_ACTIONS
// (pages/ResourceWorkspace.tsx) and Classroom Mode (lib/classroom.ts).
// "View as visual" (LearningRepresentationPanel) is the one action still
// offered under an answer.

export const MAX_QUERY_LENGTH = 500;

// Attachments (Coach: image/PDF upload). Client-side checks only — a fast,
// friendly rejection before anything leaves the browser. The server
// re-validates independently by sniffing the file's actual bytes
// (server/src/lib/fileValidation.js) and never trusts these values, since a
// client-side check is a courtesy, not a security boundary.
//
// SERVER COUNTERPART: server/src/lib/fileValidation.js's ALLOWED_MIME_TYPES
// and ATTACHMENT_MAX_FILE_SIZE_MB hold the authoritative versions of these
// same two bounds. Keep them in step so a file the client accepts is not
// silently rejected by the server (or vice versa) — there is no drift guard
// for this pair (unlike LANGUAGES/GRADES/SUBJECTS above) because the server
// bound is an env-configurable default, not a fixed vocabulary; treat this
// value as "the common default," not a hard contract.
export const MAX_ATTACHMENT_SIZE_MB = 8;
export const ALLOWED_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// Batch bounds — mirrors server/src/lib/flags.js's ATTACHMENT_MAX_FILES /
// ATTACHMENT_MAX_TOTAL_SIZE_MB defaults. A single message may attach several
// files, all sent to Gemini together in one request (see
// docs/multimodal-attachments-architecture.md) — these two constants exist
// so the client can reject an over-large selection immediately rather than
// letting the teacher wait for a 400 after uploading everything.
export const MAX_ATTACHMENTS_COUNT = 5;
export const MAX_ATTACHMENTS_TOTAL_SIZE_MB = 15;
// How many attachment chips the tray shows before collapsing the rest behind
// "+N more" (see components/AttachmentTray.tsx). A UI constant, not a
// server-mirrored limit — purely about keeping the tray visually compact.
export const ATTACHMENT_TRAY_VISIBLE_COUNT = 3;
// The `accept` attribute on the file input — a UX hint for the OS file
// picker, not a validation mechanism (a picker can be overridden by the
// user, which is exactly why server-side sniffing is the real gate).
export const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';

// Saved-resource types shown across the library and the Save action. Order is
// the display order in filters and the type picker.
export const RESOURCE_TYPE_META: Record<ResourceType, { label: string; icon: LucideIcon }> = {
  lesson_plan: { label: 'Lesson Plan', icon: NotebookPen },
  classroom_activity: { label: 'Classroom Activity', icon: Target },
  assessment: { label: 'Assessment', icon: ClipboardCheck },
  explanation: { label: 'Explanation', icon: Lightbulb },
  general: { label: 'General Resource', icon: FileText },
};

export const RESOURCE_TYPES: ResourceType[] = [
  'lesson_plan',
  'classroom_activity',
  'assessment',
  'explanation',
  'general',
];

// --- Quiz / Worksheet Generator options ---
//
// These are the PICKER option lists (value + display label/hint). The values
// must stay in step with the server's closed vocabularies in
// server/src/actions/schemas/generateAssessment.js (FORMATS, DIFFICULTIES,
// QUESTION_TYPES, MIN_QUESTIONS/MAX_QUESTIONS), which is the single runtime
// authority: it validates every POST /api/resources/generate and, from
// milestone M2, is the same object the AI Action Router's capability descriptor
// references. Nothing here validates anything — offering an option the server
// rejects would surface as a 400 the teacher cannot act on.
//
// CHANGE THESE AND THE SERVER MODULE IN THE SAME COMMIT. A drift guard covering
// this pair is a mandatory acceptance criterion of M2 (see
// docs/AI_ACTION_ROUTER_README.md §11).
export const ASSESSMENT_FORMATS: { value: 'quiz' | 'worksheet' | 'exit_ticket' | 'homework'; label: string; hint: string }[] = [
  { value: 'quiz', label: 'Quiz', hint: 'Questions with a separate answer key' },
  { value: 'worksheet', label: 'Worksheet', hint: 'Printable sheet with name/date and teacher answer key' },
  // Added for Classroom Mode (docs/classroom-mode.md P4), but offered on the
  // Generator page too — a teacher who wants a quick end-of-lesson check should
  // not have to go through the chat to get one.
  { value: 'exit_ticket', label: 'Exit Ticket', hint: 'A 3-question check for the last minutes of a lesson' },
  // Added for Classroom Mode (docs/classroom-mode.md P5), offered here too for
  // the same reason as exit_ticket: setting homework is a routine task that
  // should not require going through the chat.
  { value: 'homework', label: 'Homework', hint: 'Practice to do at home, with a note for parents' },
];

export const DIFFICULTIES: { value: 'easy' | 'medium' | 'hard'; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export const QUESTION_TYPES: { value: 'mcq' | 'true_false' | 'short_answer' | 'mixed'; label: string }[] = [
  { value: 'mcq', label: 'Multiple Choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'mixed', label: 'Mixed' },
];

export const QUESTION_COUNT_MIN = 3;
export const QUESTION_COUNT_MAX = 30;
export const QUESTION_COUNT_DEFAULT = 10;

export const ROLE_LABELS: Record<Role, string> = {
  teacher: 'Teacher',
  school_admin: 'School Admin',
  resource_person: 'Resource Person',
  super_admin: 'Super Admin',
};

// Roles that can see the admin dashboard.
export const ADMIN_ROLES: Role[] = ['school_admin', 'resource_person', 'super_admin'];

// Preferred coaching response styles shown in Settings.
export const RESPONSE_STYLES: { value: ResponseStyle; label: string; hint: string }[] = [
  { value: 'balanced', label: 'Balanced', hint: 'Well-rounded advice (default)' },
  { value: 'concise', label: 'Concise', hint: 'Short and to the point' },
  { value: 'detailed', label: 'Detailed', hint: 'Thorough, in-depth explanations' },
  { value: 'step_by_step', label: 'Step by step', hint: 'Numbered, follow-along steps' },
  { value: 'practical', label: 'Practical', hint: 'Ready-to-use classroom actions' },
];

// Lightweight preset avatars (emoji) — no photo upload needed on low-end devices.
export const AVATAR_PRESETS = ['👩‍🏫', '👨‍🏫', '🧑‍🏫', '📚', '✏️', '🌟', '🍎', '🎓', '🧮', '🔬', '🎨', '🌈'];

// Custom profile pictures (server counterpart: server/src/routes/avatar.js).
// Types mirror that route's AVATAR_ALLOWED_MIME_TYPES exactly — this is a
// fast, friendly client-side check only; the server's magic-byte sniff is
// the real gate, same "courtesy vs. real gate" split as the Coach attachment
// feature (see lib/attachmentValidation.ts).
export const AVATAR_ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Matches the server's hardcoded cap in routes/avatar.js exactly — the
// client resizes before upload, so a legitimate photo is never anywhere near
// this raw limit; this exists to reject an obviously-wrong file quickly with
// a friendly message instead of waiting on a round trip to find out.
export const AVATAR_MAX_RAW_SIZE_MB = 5;
// Every avatar render site (TopBar, Settings preview) shows a square, so the
// client center-crops to a square and downsizes to this before upload —
// keeps stored bytes small and every rendered avatar visually consistent.
export const AVATAR_TARGET_DIMENSION_PX = 512;

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api';

// Socket.IO connects to the API's ORIGIN, not through /api — same server,
// same port, just a sibling path (see server/src/lib/socketServer.js's
// `path: '/socket.io'`). Stripping a trailing "/api" from API_BASE derives
// it without a second env var to keep in sync.
export const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

// Google OAuth Web-application client ID. Must be the SAME value the server
// has as GOOGLE_CLIENT_ID — that's what it verifies each ID token's audience
// against. Left unset, the Google buttons are simply not rendered and email +
// password sign-in carries on untouched.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// AI Action Router — client-side gate. When false (the default, and the value
// until the feature is deliberately switched on) the client never calls an
// assistant endpoint, and the composer and Generator behave exactly as they did
// before the feature existed.
//
// Deliberately opt-IN: any value other than an explicit "true" leaves it off, so
// a mistyped or missing env var can only under-enable the feature.
//
// This is NOT the kill switch. The app is a PWA with service-worker caching, so
// a change here reaches users on a later page load rather than immediately —
// the server's ASSISTANT_ENABLED is the control that takes effect in under a
// minute and covers already-loaded clients. See docs/ai-action-router-guardrails.md (G28).
export const ASSISTANT_ENABLED = import.meta.env.VITE_ASSISTANT_ENABLED === 'true';

// Multimodal attachments (Coach: image/PDF upload) — client-side gate, same
// deliberately-opt-in shape and same "not the real kill switch" caveat as
// ASSISTANT_ENABLED above. When false (the default), the Composer never
// renders the attach button at all — the safest possible default, since it
// means a deployment that sets nothing shows zero new UI, not a button that
// errors when pressed. The real, immediately-effective kill switch is still
// the server's ATTACHMENTS_ENABLED (POST /api/coach/attachment returns 503
// regardless of this flag) — this one only controls whether the PWA's
// currently-cached client offers the button in the first place.
export const ATTACHMENTS_ENABLED = import.meta.env.VITE_ATTACHMENTS_ENABLED === 'true';

// ---- Help & Support (bug reports + feedback) -------------------------------
//
// Client-side gate, same shape and same "not the real kill switch" caveat as
// ATTACHMENTS_ENABLED above. When false (the default), the "Need Help?" entry
// point is never rendered — the server's HELP_SUPPORT_ENABLED is the
// immediately-effective kill switch (POST /api/support/tickets returns 503
// regardless of this flag).
export const HELP_SUPPORT_ENABLED = import.meta.env.VITE_HELP_SUPPORT_ENABLED === 'true';

// ---- AI Learning Representation System (ADR Phase D) -----------------------
//
// Client-side gate, same shape and same "not the real kill switch" caveat as
// ATTACHMENTS_ENABLED/HELP_SUPPORT_ENABLED above. When false (the default),
// the "View as visual" chip is never rendered under an AI response — the
// server's LEARNING_REPRESENTATION_ENABLED is the immediately-effective kill
// switch (POST /api/coach/learning-representation returns its inert
// {representation: 'verbal_explanation'} response regardless of this flag).
export const LEARNING_REPRESENTATION_ENABLED = import.meta.env.VITE_LEARNING_REPRESENTATION_ENABLED === 'true';

// WhatsApp number for "Contact Support" (international format, digits only —
// see .env.example). Empty hides the WhatsApp option; the in-app form still
// works either way.
export const SUPPORT_WHATSAPP_NUMBER = import.meta.env.VITE_SUPPORT_WHATSAPP_NUMBER || '';

// ---- Classroom Mode --------------------------------------------------------
//
// See docs/classroom-mode.md. Client-side gate, same deliberately-opt-in shape
// and same "not the real kill switch" caveat as the flags above. When false
// (the default), the Composer never renders the "+" mode button at all, so a
// deployment that sets nothing ships zero new UI.
//
// The distinction matters more here than for the other features. Classroom Mode
// is the only place in the app where ONE teacher action fans out into several
// model calls (a coaching answer, a planner call, then one generation per
// applicable artifact), so its kill switch is a spend control as well as an
// incident control — and a build-time constant cannot be either. The server's
// CLASSROOM_MODE_ENABLED refuses to plan or attach anything regardless of this
// flag, which is what makes a response possible against already-loaded PWA
// clients that still have this value baked in.
export const CLASSROOM_MODE_ENABLED = import.meta.env.VITE_CLASSROOM_MODE_ENABLED === 'true';

// ---- Notification System ----------------------------------------------------
//
// Client-side gate, same shape and same "not the real kill switch" caveat as
// the flags above. When false (the default), neither the bell in the top bar
// nor the admin compose screen is rendered — the server's
// NOTIFICATIONS_ENABLED is the immediately-effective kill switch (every
// /api/notifications route returns 503 and the Socket.IO handshake rejects
// every connection regardless of this flag).
export const NOTIFICATIONS_ENABLED = import.meta.env.VITE_NOTIFICATIONS_ENABLED === 'true';

// ---- Classroom Management ---------------------------------------------------
//
// See docs/classroom-feature-plan.md. Client-side gate, same deliberately
// opt-in shape and same "not the real kill switch" caveat as the flags above.
// When false (the default), neither BottomNav nor TopBar renders the
// Classroom link — same "zero new UI" default as every other flagged
// feature. NOT the same feature as CLASSROOM_MODE_ENABLED above — that is an
// unrelated AI chat feature with no classes, students, attendance, or fees.
// The server's CLASSROOM_MANAGEMENT_ENABLED is the immediately-effective
// kill switch (every /api/classroom/* route returns 503 regardless of this
// flag) — a teacher who reaches /classroom directly on a stale cached client
// still just sees that feature's own "not available" message, not broken UI.
export const CLASSROOM_MANAGEMENT_ENABLED = import.meta.env.VITE_CLASSROOM_MANAGEMENT_ENABLED === 'true';

// Closed vocabulary — SERVER COUNTERPART: server/src/lib/notificationTypes.js
// NOTIFICATION_TYPES holds the same keys. Same CHANGE-11 duplication
// convention as LANGUAGES/GRADES/SUBJECTS above. CHANGE BOTH IN THE SAME
// COMMIT. `sendable: true` marks the subset an admin's compose form may pick
// (mirrors the server's ADMIN_SENDABLE_TYPES) — the rest are system/AI-only.
export const NOTIFICATION_TYPE_META: Record<NotificationType, { label: string; icon: LucideIcon; sendable: boolean }> = {
  announcement: { label: 'Announcement', icon: Megaphone, sendable: true },
  lesson_generated: { label: 'Lesson ready', icon: BookOpenCheck, sendable: false },
  assessment_ready: { label: 'Assessment ready', icon: ClipboardList, sendable: false },
  report_ready: { label: 'Report ready', icon: FileBarChart, sendable: false },
  system_update: { label: 'System update', icon: Settings2, sendable: true },
  reminder: { label: 'Reminder', icon: BellRing, sendable: true },
};

export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPE_META) as NotificationType[];
export const ADMIN_SENDABLE_NOTIFICATION_TYPES = NOTIFICATION_TYPES.filter(
  (t) => NOTIFICATION_TYPE_META[t].sendable
);

// Short build identifier auto-attached to bug reports so a report can be
// matched to the deploy it came from (see docs/help-support-architecture.md).
// Not sensitive — the equivalent of a version number.
export const BUILD_ID = import.meta.env.VITE_BUILD_ID || 'dev';

export const MAX_SUPPORT_DESCRIPTION_LENGTH = 1000;

// Closed vocabularies for the Report Bug / Send Feedback category pickers.
//
// SERVER COUNTERPART: server/src/routes/support.js's BUG_CATEGORIES /
// FEEDBACK_CATEGORIES hold the same `value`s (its authoritative validation).
// Same deliberate-duplication convention as LANGUAGES/GRADES/SUBJECTS above —
// CHANGE BOTH IN THE SAME COMMIT, since a value offered here that the server
// doesn't recognize would surface as a 400 the teacher can't act on.
export interface HelpCategoryOption { value: string; label: string }

export const BUG_CATEGORIES: HelpCategoryOption[] = [
  { value: 'crash', label: 'App crashed' },
  { value: 'connection_issue', label: 'Connection / network issue' },
  { value: 'slow_timeout', label: 'Slow / timed out' },
  { value: 'wrong_answer', label: 'AI gave a wrong or unhelpful answer' },
  { value: 'upload_failed', label: 'Upload / attachment failed' },
  { value: 'account', label: 'Sign-in / account' },
  { value: 'other', label: 'Something else' },
];

export const FEEDBACK_CATEGORIES: HelpCategoryOption[] = [
  { value: 'feature_request', label: 'Feature request' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'praise', label: 'General feedback' },
  { value: 'other', label: 'Something else' },
];
