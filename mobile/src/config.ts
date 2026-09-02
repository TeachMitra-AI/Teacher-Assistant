import {
  NotebookPen, Target, ClipboardCheck, Lightbulb, FileText,
  FileQuestion, ClipboardList, Ticket, House,
  Megaphone, BookOpenCheck, FileBarChart, Settings2, BellRing,
  MessageCircle, Library, PencilRuler, Sparkles, ShieldCheck, type LucideIcon,
} from 'lucide-react-native';
import type { NotificationType, ResourceType, ResponseStyle, Role } from './types';
import type { AssessmentFormat, Difficulty, QuestionType } from './api/resources';

// Mirrors client/src/config.ts's ROLE_LABELS verbatim.
export const ROLE_LABELS: Record<Role, string> = {
  teacher: 'Teacher',
  school_admin: 'School Admin',
  resource_person: 'Resource Person',
  super_admin: 'Super Admin',
};

// Mirrors client/src/config.ts's API_BASE/SOCKET_BASE (docs/mobile-app-plan.md
// §21). The plan document describes an app.config.ts + expo-constants
// approach; verified during implementation that Expo's built-in
// EXPO_PUBLIC_* env-var inlining (babel-preset-expo's inline-env-vars plugin,
// confirmed present in the installed Expo SDK 57) does the identical
// build-time-constant job with less machinery — the direct mobile analogue of
// Vite's VITE_* convention, so it's used here instead.
//
// Local physical-device note (see mobile/DEVICE_TESTING.md): on a real phone,
// "localhost" means the phone itself, not this development machine. The
// default below only works for the Android emulator's special-cased
// 10.0.2.2 loopback alias — for USB-connected physical-device testing, either
// set EXPO_PUBLIC_API_BASE to this machine's LAN IP, or `adb reverse
// tcp:3000 tcp:3000` alongside Expo's own tcp:8081 reverse (which it sets up
// automatically) so the phone's own "localhost:3000" reaches this machine's
// server over the USB cable.
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:3000/api';

// Socket.IO connects to the API's origin, not through /api — same derivation
// as client/src/config.ts's SOCKET_BASE.
export const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

// client/src/config.ts:149 — POST /coach rejects a longer query server-side
// (server/src/index.js's MAX_QUERY_LENGTH check); mirrored here so the
// composer can stop a teacher before that round trip, not after it.
export const MAX_QUERY_LENGTH = 500;

// ---- Multimodal attachments (Coach: image/PDF upload) ----------------------
//
// Client-side gate, same deliberately-opt-in shape and same "not the real
// kill switch" caveat as every flag in this file: the server's
// ATTACHMENTS_ENABLED is the immediately-effective one (POST
// /api/coach/attachment returns 503 regardless of this flag). When false (the
// default), the "+" attach button is never rendered — "zero new UI" default.
// Mirrors the web client's VITE_ATTACHMENTS_ENABLED.
export const ATTACHMENTS_ENABLED = process.env.EXPO_PUBLIC_ATTACHMENTS_ENABLED === 'true';

// Client-side checks only — mirrors client/src/config.ts's
// MAX_ATTACHMENT_SIZE_MB/ALLOWED_ATTACHMENT_MIME_TYPES/MAX_ATTACHMENTS_COUNT/
// MAX_ATTACHMENTS_TOTAL_SIZE_MB exactly (same SERVER COUNTERPART note applies
// — server/src/lib/fileValidation.js and server/src/lib/flags.js hold the
// authoritative bounds; keep these in step as "the common default").
export const MAX_ATTACHMENT_SIZE_MB = 8;
export const ALLOWED_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_ATTACHMENTS_COUNT = 5;
export const MAX_ATTACHMENTS_TOTAL_SIZE_MB = 15;
// How many attachment chips the tray shows before collapsing the rest behind
// "+N more" — a UI constant, not a server-mirrored limit.
export const ATTACHMENT_TRAY_VISIBLE_COUNT = 3;

// ---- Classroom Mode ----------------------------------------------------------
//
// Client-side gate, same shape and caveat as ATTACHMENTS_ENABLED above: the
// server's CLASSROOM_MODE_ENABLED is the immediately-effective one (it
// refuses to plan or generate artifacts regardless of this flag). When false
// (the default), the Assistant Mode / Classroom Mode selector is never
// rendered in the Composer. Mirrors the web client's
// VITE_CLASSROOM_MODE_ENABLED. See docs/classroom-mode.md.
export const CLASSROOM_MODE_ENABLED = process.env.EXPO_PUBLIC_CLASSROOM_MODE_ENABLED === 'true';

// --- Phase 5 (Library) ---
// Ported from client/src/config.ts. Same closed vocabularies, same server
// counterpart (server/src/routes/resources.js's RESOURCE_TYPES) — kept in
// step per that file's own "CHANGE BOTH IN THE SAME COMMIT" convention.
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

// client/src/config.ts's GRADES/SUBJECTS/LANGUAGES — same values, same
// server-side vocabulary drift-guard note applies (server/src/actions/vocab/*).
export const GRADES = ['Pre-Primary', 'Class 1-2', 'Class 3-5', 'Class 6-8', 'Class 9-10', 'Class 11-12'];
export const SUBJECTS = ['Mathematics', 'Science', 'English', 'Hindi', 'Social Studies', 'Languages', 'General'];

// client/src/config.ts's CLASSROOM_TYPES/ISSUE_TYPES — the "More context"
// section of the Coach page's teaching-context menu (Coach's header icon,
// TeachingContextMenu.tsx). Same closed vocabularies, same drift-guard note
// as GRADES/SUBJECTS above.
export const CLASSROOM_TYPES = ['Single Grade', 'Multi-Grade', 'Mixed Ability', 'Large Class (40+)', 'Small Class (<20)'];
export const ISSUE_TYPES = ['Classroom Management', 'Concept Explanation', 'Student Engagement', 'Assessment', 'Differentiation', 'Resource Constraints'];

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

// --- Phase 6 (Generator) ---
// Ported from client/src/config.ts. Same closed vocabularies, same server
// counterpart (server/src/actions/schemas/generateAssessment.js) — kept in
// step per that file's own "CHANGE BOTH IN THE SAME COMMIT" convention.
export const ASSESSMENT_FORMATS: { value: AssessmentFormat; label: string; hint: string; icon: LucideIcon }[] = [
  { value: 'quiz', label: 'Quiz', hint: 'Questions with a separate answer key', icon: FileQuestion },
  { value: 'worksheet', label: 'Worksheet', hint: 'Printable sheet with name/date and teacher answer key', icon: ClipboardList },
  { value: 'exit_ticket', label: 'Exit Ticket', hint: 'A 3-question check for the last minutes of a lesson', icon: Ticket },
  { value: 'homework', label: 'Homework', hint: 'Practice to do at home, with a note for parents', icon: House },
];

export const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

// 'descriptive'/'fill_blank'/'match' are the Structured Question Model's three
// new types (docs/generator-v2-plan.md); 'mixed' stays a request-only
// modifier, never a value a question itself has. Gated server-side by
// STRUCTURED_QUESTIONS_ENABLED — see STRUCTURED_QUESTIONS_ENABLED below for
// the matching client-side picker gate.
export const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
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

// ---- Structured Question Model (Generator v2) -------------------------------
//
// See docs/generator-v2-plan.md. Client-side gate, same deliberately opt-in
// shape and same "not the real kill switch" caveat as the web client's own
// VITE_STRUCTURED_QUESTIONS_ENABLED. This flag does NOT filter the
// question-type picker above — QUESTION_TYPES always offers all 7 values,
// mirroring the web Generator's actual runtime behavior exactly (its own
// picker has no such filter either, despite an inaccurate comment there —
// see docs/generator-v2-plan.md's Stage 3 log). What this flag DOES gate:
// whether GeneratorResultScreen/ResourceEditScreen parse and render an
// already-structured document via the native QuestionCard/QuestionListEditor
// editor, vs. treating `structured` as absent and falling back to the flat
// Markdown editor ("zero new UI" when false, the default). The server's
// STRUCTURED_QUESTIONS_ENABLED is the immediately-effective kill switch for
// actually *requesting* one of the 3 new types (they 503 with
// STRUCTURED_QUESTIONS_DISABLED regardless of this flag) — a stale
// already-installed build offering a type the server will reject still just
// gets that clear error, not a silently-broken generation.
export const STRUCTURED_QUESTIONS_ENABLED = process.env.EXPO_PUBLIC_STRUCTURED_QUESTIONS_ENABLED === 'true';

// --- Phase 7 (Notifications) ---
// Ported from client/src/config.ts. Client-side gate, same "not the real kill
// switch" caveat as every flag above: the server's NOTIFICATIONS_ENABLED is
// the immediately-effective one (every /api/notifications route 503s and the
// Socket.IO handshake rejects every connection regardless of this flag).
export const NOTIFICATIONS_ENABLED = process.env.EXPO_PUBLIC_NOTIFICATIONS_ENABLED === 'true';

// --- Phase 7b (Push Notifications) ---
// Client-side gate, same "not the real kill switch" caveat as every flag
// above: the server's MOBILE_PUSH_ENABLED is the immediately-effective one
// (both device-token routes 503 regardless of this flag). Deliberately a
// SEPARATE flag from NOTIFICATIONS_ENABLED — this app can ship in-app/
// realtime notifications without OS push, or vice versa, without either
// flag implying the other (mirrors server/src/lib/flags.js's
// readMobilePushFlags doc comment).
export const MOBILE_PUSH_ENABLED = process.env.EXPO_PUBLIC_MOBILE_PUSH_ENABLED === 'true';

// Closed vocabulary — SERVER COUNTERPART: server/src/lib/notificationTypes.js.
// Same CHANGE-11 duplication convention as the vocabularies above.
// `sendable: true` marks the subset the Admin Notifications compose screen
// may pick — mirrors client/src/config.ts's NOTIFICATION_TYPE_META exactly.
export const NOTIFICATION_TYPE_META: Record<NotificationType, { label: string; icon: LucideIcon; sendable: boolean }> = {
  announcement: { label: 'Announcement', icon: Megaphone, sendable: true },
  lesson_generated: { label: 'Lesson ready', icon: BookOpenCheck, sendable: false },
  assessment_ready: { label: 'Assessment ready', icon: ClipboardList, sendable: false },
  report_ready: { label: 'Report ready', icon: FileBarChart, sendable: false },
  system_update: { label: 'System update', icon: Settings2, sendable: true },
  reminder: { label: 'Reminder', icon: BellRing, sendable: true },
};

export const ADMIN_SENDABLE_NOTIFICATION_TYPES = (Object.keys(NOTIFICATION_TYPE_META) as NotificationType[]).filter(
  (t) => NOTIFICATION_TYPE_META[t].sendable
);

// Admin dashboard visibility gate — mirrors client/src/config.ts's
// ADMIN_ROLES verbatim. Support/Settings tabs are further restricted to
// super_admin only (see AdminScreen.tsx), matching AdminTabs.tsx on web.
export const ADMIN_ROLES: Role[] = ['school_admin', 'resource_person', 'super_admin'];

// --- Settings / Getting Started / Help & Support ---
// Ported from client/src/config.ts, verbatim values — same "CHANGE BOTH IN
// THE SAME COMMIT" server-drift-guard convention as GRADES/SUBJECTS above.

// Getting Started screen (GettingStartedScreen.tsx) — mirrors the web's
// OnboardingIntro feature list exactly. `adminOnly` items are filtered the
// same way ADMIN_SHORTCUTS is.
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

// Settings screen (SettingsScreen.tsx) — preferred coaching response style.
export const RESPONSE_STYLES: { value: ResponseStyle; label: string; hint: string }[] = [
  { value: 'balanced', label: 'Balanced', hint: 'Well-rounded advice (default)' },
  { value: 'concise', label: 'Concise', hint: 'Short and to the point' },
  { value: 'detailed', label: 'Detailed', hint: 'Thorough, in-depth explanations' },
  { value: 'step_by_step', label: 'Step by step', hint: 'Numbered, follow-along steps' },
  { value: 'practical', label: 'Practical', hint: 'Ready-to-use classroom actions' },
];

// Lightweight preset avatars (emoji) — an alternative to the custom-photo
// upload below, same AVATAR_PRESETS values as the web version.
export const AVATAR_PRESETS = ['👩‍🏫', '👨‍🏫', '🧑‍🏫', '📚', '✏️', '🌟', '🍎', '🎓', '🧮', '🔬', '🎨', '🌈'];

// Custom profile pictures (server counterpart: server/src/routes/avatar.js).
// Types mirror that route's AVATAR_ALLOWED_MIME_TYPES exactly — this is a
// fast, friendly client-side check only; the server's magic-byte sniff is
// the real gate, same "courtesy vs. real gate" split as the Coach attachment
// feature. Picked via expo-image-picker's launchImageLibraryAsync (the
// device's photo library — SettingsScreen.tsx's "camera" icon opens this,
// not a live camera capture, matching the web's file-input trigger, which
// also opens the photo library rather than the camera on most devices).
export const AVATAR_ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Matches the server's hardcoded cap in routes/avatar.js exactly.
export const AVATAR_MAX_RAW_SIZE_MB = 5;

// ---- Help & Support (bug reports + feedback) ----
//
// Client-side gate, same shape and "not the real kill switch" caveat as
// NOTIFICATIONS_ENABLED/MOBILE_PUSH_ENABLED above. When false (the
// default), the "Need Help?" entry point is never rendered — the server's
// HELP_SUPPORT_ENABLED is the immediately-effective kill switch (POST
// /api/support/tickets returns 503 regardless of this flag).
export const HELP_SUPPORT_ENABLED = process.env.EXPO_PUBLIC_HELP_SUPPORT_ENABLED === 'true';

// WhatsApp number for "Contact Support" (international format, digits only —
// see .env.example). Empty hides the WhatsApp option; the in-app message
// form still works either way.
export const SUPPORT_WHATSAPP_NUMBER = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP_NUMBER || '';

export const MAX_SUPPORT_DESCRIPTION_LENGTH = 1000;

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
