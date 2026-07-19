import type { Role, ResponseStyle } from './types';

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

export const EXAMPLE_QUESTIONS = [
  'How do I manage a noisy multi-grade classroom?',
  'Simple way to explain fractions to Class 3 students?',
  'Activities to teach English with no textbooks?',
  'How to keep students engaged in a large class?',
  'Quick assessment ideas for a science lesson?',
];

export const MAX_QUERY_LENGTH = 500;

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
