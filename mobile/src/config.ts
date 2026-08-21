import { NotebookPen, Target, ClipboardCheck, Lightbulb, FileText, type LucideIcon } from 'lucide-react-native';
import type { ResourceType } from './types';

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
