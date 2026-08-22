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
  // A path relative to the API root (like every path passed to api()), e.g.
  // '/users/<id>/avatar?v=<timestamp>' — never the image bytes themselves.
  // null when the teacher has no custom photo, in which case avatar
  // rendering falls back to preferences.avatar (emoji) or initials. Build
  // the full <img src> as `${API_BASE}${avatarUrl}` — see TopBar.tsx.
  avatarUrl?: string | null;
}

// Effective, admin-toggleable feature flags exposed to every signed-in user
// as part of session bootstrap (login/google/GET auth/me responses) — see
// server/src/lib/systemSettings.js's getEffectiveFeatureFlags. Just the
// booleans a client-side UI gate needs, never the source/audit metadata that
// AdminFeatureFlag (below) carries for the Admin Settings screen.
export interface FeatureFlags {
  learningRepresentationEnabled: boolean;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
  featureFlags: FeatureFlags;
}

// One entry from GET/PATCH /api/admin/feature-flags (Admin Settings,
// super_admin only). `source` distinguishes an explicit admin override from
// the untouched env-var default so the control can show which state it's
// actually in. `kind` groups entries into the page's two sections; `type`
// determines which of `enabled`/`roles` is populated — exactly one of the
// two, matching the server's ADMIN_SETTINGS_REGISTRY entry for this id.
export type AdminSettingKind = 'feature_flag' | 'access_control';
export type AdminSettingValueType = 'boolean' | 'role_list';

export interface AdminFeatureFlag {
  id: string;
  label: string;
  description?: string;
  kind: AdminSettingKind;
  type: AdminSettingValueType;
  enabled?: boolean; // present when type === 'boolean'
  roles?: Role[]; // present when type === 'role_list'
  source: 'override' | 'env-default';
  updatedAt: string | null;
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

// The five classroom artifacts Classroom Mode can offer. Mirrors ARTIFACTS in
// server/src/lib/classroomPlan.js, which is the runtime authority — the server
// never returns a value outside this set.
export type ClassroomArtifact = 'lesson_plan' | 'worksheet' | 'quiz' | 'homework' | 'exit_ticket';

// What the planner decided for one turn (docs/classroom-mode.md §5). Present
// only when Classroom Mode was on AND a teachable topic was found — the server
// omits the key entirely otherwise, so its presence IS the "we have something
// to offer" signal. `artifacts` is never empty when this exists.
export interface ClassroomPlan {
  topic: string;
  grade: string;
  subject: string;
  language: string;
  artifacts: ClassroomArtifact[];
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
  // Set when the planner found a teachable topic and materials worth making.
  classroom?: ClassroomPlan;
  // Set when Classroom Mode was ON and actually ran for this turn. The pair
  // matters: `classroomMode` without `classroom` is "the mode looked and found
  // nothing", which the teacher is told about; neither field is "the mode was
  // off", which is silent. Without this flag those two are indistinguishable.
  classroomMode?: boolean;
}

// AI Learning Representation System (ADR Phase D). Mirrors the server's
// seven-item taxonomy (docs/learning-representation-system-adr.md, §4)
// exactly — 'verbal_explanation' is the "nothing extra to show" outcome, a
// first-class value here too, never a special-cased absence.
export type LearningRepresentationType =
  | 'verbal_explanation'
  | 'process_diagram'
  | 'comparison_table'
  | 'timeline'
  | 'hierarchy_diagram'
  | 'labeled_diagram'
  | 'graph_chart';

// The structured shapes rendering/schemas.js validates server-side (one per
// non-verbal representation). Kept loose (fields optional-ish via the union)
// rather than mirrored field-for-field with zod-level strictness — this is
// display data the panel reads defensively, not a contract this file
// enforces; the server already validated it before it was ever sent.
export interface ProcessDiagramData {
  steps: { label: string; description: string }[];
}
export interface ComparisonTableData {
  items: string[];
  rows: { dimension: string; values: string[] }[];
}
export interface TimelineData {
  events: { when: string; label: string; description: string }[];
}
export interface HierarchyDiagramData {
  nodes: { id: string; label: string; parentId: string | null }[];
}
export interface LabeledDiagramData {
  parts: { label: string; description: string }[];
}
export interface GraphChartData {
  chartType: 'line' | 'bar';
  xLabel: string;
  yLabel: string;
  series: { name: string; points: { x: string; y: number }[] }[];
}

export type LearningRepresentationData =
  | ProcessDiagramData
  | ComparisonTableData
  | TimelineData
  | HierarchyDiagramData
  | LabeledDiagramData
  | GraphChartData;

export interface LearningRepresentationResponse {
  requestId: string;
  representation: LearningRepresentationType;
  data: LearningRepresentationData | null;
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
  /** Date.now() when this turn was submitted. Drives the elapsed time and the
   *  wording of the waiting state (components/RunStatus.tsx). */
  startedAt?: number;
  response?: CoachResponse;
  rating: 'helpful' | 'not_helpful' | null;
  // True when this turn was rebuilt from history rather than just answered.
  // Classroom Mode reads it to decide whether its cards may generate (D24).
  restored?: boolean;
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
  // Whether Classroom Mode was on when this turn was SUBMITTED
  // (docs/classroom-mode.md). Recorded on the turn, alongside `language` and
  // `context`, rather than read live — a turn can be retried (see
  // CoachPage's handleRetry), and a retry must repeat the request that was
  // actually made, not one shaped by whatever the mode happens to be now.
  classroomMode?: boolean;
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
  // Classroom Mode's plan for this turn (D24). Present only for turns where
  // the mode actually produced one; absent for every ordinary question.
  classroom?: ClassroomPlan;
  // Sidebar three-dot menu's Rename/Pin (server/prisma/schema.prisma). `title`
  // is null until a teacher renames this entry — see useHistoryOverrides'
  // titleFor(), which falls back to `query` in that case.
  title: string | null;
  pinned: boolean;
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

// Admin Support Inbox (Phase 2) — mirrors the server DTOs in
// routes/adminSupport.js. `context` is parsed server-side before it reaches
// here (it's a JSON string only at rest, in SupportTicket.context).
export type SupportTicketType = 'bug' | 'feedback';
export type SupportTicketStatus = 'open' | 'triaged' | 'resolved' | 'wont_fix';

export interface SupportTicketUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface SupportTicketSchool {
  id: string;
  name: string;
  code: string;
}

// The list-row shape — GET /api/admin/support/tickets.
export interface SupportTicketSummary {
  id: string;
  type: SupportTicketType;
  category: string | null;
  description: string;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
  user: SupportTicketUser | null;
  school: SupportTicketSchool | null;
}

export interface SupportNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; email: string };
}

// The detail shape — GET /api/admin/support/tickets/:id. Adds the parsed
// auto-captured context and the notes thread on top of the summary shape.
export interface SupportTicketDetail extends SupportTicketSummary {
  context: Record<string, string> | null;
  notes: SupportNote[];
}

export interface SupportTicketStats {
  open: number;
  today: number;
  bugs: number;
  feedback: number;
}

// Notification System — mirrors server/src/lib/notificationTypes.js's
// NOTIFICATION_TYPES exactly (see config.ts's CHANGE-11 comment on
// NOTIFICATION_TYPE_META).
export type NotificationType =
  | 'announcement'
  | 'lesson_generated'
  | 'assessment_ready'
  | 'report_ready'
  | 'system_update'
  | 'reminder';

// One row from GET /api/notifications — mirrors the server DTO
// (server/src/lib/notificationService.js's toDto).
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
  senderName: string | null;
  senderRole: Role | null;
  metadata: Record<string, unknown> | null;
}

// Who a send targets — mirrors routes/notifications.js's targetSchema. Which
// of schoolIds/roles/userIds is populated depends on `scope`; the compose UI
// only ever offers the scopes the caller's own role can reach (the server
// re-derives and clamps this independently — see
// docs/notification-system-plan.md §7, the frontend hiding options is a
// courtesy, not the boundary).
export interface NotificationTarget {
  scope: 'all' | 'school' | 'role' | 'users';
  schoolIds?: string[];
  roles?: Role[];
  userIds?: string[];
}

export interface SendNotificationInput {
  title: string;
  message: string;
  type: NotificationType;
  link?: string;
  target: NotificationTarget;
}

// ---- Classroom Management (docs/classroom-feature-plan.md) ----------------
//
// A teacher-first class/student/attendance/fee workspace — NOT the same
// feature as ClassroomPlan/ClassroomArtifact above, which belong to the
// unrelated "Classroom Mode" AI chat feature. `SchoolClass` (not `Class` —
// a reserved word, and to avoid the naming collision) mirrors the server DTO
// (server/src/routes/classroom.js's classToDto) exactly.
export interface SchoolClass {
  id: string;
  name: string;
  grade?: string | null;
  section?: string | null;
  feeAmount?: number | null; // expected monthly fee, in whole rupees, for every active student in this class
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// Mirrors the server DTO (studentToDto). Phase 2 scope only — attendance and
// fee shapes are added alongside the phases that use them.
export interface Student {
  id: string;
  classId: string;
  name: string;
  rollNumber?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Classroom Management — Attendance (Phase 3) ---------------------------
//
// Mirrors routes/classroom.js's attendance responses exactly. "unmarked" is
// a legal STATUS value here (roster/day-view entries, and the marks a save
// request sends) even though the server never stores it as a row — see
// schema.prisma's AttendanceRecord doc comment.
export type AttendanceStatus = 'present' | 'absent' | 'unmarked';

export interface AttendanceRosterEntry {
  studentId: string;
  name: string;
  rollNumber?: string | null;
  status: AttendanceStatus;
}

export interface AttendanceDaySummary {
  present: number;
  absent: number;
  unmarked: number;
  percentage: number | null;
}

// GET .../attendance?date=
export interface DailyAttendance {
  date: string;
  roster: AttendanceRosterEntry[];
  summary: AttendanceDaySummary;
}

export interface AttendanceStudentMonthStats {
  studentId: string;
  name: string;
  rollNumber?: string | null;
  present: number;
  absent: number;
  unmarked: number;
  percentage: number | null;
}

// GET .../attendance/summary?month=
export interface ClassAttendanceMonthSummary {
  month: string;
  totalStudents: number;
  daysMarked: number;
  present: number;
  absent: number;
  unmarked: number;
  percentage: number | null;
  perStudent: AttendanceStudentMonthStats[];
}

// GET /classroom/students/:studentId/attendance/history?month=
export interface StudentAttendanceHistory {
  studentId: string;
  name: string;
  rollNumber?: string | null;
  month: string;
  present: number;
  absent: number;
  unmarked: number;
  percentage: number | null;
  days: { date: string; status: 'present' | 'absent' }[];
}

// ---- Classroom Management — Fees ------------------------------------------
//
// Mirrors routes/classroom.js's fee responses exactly (§11, extended per
// docs/fee-tracking-amounts-plan.md). `status` is always derived server-side
// from amount vs expectedAmount — the client sends `amount`, never `status`.
export type FeeStatus = 'paid' | 'partial' | 'pending';

export interface StudentFeeStatus {
  studentId: string;
  name: string;
  rollNumber?: string | null;
  status: FeeStatus;
  amount: number; // rupees paid so far this period
  expectedAmount: number | null; // snapshot of the class's feeAmount when this period was first touched; null if the class had none set yet
}

// GET .../classes/:classId/fees?period=
export interface ClassFeeStatus {
  period: string;
  totalStudents: number;
  paid: number;
  partial: number;
  pending: number;
  feeAmount: number | null; // the class's CURRENT fee amount (not a snapshot)
  totalCollected: number;
  totalExpected: number;
  perStudent: StudentFeeStatus[];
}

// PATCH .../students/:studentId/fees/:period
export interface FeeRecordDto {
  id: string;
  studentId: string;
  classId: string;
  period: string;
  status: FeeStatus;
  amount: number;
  expectedAmount: number | null;
  updatedAt: string;
}

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
