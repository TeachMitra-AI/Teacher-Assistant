import {
  NotebookPen, Target, ClipboardCheck, Lightbulb, FileText,
  FileQuestion, ClipboardList, Ticket, House,
  Megaphone, BookOpenCheck, FileBarChart, Settings2, BellRing, type LucideIcon,
} from 'lucide-react-native';
import type { NotificationType, ResourceType } from './types';
import type { AssessmentFormat, Difficulty, QuestionType } from './api/resources';

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
// Same CHANGE-11 duplication convention as the vocabularies above. Unlike the
// web's version, mobile has no admin compose screen yet (later phase, §26),
// so `sendable` isn't tracked here — nothing reads it.
export const NOTIFICATION_TYPE_META: Record<NotificationType, { label: string; icon: LucideIcon }> = {
  announcement: { label: 'Announcement', icon: Megaphone },
  lesson_generated: { label: 'Lesson ready', icon: BookOpenCheck },
  assessment_ready: { label: 'Assessment ready', icon: ClipboardList },
  report_ready: { label: 'Report ready', icon: FileBarChart },
  system_update: { label: 'System update', icon: Settings2 },
  reminder: { label: 'Reminder', icon: BellRing },
};
