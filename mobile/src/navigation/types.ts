// Route names and param lists for the whole navigation tree (docs/mobile-app-plan.md
// §10). Deliberately stubbed out fully in Phase 2 — including routes with no
// screen content yet (Students/Attendance/Fees/Reports, Notifications/
// Settings/Sessions/Admin/HelpSupport) — per §26 Phase 2's own risk note:
// "keep route names stable from this phase on" (deep linking, Phase 3's
// password-reset open question, and Phase 7b's push-notification `link`
// field all eventually target routes by these names).
import type { NavigatorScreenParams } from '@react-navigation/native';

export type CoachStackParamList = {
  Chat: undefined;
};

export type ClassroomStackParamList = {
  ClassList: undefined;
  ClassHome: { classId: string; className: string };
  Students: { classId: string; className: string };
  Attendance: { classId: string; className: string };
  Fees: { classId: string; className: string };
  Reports: { classId: string; className: string };
};

export type LibraryStackParamList = {
  ResourceList: undefined;
  ResourceView: { resourceId: string };
  ResourceEdit: { resourceId: string };
};

export type GeneratorStackParamList = {
  GeneratorForm: undefined;
  GeneratorResult: undefined;
};

export type MoreStackParamList = {
  MoreMenu: undefined;
  Notifications: undefined;
  Settings: undefined;
  Sessions: undefined;
  Admin: undefined;
  HelpSupport: undefined;
};

export type MainTabParamList = {
  CoachTab: NavigatorScreenParams<CoachStackParamList>;
  ClassroomTab: NavigatorScreenParams<ClassroomStackParamList>;
  LibraryTab: NavigatorScreenParams<LibraryStackParamList>;
  GeneratorTab: NavigatorScreenParams<GeneratorStackParamList>;
  MoreTab: NavigatorScreenParams<MoreStackParamList>;
};
