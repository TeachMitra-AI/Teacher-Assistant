import type { LucideIcon } from 'lucide-react';
import {
  NotebookPen, Target, Lightbulb, ClipboardCheck, Users,
  LayoutDashboard, ShieldCheck, FileText,
  MessageCircle, Library, PencilRuler, Sparkles,
} from 'lucide-react';
import type { Role, ResponseStyle, ResourceType } from './types';

// Languages supported for AI responses (UI itself stays in English).
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
  { icon: Users, label: 'Manage Classroom', description: 'Strategies for engagement and behaviour', prompt: 'How do I manage ', hideOnMobile: true },
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
  { icon: ShieldCheck, label: 'Manage', description: 'Schools, users, and roles', to: '/admin/manage' },
];

// Contextual follow-up chips shown under an AI response. Each one resubmits
// a *new*, self-contained turn — either the original short question with a
// brief instruction appended, or the same question with the language
// switched. Neither approach needs the (potentially very long) previous
// answer text, so both stay comfortably under MAX_QUERY_LENGTH without any
// backend change.
export type FollowUpAction =
  | { id: string; label: string; icon: string; kind: 'suffix'; suffix: string }
  | { id: string; label: string; icon: string; kind: 'translate'; targetLanguage: string };

export const FOLLOW_UP_ACTIONS: FollowUpAction[] = [
  { id: 'simplify', label: 'Make it simpler', icon: '✨', kind: 'suffix', suffix: ' Explain this more simply, in easy words.' },
  { id: 'worksheet', label: 'Create a worksheet', icon: '📄', kind: 'suffix', suffix: ' Create a printable worksheet for this.' },
  { id: 'activity', label: '5-minute activity', icon: '⏱️', kind: 'suffix', suffix: ' Suggest a quick 5-minute classroom activity for this.' },
  { id: 'translate_hi', label: 'Translate to Hindi', icon: '🌐', kind: 'translate', targetLanguage: 'hi' },
  { id: 'translate_en', label: 'Translate to English', icon: '🌐', kind: 'translate', targetLanguage: 'en' },
];

export const MAX_QUERY_LENGTH = 500;

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

// --- Quiz / Worksheet Generator options (mirror server enums in
// server/src/routes/resources.js). ---
export const ASSESSMENT_FORMATS: { value: 'quiz' | 'worksheet'; label: string; hint: string }[] = [
  { value: 'quiz', label: 'Quiz', hint: 'Questions with a separate answer key' },
  { value: 'worksheet', label: 'Worksheet', hint: 'Printable sheet with name/date and teacher answer key' },
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

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api';

// Google OAuth Web-application client ID. Must be the SAME value the server
// has as GOOGLE_CLIENT_ID — that's what it verifies each ID token's audience
// against. Left unset, the Google buttons are simply not rendered and email +
// password sign-in carries on untouched.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
