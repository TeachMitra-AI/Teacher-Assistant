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

export interface TeacherPreferences {
  defaultLanguage?: string;
  defaultGrade?: string;
  defaultSubject?: string;
  defaultClassroomType?: string;
  responseStyle?: ResponseStyle;
  avatar?: string;
  examPaperDefaults?: ExamPaperDefaults;
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

export interface User {
  id: string;
  name: string;
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
  queries: number;
}

export interface AdminUser {
  id: string;
  name: string;
  role: Role;
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
