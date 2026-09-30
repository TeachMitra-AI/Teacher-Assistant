export type Role = 'teacher' | 'school_admin' | 'resource_person' | 'super_admin';

export interface School {
  id: string;
  name: string;
  code: string;
  district?: string | null;
  state?: string | null;
}

export type ResponseStyle = 'balanced' | 'concise' | 'detailed' | 'step_by_step' | 'practical';

// Site-wide defaults for the quiz/worksheet exam-paper letterhead (see ExamPaperMeta for the per-resource shape).
// Presentational teacher input, never sent to Gemini.
export interface ExamPaperDefaults {
  schoolName?: string;
  teacherName?: string;
  defaultInstructions?: string;
  showDate?: boolean;
  showTime?: boolean;
}

// First-run onboarding state inside TeacherPreferences: only what a teacher has already seen or dismissed, so surfaces
// aren't re-shown across devices. `dismissedTips` is a flat list of scoped tip ids, so adding a tip needs no schema change.
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

// Per-resource exam-paper letterhead (quiz/worksheet only), saved in LibraryResource.structured under "examMeta" and
// rendered by components/ExamHeader.tsx. Teacher input only: never baked into AI content or sent to /resources/generate.
export interface ExamPaperMeta {
  schoolName?: string;
  examName?: string;
  teacherName?: string;
  date?: string;
  time?: string;
  maxMarks?: string;
  customInstructions?: string;
  // Independent of whether a value is typed, so "show the row" and "leave the date blank on purpose" both work.
  showDate?: boolean;
  showTime?: boolean;
}

// An account's approval state. Every new sign-up starts `pending` and can't sign in until an admin decides.
export type UserStatus = 'active' | 'pending' | 'rejected';

export interface User {
  id: string;
  name: string;
  // The identity key: sign-in is by email, since names collide within a school. `name` is display-only.
  email: string;
  displayName?: string | null;
  role: Role;
  createdAt: string;
  preferences: TeacherPreferences;
  school: School;
  // Path relative to the API root (e.g. '/users/<id>/avatar?v=<timestamp>'), never the bytes. null means no custom photo,
  // so rendering falls back to preferences.avatar or initials. Build the src as `${API_BASE}${avatarUrl}` (see TopBar.tsx).
  avatarUrl?: string | null;
}

// Effective admin-toggleable feature flags sent to every signed-in user at session bootstrap (see server
// getEffectiveFeatureFlags). Just the booleans a client UI gate needs, not the audit metadata AdminFeatureFlag carries.
export interface FeatureFlags {
  learningRepresentationEnabled: boolean;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
  featureFlags: FeatureFlags;
}

// One entry from GET/PATCH /api/admin/feature-flags (super_admin only). `source` separates an admin override from the
// env-var default; `kind` groups the page's two sections; `type` decides which of `enabled`/`roles` is populated.
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

// Just enough of a school for the "which school?" picker, shown when one identity holds accounts at several.
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
  name: string;
  email: string;
  password: string;
}

export interface GoogleAuthOptions {
  // true => sign-UP (the server assigns a default school); absent/false => sign-in.
  signup?: boolean;
  name?: string;
  // Sent only on the second attempt, after a needs_school outcome.
  schoolId?: string;
}

// Expected non-success auth results. These are outcomes rather than thrown errors because each has its own screen;
// a wrong password or network failure stays an ApiError.
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

// The five classroom artifacts Classroom Mode can offer. Mirrors ARTIFACTS in server/src/lib/classroomPlan.js, the runtime authority.
export type ClassroomArtifact = 'lesson_plan' | 'worksheet' | 'quiz' | 'homework' | 'exit_ticket';

// What the planner decided for one turn (docs/classroom-mode.md). The server omits the key unless Classroom Mode was on
// and a teachable topic was found, so its presence means "we have something to offer". `artifacts` is never empty.
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
  // Set when Classroom Mode was on and ran. `classroomMode` without `classroom` means it looked and found nothing (the
  // teacher is told); neither means the mode was off (silent). Without the flag those two can't be told apart.
  classroomMode?: boolean;
}

// AI Learning Representation System. Mirrors the server's seven-item taxonomy (docs/learning-representation-system-adr.md);
// 'verbal_explanation' means "nothing extra to show" and is a real value, not an absence.
export type LearningRepresentationType =
  | 'verbal_explanation'
  | 'process_diagram'
  | 'comparison_table'
  | 'timeline'
  | 'hierarchy_diagram'
  | 'labeled_diagram'
  | 'graph_chart';

// The structured shapes validated server-side by rendering/schemas.js. Kept loose: this is display data the panel reads
// defensively, and the server already validated it.
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

// Display-only metadata about a file attached to a turn. The bytes aren't kept on the Turn (see useAttachments).
export interface AttachmentMeta {
  name: string;
  kind: 'image' | 'pdf';
}

// One exchange in the session-local chat thread on the Coach page. Each turn calls /coach independently and statelessly.
export interface Turn {
  id: string;
  query: string;
  language: string;
  context: QueryContext;
  status: 'pending' | 'done' | 'error';
  /** Date.now() when submitted; drives the elapsed time and waiting-state wording (components/RunStatus.tsx). */
  startedAt?: number;
  response?: CoachResponse;
  rating: 'helpful' | 'not_helpful' | null;
  // True when rebuilt from history; Classroom Mode uses it to decide whether its cards may generate.
  restored?: boolean;
  error?: string;
  // Set when `error` was a network failure (ApiError status 0); the one category offering a "Report" action (MessageBubble.tsx).
  errorIsNetwork?: boolean;
  // Epoch ms; set only when every Gemini API key is exhausted (ApiError.retryAt). Drives the countdown and "Try again" state.
  retryAt?: number;
  // Set only for turns with attachments, which go to POST /api/coach/attachment (see CoachPage.runTurnWithAttachments),
  // all in one request.
  attachments?: AttachmentMeta[];
  // Whether Classroom Mode was on when the turn was submitted (docs/classroom-mode.md). Stored on the turn so a retry
  // repeats the request actually made, not one shaped by the current mode.
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
  // Classroom Mode's plan for this turn; absent for ordinary questions.
  classroom?: ClassroomPlan;
  // Sidebar Rename/Pin. `title` is null until renamed; useHistoryOverrides' titleFor() then falls back to `query`.
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

// Admin Support Inbox: mirrors the DTOs in routes/adminSupport.js. `context` is parsed server-side (a JSON string only at rest).
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

// List-row shape: GET /api/admin/support/tickets.
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

// Detail shape: GET /api/admin/support/tickets/:id, adding the parsed context and the notes thread.
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

// Notification System: mirrors NOTIFICATION_TYPES in server/src/lib/notificationTypes.js (see NOTIFICATION_TYPE_META in config.ts).
export type NotificationType =
  | 'announcement'
  | 'lesson_generated'
  | 'assessment_ready'
  | 'report_ready'
  | 'system_update'
  | 'reminder';

// One row from GET /api/notifications; mirrors the server's toDto.
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

// Who a send targets (routes/notifications.js targetSchema). Which of schoolIds/roles/userIds is set depends on `scope`.
// The compose UI only offers scopes the caller's role can reach, but the server re-derives and clamps them; hiding is a
// courtesy, not the boundary (docs/notification-system-plan.md).
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

// ---- Classroom Management (docs/classroom-feature-plan.md) ----
// Class/student/attendance/fee workspace; unrelated to the ClassroomPlan/ClassroomArtifact types above (Classroom Mode).
// `SchoolClass` avoids the reserved word and mirrors the server's classToDto.
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

// Mirrors studentToDto.
export interface Student {
  id: string;
  classId: string;
  name: string;
  rollNumber?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Classroom Management: Attendance ----
// Mirrors routes/classroom.js's attendance responses. "unmarked" is a legal status in roster/day-view entries and save
// requests even though the server never stores it as a row (see AttendanceRecord in schema.prisma).
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

// ---- Teacher Attendance ----
// A teacher's own check-in/check-out, reviewed by their school's Principal (school_admin); mirrors the DTOs in
// routes/teacherAttendance.js. Distinct from the student-attendance types above, and named differently so they can't be
// confused at an import site.
// 'flagged_review' stays in the type (a Principal's 'reject', or legacy data, can carry it) though nothing assigns it
// now: geofence/window failures are hard blocks (docs/feature-teacher-attendance-implementation-plan.md).
export type TeacherAttendanceStatus =
  | 'present'
  | 'half_day'
  | 'absent'
  | 'on_leave'
  | 'on_duty'
  | 'pending_regularization'
  | 'flagged_review';

// A teacher's own view: no raw GPS/device evidence (see attendanceToDto server-side).
export interface TeacherAttendanceDto {
  id: string;
  date: string; // "YYYY-MM-DD"
  checkInAt: string | null;
  checkOutAt: string | null;
  status: TeacherAttendanceStatus;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
  workingMinutes: number | null;
  shortfallMinutes: number | null;
  leaveOrDutyCategory: string | null;
  leaveOrDutyReason: string | null;
  // The Principal's typed reason from the latest review; null if never reviewed.
  reviewReason: string | null;
}

// A Principal's per-day view of one teacher's record, with the raw evidence a correction needs (attendanceToDetailDto).
export interface TeacherAttendanceDetailDto extends TeacherAttendanceDto {
  teacher?: { id: string; name: string; email: string };
  checkInLat: number | null;
  checkInLon: number | null;
  checkInAccuracyMeters: number | null;
  checkInDistanceMeters: number | null;
  checkInDeviceId: string | null;
  checkOutLat: number | null;
  checkOutLon: number | null;
  checkOutAccuracyMeters: number | null;
  checkOutDistanceMeters: number | null;
  checkOutDeviceId: string | null;
}

// Mirrors REVIEW_ACTIONS in teacherAttendanceSchema.js; keep both in step.
export type TeacherAttendanceReviewAction =
  | 'approve'
  | 'correct_checkin'
  | 'correct_checkout'
  | 'mark_on_leave'
  | 'mark_on_duty'
  | 'reject';

export interface TeacherAttendanceReviewInput {
  action: TeacherAttendanceReviewAction;
  reason: string;
  correctedCheckInAt?: string;
  correctedCheckOutAt?: string;
  leaveOrDutyCategory?: string;
}

// A school's attendance settings (school_admin only); mirrors SchoolAttendanceConfig.
export interface SchoolAttendanceConfigDto {
  id: string;
  schoolId: string;
  openTime: string;
  closeTime: string;
  checkinWindowStart: string;
  checkinWindowEnd: string;
  // Comma-separated day numbers (0=Sunday..6=Saturday), e.g. "0,6"; same format as isWeeklyOff() in lib/teacherAttendance.js.
  weeklyOffDays: string;
  lateGraceMinutes: number;
  halfDayThresholdPercent: number;
  fullDayGraceMinutes: number;
  geofenceLat: number;
  geofenceLon: number;
  geofenceRadiusMeters: number;
  repeatPatternThreshold: number;
  repeatPatternWindowDays: number;
  // Checkout reminder timing: minutes before/after closeTime (server/src/lib/teacherAttendanceReminder.js).
  reminderMinutesBeforeClose: number;
  reminderMinutesAfterClose: number;
  // When the settings were first created: the earliest date tracking applies, so History doesn't show Absent/Weekly-off before it.
  createdAt: string;
}

// Mirrors schoolAttendanceConfigSchema: every threshold is optional on write (omitted keeps the stored value); openTime,
// closeTime and geofence are required together to enable check-ins.
export interface SchoolAttendanceConfigInput {
  openTime: string;
  closeTime: string;
  checkinWindowStart: string;
  checkinWindowEnd: string;
  weeklyOffDays?: string;
  lateGraceMinutes?: number;
  halfDayThresholdPercent?: number;
  fullDayGraceMinutes?: number;
  geofenceLat: number;
  geofenceLon: number;
  geofenceRadiusMeters?: number;
  repeatPatternThreshold?: number;
  repeatPatternWindowDays?: number;
  reminderMinutesBeforeClose?: number;
  reminderMinutesAfterClose?: number;
}

export interface SchoolHolidayDto {
  id: string;
  schoolId: string;
  date: string; // "YYYY-MM-DD"
  reason: string;
  source: 'department' | 'principal_emergency';
}

export interface CreateHolidayInput {
  date: string;
  reason: string;
}

// Mirrors summarizeTeacherMonth(): per-outcome counts for one teacher's month.
export interface TeacherAttendanceSummary {
  present: number;
  absent: number;
  late: number;
  half_day: number;
  on_leave: number;
  on_duty: number;
  flagged_review: number;
  pending_regularization: number;
}

// GET /school-history: the Reports tab's list view (school_admin only). Summary-only and paginated so a large school
// doesn't load every teacher's full month (docs/feature-teacher-attendance-implementation-plan.md); per-teacher detail
// is a separate call.
export interface SchoolHistoryTeacherSummary {
  id: string;
  name: string;
  email: string;
  summary: TeacherAttendanceSummary;
}

export interface SchoolHistoryPage {
  month: string;
  page: number;
  pageSize: number;
  total: number;
  teachers: SchoolHistoryTeacherSummary[];
}

// GET /school-history/:userId: one teacher's day-by-day records for a month (the drill-down).
export interface TeacherAttendanceDetailPage {
  month: string;
  teacher: { id: string; name: string; email: string; createdAt: string };
  records: TeacherAttendanceDetailDto[];
}

// GET /activity-log: the "who → what → when → where → result" feed (school_admin only), a recent window by default.
export interface TeacherAttendanceActivityLogEntry {
  id: string;
  userId: string;
  userName: string | null;
  performedBy: string | null;
  action: string;
  result: string | null;
  distanceMeters: number | null;
  createdAt: string;
}

export interface TeacherAttendanceActivityLogPage {
  days: number;
  page: number;
  pageSize: number;
  total: number;
  entries: TeacherAttendanceActivityLogEntry[];
}

// GET /today-summary: the Reports tab's stat cards, four school-wide numbers for today (docs/attendance-register-design.html).
export interface TeacherAttendanceTodaySummary {
  date: string;
  nonWorkingDay: NonWorkingDayInfo | null;
  present: number;
  late: number;
  missingCheckout: number;
  absent: number;
}

// Extra field on GET .../today so the check-in page can say "today is a holiday" up front.
export interface NonWorkingDayInfo {
  code: 'WEEKLY_OFF_DAY' | 'HOLIDAY';
  message: string;
}

// ---- Classroom Management: Fees ----
// Mirrors routes/classroom.js's fee responses (docs/fee-tracking-amounts-plan.md). `status` is derived server-side from
// amount vs expectedAmount; the client sends `amount`, never `status`.
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
  totalPending: number; // sum of each student's own (expectedAmount - amount), never negative per student — an overpayment never offsets another student's shortfall
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

// A saved item in the teacher's personal library; mirrors the server DTO (routes/resources.js), minus ownership fields.
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
