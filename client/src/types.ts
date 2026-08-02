export type Role = 'teacher' | 'school_admin' | 'resource_person' | 'super_admin';

export interface School {
  id: string;
  name: string;
  code: string;
  district?: string | null;
  state?: string | null;
}

export type ResponseStyle = 'balanced' | 'concise' | 'detailed' | 'step_by_step' | 'practical';

// Site-wide defaults for the quiz/worksheet exam-paper letterhead (see
// ExamPaperMeta below for the per-resource shape these prefill). Purely
// presentational teacher input — never sent to Gemini.
export interface ExamPaperDefaults {
  schoolName?: string;
  teacherName?: string;
  defaultInstructions?: string;
  showDate?: boolean;
  showTime?: boolean;
}

// First-run onboarding state, persisted inside TeacherPreferences (Phase 0 of
// the onboarding rework). Records only what a teacher has already seen/dismissed
// so onboarding surfaces aren't re-shown across devices — no UI is driven by
// this yet. `dismissedTips` is a flat list of scoped tip ids that future phases
// append to (one id per contextual tip), so adding a tip never needs a type or
// schema change.
export interface OnboardingState {
  seenWelcomeIntro?: boolean;
  dismissedTips?: string[];
}

export interface TeacherPreferences {
  defaultLanguage?: string;
  defaultGrade?: string;
  defaultSubject?: string;
  defaultClassroomType?: string;
  responseStyle?: ResponseStyle;
  avatar?: string;
  examPaperDefaults?: ExamPaperDefaults;
  onboarding?: OnboardingState;
}

// Per-resource exam-paper letterhead (quiz/worksheet only), saved as JSON
// inside LibraryResource.structured alongside the existing generator config
// ({ format, difficulty, questionType, questionCount, topic }) under the key
// "examMeta". Deterministic teacher input, rendered by
// components/ExamHeader.tsx — never baked into AI-generated content, and
// never round-tripped through the /resources/generate request.
export interface ExamPaperMeta {
  schoolName?: string;
  examName?: string;
  teacherName?: string;
  date?: string;
  time?: string;
  maxMarks?: string;
  customInstructions?: string;
  // Whether to show a Date/Time row at all — independent of whether a value
  // has been typed yet, so "show it" and "leave the date blank on purpose"
  // (a real printed exam paper commonly does the latter) are both possible.
  showDate?: boolean;
  showTime?: boolean;
}

// An account's approval state. Every new sign-up — email+password or Google —
// starts `pending` and can't sign in until a school_admin/super_admin decides.
export type UserStatus = 'active' | 'pending' | 'rejected';

export interface User {
  id: string;
  name: string;
  // The identity key: sign-in is by email, not by name (names collide within a
  // school). `name` is display-only.
  email: string;
  displayName?: string | null;
  role: Role;
  preferences: TeacherPreferences;
  school: School;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
}

// Just enough of a school to render the "which school?" picker, which appears
// only when one email or Google identity holds accounts at more than one.
export interface SchoolOption {
  id: string;
  name: string;
  code: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  // Sent only on the second attempt, after a needs_school outcome.
  schoolId?: string;
}

export interface RegisterCredentials {
  schoolCode: string;
  name: string;
  email: string;
  password: string;
}

export interface GoogleAuthOptions {
  // Present => this is a sign-UP under that school code. Absent => sign-in.
  schoolCode?: string;
  name?: string;
  // Sent only on the second attempt, after a needs_school outcome.
  schoolId?: string;
}

// Expected non-success results of an auth attempt. These are outcomes rather
// than thrown errors because each one has its own screen to show — unlike a
// wrong password or a network failure, which stay ApiErrors.
export type AuthOutcome =
  | { kind: 'signed_in' }
  // Registered, now waiting on an admin.
  | { kind: 'pending' }
  | { kind: 'rejected' }
  | { kind: 'needs_school'; schools: SchoolOption[] }
  // Google token was valid, but no account here uses that Google identity.
  | { kind: 'not_registered' }
  // No GOOGLE_CLIENT_ID configured on the server.
  | { kind: 'unavailable' };

export interface QueryContext {
  grade?: string;
  subject?: string;
  classroomType?: string;
  issueType?: string;
}

export interface CoachResponse {
  success: boolean;
  text: string;
  responseTime?: number;
  timestamp?: string;
  language: string;
  finishReason?: string;
  context: QueryContext;
  queryId: string | null;
}

// Display-only metadata about a file attached to a turn (Coach: image/PDF
// upload). Purely presentational — the actual bytes are never held on the
// Turn once the request completes; see useAttachments for the upload-time
// objects.
export interface AttachmentMeta {
  name: string;
  kind: 'image' | 'pdf';
}

// One exchange in the session-local chat thread on the Coach page. Each turn
// still calls /coach independently and statelessly — see the redesign plan
// for why (backend has no multi-turn concept).
export interface Turn {
  id: string;
  query: string;
  language: string;
  context: QueryContext;
  status: 'pending' | 'done' | 'error';
  response?: CoachResponse;
  rating: 'helpful' | 'not_helpful' | null;
  error?: string;
  // Set when `error` came from a network failure (ApiError status 0) rather
  // than a server response — the one error category Phase 1 of Help &
  // Support offers a "Report" action on (see MessageBubble.tsx).
  errorIsNetwork?: boolean;
  // Set only when this turn was submitted with attachments — routes it to
  // POST /api/coach/attachment instead of /api/coach (see
  // CoachPage.runTurnWithAttachments). All attachments on a turn were sent
  // together in ONE request, not one request per file.
  attachments?: AttachmentMeta[];
}

export interface HistoryItem {
  id: string;
  query: string;
  language: string;
  context: QueryContext;
  text: string;
  responseTime: number;
  createdAt: string;
  rating: 'helpful' | 'not_helpful' | null;
}

export interface Analytics {
  totals: {
    queries: number;
    teachers: number;
    activeTeachers: number;
    feedback: number;
    helpfulRatio: number;
  };
  bySubject: { label: string; count: number }[];
  byIssueType: { label: string; count: number }[];
  byLanguage: { label: string; count: number }[];
  byDay: { date: string; count: number }[];
  topQuestions: { question: string; count: number }[];
}

export interface AdminSchool {
  id: string;
  name: string;
  code: string;
  district?: string | null;
  state?: string | null;
  users: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  school?: string;
  schoolCode?: string;
  lastLogin?: string | null;
  createdAt: string;
}

export type ResourceType =
  | 'lesson_plan'
  | 'classroom_activity'
  | 'assessment'
  | 'explanation'
  | 'general';

// A saved item in the teacher's personal library. Mirrors the server DTO
// (see server/src/routes/resources.js) — no ownership/internal fields.
export interface LibraryResource {
  id: string;
  type: ResourceType;
  title: string;
  grade?: string | null;
  subject?: string | null;
  language: string;
  content: string;
  structured?: string | null;
  sourceQueryId?: string | null;
  createdAt: string;
  updatedAt: string;
}
