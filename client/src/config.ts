import type { LucideIcon } from 'lucide-react';
import {
  NotebookPen, Target, Lightbulb, ClipboardCheck,
  LayoutDashboard, ShieldCheck, FileText, LifeBuoy,
  MessageCircle, Library, PencilRuler, Sparkles,
  Megaphone, BookOpenCheck, ClipboardList, FileBarChart, Settings2, BellRing,
} from 'lucide-react';
import type { Role, ResponseStyle, ResourceType, NotificationType } from './types';
import { normalizeApiBase } from './lib/apiBase';

// Languages supported for AI responses (the UI itself stays in English). The `value` codes mirror
// server/src/actions/vocab/languages.js, which the router uses to canonicalize "in Hindi" etc.; pinned by
// server/test/actions/vocabDrift.test.js. Change both in the same commit.
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

// Response language → BCP-47 code for speech synthesis.
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

// Mirrors server/src/actions/vocab/grades.js and subjects.js, which the router maps typed input onto; pinned by
// vocabDrift.test.js. Change both together: drift is silent, and the router would prefill a band this datalist doesn't offer.
export const GRADES = [
  'Pre-Primary',
  'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6',
  'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12',
];
export const SUBJECTS = ['Mathematics', 'Science', 'English', 'Hindi', 'Social Studies', 'Languages', 'General'];
export const CLASSROOM_TYPES = ['Single Grade', 'Multi-Grade', 'Mixed Ability', 'Large Class (40+)', 'Small Class (<20)'];
export const ISSUE_TYPES = ['Classroom Management', 'Concept Explanation', 'Student Engagement', 'Assessment', 'Differentiation', 'Resource Constraints'];

// Welcome-screen quick actions: they seed the composer with a starter prompt rather than submitting.
export interface QuickAction {
  icon: LucideIcon;
  label: string;
  description: string;
  prompt: string;
  // Presentation only: hidden on the mobile welcome view to keep the list short.
  hideOnMobile?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { icon: NotebookPen, label: 'Create a Lesson Plan', description: 'Structured plans with objectives and activities', prompt: 'Create a lesson plan for ' },
  { icon: Target, label: 'Create Classroom Activity', description: 'Engaging, ready-to-run classroom activities', prompt: 'Suggest a classroom activity for ' },
  { icon: Lightbulb, label: 'Explain a Concept', description: 'Simple explanations pitched to your grade', prompt: 'Explain this concept simply: ' },
  { icon: ClipboardCheck, label: 'Create Assessment', description: 'Quizzes and worksheets to check learning', prompt: 'Create a short assessment for ', hideOnMobile: true },
];

// First-run intro shown once per teacher (gated by preferences.onboarding.seenWelcomeIntro). Informational only; `adminOnly`
// items appear for admin roles.
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

// Admin shortcuts on the welcome screen; these navigate to existing pages instead of seeding a prompt.
export interface AdminShortcut {
  icon: LucideIcon;
  label: string;
  description: string;
  to: string;
}

export const ADMIN_SHORTCUTS: AdminShortcut[] = [
  { icon: LayoutDashboard, label: 'Dashboard', description: 'Usage analytics and teaching insights', to: '/admin' },
  // Hidden from the homepage, see docs/hide-homepage-items.md. Uncomment to restore; the Manage page is unaffected.
  // { icon: ShieldCheck, label: 'Manage', description: 'Schools, users, and roles', to: '/admin/manage' },
];

// Separate from ADMIN_SHORTCUTS because it's super_admin only. Currently unused: the Support Inbox card is hidden
// (docs/hide-homepage-items.md), and restoring it is a one-line change in WelcomeScreen.tsx.
export const SUPER_ADMIN_SHORTCUT: AdminShortcut = {
  icon: LifeBuoy, label: 'Support Inbox', description: 'Bug reports and feedback from teachers', to: '/admin/support',
};

// The generic follow-up chips under Coach answers were removed (docs/remove-coach-followup-chips.md); "View as visual"
// is the one action still offered under an answer.

export const MAX_QUERY_LENGTH = 500;

// Attachments (Coach image/PDF upload). Client-side checks give a quick rejection before upload; the server re-validates
// by sniffing bytes (server/src/lib/fileValidation.js) and is the real gate. These mirror its ALLOWED_MIME_TYPES and
// ATTACHMENT_MAX_FILE_SIZE_MB defaults, with no drift guard since the size is env-configurable. Keep them in step.
export const MAX_ATTACHMENT_SIZE_MB = 8;
export const ALLOWED_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// Batch bounds, mirroring the server's ATTACHMENT_MAX_FILES / ATTACHMENT_MAX_TOTAL_SIZE_MB defaults
// (docs/multimodal-attachments-architecture.md), so an over-large selection is rejected before uploading.
export const MAX_ATTACHMENTS_COUNT = 5;
export const MAX_ATTACHMENTS_TOTAL_SIZE_MB = 15;
// Attachment chips shown before collapsing the rest behind "+N more". UI only, not a server limit.
export const ATTACHMENT_TRAY_VISIBLE_COUNT = 3;
// The file input's `accept` hint for the OS picker; not validation.
export const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';

// Saved-resource types for the library and Save action, in display order.
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
// Picker lists (value + label/hint). Values must match the server's vocabularies in
// server/src/actions/schemas/generateAssessment.js (FORMATS, DIFFICULTIES, QUESTION_TYPES, MIN/MAX_QUESTIONS), which
// validates every generate request; an option the server rejects would surface as an unactionable 400. A drift guard
// pins the pair, so change both in the same commit.
export const ASSESSMENT_FORMATS: { value: 'quiz' | 'worksheet' | 'exit_ticket' | 'homework'; label: string; hint: string }[] = [
  { value: 'quiz', label: 'Quiz', hint: 'Questions with a separate answer key' },
  { value: 'worksheet', label: 'Worksheet', hint: 'Printable sheet with name/date and teacher answer key' },
  // Added for Classroom Mode (docs/classroom-mode.md) but offered here too, so a quick end-of-lesson check doesn't need the chat.
  { value: 'exit_ticket', label: 'Exit Ticket', hint: 'A 3-question check for the last minutes of a lesson' },
  // Same as exit_ticket: homework is a routine task that shouldn't need the chat.
  { value: 'homework', label: 'Homework', hint: 'Practice to do at home, with a note for parents' },
];

export const DIFFICULTIES: { value: 'easy' | 'medium' | 'hard'; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

// 'descriptive'/'fill_blank'/'match' are the structured question types (docs/generator-v2-plan.md), gated by
// STRUCTURED_QUESTIONS_ENABLED. 'mixed' is a request-only modifier, never a value a question has.
export const QUESTION_TYPES: {
  value: 'mcq' | 'true_false' | 'short_answer' | 'descriptive' | 'fill_blank' | 'match' | 'mixed';
  label: string;
}[] = [
  { value: 'mcq', label: 'Multiple Choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'short_answer', label: 'Short Answer (SAQ)' },
  { value: 'descriptive', label: 'Descriptive' },
  { value: 'fill_blank', label: 'Fill in the Blank' },
  { value: 'match', label: 'Match the Following' },
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

// Preset emoji avatars, so low-end devices need no photo upload.
export const AVATAR_PRESETS = ['👩‍🏫', '👨‍🏫', '🧑‍🏫', '📚', '✏️', '🌟', '🍎', '🎓', '🧮', '🔬', '🎨', '🌈'];

// Custom profile pictures. Types mirror AVATAR_ALLOWED_MIME_TYPES in server/src/routes/avatar.js; a quick client check,
// with the server's magic-byte sniff as the real gate.
export const AVATAR_ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Matches the server's cap in routes/avatar.js. The client resizes before upload, so this only rejects an obviously wrong file quickly.
export const AVATAR_MAX_RAW_SIZE_MB = 5;
// Avatars render square, so the client center-crops and downsizes to this before upload.
export const AVATAR_TARGET_DIMENSION_PX = 512;

// Base URL for every API call (`${API_BASE}${path}`, see api.ts). normalizeApiBase guarantees the /api suffix, so a bare
// API origin in VITE_API_BASE still works (lib/apiBase.ts).
export const API_BASE = normalizeApiBase(
  import.meta.env.VITE_API_BASE || 'http://localhost:3000/api',
);

// Socket.IO connects to the API origin, not through /api; stripping a trailing "/api" derives it without a second env var.
export const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

// Google OAuth client ID; must equal the server's GOOGLE_CLIENT_ID, which it checks tokens against. Unset hides the
// Google buttons and email/password sign-in carries on.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// GA4 Measurement ID. Unset means GA is never loaded (lib/analytics.ts).
export const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || '';

// Client-side gate for the AI Action Router. Opt-in: anything other than an explicit "true" leaves it off. Not the kill
// switch: a PWA picks up changes on a later load, so the server's ASSISTANT_ENABLED is what takes effect quickly
// (docs/ai-action-router-guardrails.md).
export const ASSISTANT_ENABLED = import.meta.env.VITE_ASSISTANT_ENABLED === 'true';

// Client-side gate for multimodal attachments; when false the Composer doesn't render the attach button at all. Not
// the kill switch: the server's ATTACHMENTS_ENABLED is (POST /api/coach/attachment returns 503 regardless).
export const ATTACHMENTS_ENABLED = import.meta.env.VITE_ATTACHMENTS_ENABLED === 'true';

// ---- Help & Support (bug reports + feedback) ----
// Client-side gate; when false the "Need Help?" entry point isn't rendered. The server's HELP_SUPPORT_ENABLED is the real
// kill switch (POST /api/support/tickets returns 503).
export const HELP_SUPPORT_ENABLED = import.meta.env.VITE_HELP_SUPPORT_ENABLED === 'true';

// ---- AI Learning Representation System ----
// Client-side gate; when false the "View as visual" chip isn't rendered. The server's LEARNING_REPRESENTATION_ENABLED
// is the real kill switch (POST /api/coach/learning-representation returns its inert response).
export const LEARNING_REPRESENTATION_ENABLED = import.meta.env.VITE_LEARNING_REPRESENTATION_ENABLED === 'true';

// WhatsApp number for "Contact Support" (digits only, see .env.example). Empty hides the option; the in-app form still works.
export const SUPPORT_WHATSAPP_NUMBER = import.meta.env.VITE_SUPPORT_WHATSAPP_NUMBER || '';

// ---- Classroom Mode ---- (docs/classroom-mode.md)
// Client-side gate; when false the Composer doesn't render the "+" mode button. One teacher action here fans out into
// several model calls, so the server's CLASSROOM_MODE_ENABLED is both the spend control and the kill switch, which a
// build-time constant can't be for already-loaded PWA clients.
export const CLASSROOM_MODE_ENABLED = import.meta.env.VITE_CLASSROOM_MODE_ENABLED === 'true';

// ---- Notification System ----
// Client-side gate; when false neither the top-bar bell nor the admin compose screen renders. The server's
// NOTIFICATIONS_ENABLED is the real kill switch (routes return 503, socket handshakes are rejected).
export const NOTIFICATIONS_ENABLED = import.meta.env.VITE_NOTIFICATIONS_ENABLED === 'true';

// ---- Classroom Management ---- (docs/classroom-feature-plan.md)
// Client-side gate; when false BottomNav and TopBar hide the Classroom link. Unrelated to CLASSROOM_MODE_ENABLED, which is
// the AI chat feature. The server's CLASSROOM_MANAGEMENT_ENABLED is the real kill switch (/api/classroom/* returns 503).
export const CLASSROOM_MANAGEMENT_ENABLED = import.meta.env.VITE_CLASSROOM_MANAGEMENT_ENABLED === 'true';

// ---- Teacher Attendance ---- (docs/feature-teacher-attendance-implementation-plan.md)
// Client-side gate; when false BottomNav and TopBar hide the Attendance link. This is a teacher's own attendance, not
// marking students (that's CLASSROOM_MANAGEMENT_ENABLED). The server's TEACHER_ATTENDANCE_ENABLED is the real kill switch.
export const TEACHER_ATTENDANCE_ENABLED = import.meta.env.VITE_TEACHER_ATTENDANCE_ENABLED === 'true';

// ---- Structured Question Model (Generator v2) ---- (docs/generator-v2-plan.md)
// Client-side gate; when false the question-type picker offers only mcq/true_false/short_answer/mixed. The server's
// STRUCTURED_QUESTIONS_ENABLED is the real kill switch (the new types 503 with STRUCTURED_QUESTIONS_DISABLED).
export const STRUCTURED_QUESTIONS_ENABLED = import.meta.env.VITE_STRUCTURED_QUESTIONS_ENABLED === 'true';

// Mirrors NOTIFICATION_TYPES in server/src/lib/notificationTypes.js; change both in the same commit. `sendable: true`
// marks the types an admin's compose form may pick (the server's ADMIN_SENDABLE_TYPES); the rest are system/AI-only.
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

// Short build id attached to bug reports so a report maps to a deploy (docs/help-support-architecture.md). Not sensitive.
export const BUILD_ID = import.meta.env.VITE_BUILD_ID || 'dev';

export const MAX_SUPPORT_DESCRIPTION_LENGTH = 1000;

// Category pickers for Report Bug / Send Feedback. Mirrors BUG_CATEGORIES / FEEDBACK_CATEGORIES in
// server/src/routes/support.js; change both together, since an unknown value would be a 400 the teacher can't act on.
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
