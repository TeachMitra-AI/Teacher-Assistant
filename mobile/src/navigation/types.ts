// Route names and param lists for the whole navigation tree (docs/mobile-app-plan.md
// §10). Deliberately stubbed out fully in Phase 2 — including routes with no
// screen content yet (Students/Attendance/Fees/Reports, Notifications/
// Settings/Sessions/Admin/HelpSupport) — per §26 Phase 2's own risk note:
// "keep route names stable from this phase on" (deep linking, Phase 3's
// password-reset open question, and Phase 7b's push-notification `link`
// field all eventually target routes by these names).
import type { NavigatorScreenParams } from '@react-navigation/native';
import type { AssessmentFormat, Difficulty, QuestionTypeSelection } from '../api/resources';

// Signed-out route tree (§26 Phase 3), mirrors App.tsx's own signed-out
// route set on web ('/login', '/forgot-password'). No 'reset-password'
// route: §16 recommends leaving password reset as a web-only flow for V1 —
// the email link opens the web app, and the teacher signs back into mobile
// with the new password.
export type AuthStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
};

export type CoachStackParamList = {
  Chat: undefined;
};

export type ClassroomStackParamList = {
  ClassList: undefined;
  ClassHome: { classId: string; className: string };
  Students: { classId: string; className: string };
  Attendance: { classId: string; className: string };
  // Pushed from Monthly Summary's per-student list (§13's "student
  // attendance history" screen). `month` seeds the history screen with the
  // month the teacher was already looking at.
  StudentAttendanceHistory: { studentId: string; studentName: string; classId: string; className: string; month: string };
  Fees: { classId: string; className: string };
  Reports: { classId: string; className: string };
};

export type LibraryStackParamList = {
  ResourceList: undefined;
  ResourceView: { resourceId: string };
  ResourceEdit: { resourceId: string };
};

// Teacher Attendance (docs/feature-teacher-attendance-implementation-plan.md)
// — a teacher's OWN attendance (check-in/check-out at school), NOT the
// Classroom Management stack's student attendance above. One root screen
// (AttendanceHome) hosts a segmented sub-tab switcher — Check In/History for
// everyone, Reports/Activity Log/Settings for school_admin only — the same
// "small tab switcher over a full child screen-component" shape
// AdminScreen.tsx already uses, rather than five separate pushed screens.
export type AttendanceStackParamList = {
  AttendanceHome: undefined;
};

// GeneratorResult's params are the generate response plus the request
// snapshot needed to build the save payload (docs/generator-v2-plan.md) —
// passed as route params rather than shared state, since the Form and Result
// screens are separate pushed screens (this repo's native-navigation idiom;
// see GeneratorFormScreen.tsx's header comment for why this isn't a port of
// the web page's single-page tab switch). `structured` mirrors
// GenerateAssessmentResult.structured (api/resources.ts) exactly — absent
// when the flag is off or the response had no parseable structured document.
export type GeneratorStackParamList = {
  GeneratorForm: undefined;
  GeneratorResult: {
    format: AssessmentFormat;
    grade: string;
    subject: string;
    topic: string;
    difficulty: Difficulty;
    questionType: QuestionTypeSelection;
    questionCount: number;
    language: string;
    content: string;
    structured?: string;
  };
};

// Matches client/src/components/BottomNav.tsx's order exactly (Coach,
// Library, Classroom, Attendance, Generator) — see MainTabs.tsx's header
// comment for why the previous 5th "More" tab was removed in the web-parity
// pass, and for AttendanceTab's own TEACHER_ATTENDANCE_ENABLED gating.
export type MainTabParamList = {
  CoachTab: NavigatorScreenParams<CoachStackParamList>;
  LibraryTab: NavigatorScreenParams<LibraryStackParamList>;
  ClassroomTab: NavigatorScreenParams<ClassroomStackParamList>;
  AttendanceTab: NavigatorScreenParams<AttendanceStackParamList>;
  GeneratorTab: NavigatorScreenParams<GeneratorStackParamList>;
};

// Root-level stack wrapping the tab bar. Notifications/Settings/Sessions/
// Admin/HelpSupport now live here as siblings of the tab bar itself (pushed
// over it, with the native back button) rather than nested inside a "More"
// tab — reached from Header's bell/avatar controls via navigationRef from
// anywhere in the tree, matching the web's header-bell / profile-dropdown
// placement instead of a dedicated tab (see MainTabs.tsx, Header.tsx).
export type AppStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList>;
  Notifications: undefined;
  Settings: undefined;
  Sessions: undefined;
  Admin: undefined;
  // Pushed from AdminSupportScreen's ticket list (Admin > Support tab),
  // mirroring web's separate /admin/support/:id route.
  AdminSupportTicket: { id: string };
  HelpSupport: undefined;
  GettingStarted: undefined;
  LearnMore: undefined;
};
