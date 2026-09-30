// Coach/Home welcome experience: time-based greeting, special-day priority and a deterministic Daily Highlight. The large
// data tables live in lib/specialDays.ts and lib/dailyContent.ts. Everything is a pure function of a `Date` (no
// Math.random), so the same date gives the same result and tests only pass in a fixed Date.

import { getSpecialDay, type SpecialDay } from './specialDays';
import { getDailyFact, KIND_META, type DailyFact } from './dailyContent';

export type { SpecialDay } from './specialDays';
export { getSpecialDay } from './specialDays';
export type { DailyFact } from './dailyContent';
export { getDailyFact } from './dailyContent';

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

interface GreetingPeriodConfig {
  key: GreetingPeriod;
  label: string;
  startHour: number; // inclusive, 24h local time
  endHour: number; // exclusive
}

// Ordered, non-wrapping ranges; anything uncovered (21:00–04:59) is night via getGreetingPeriod's fallback.
const GREETING_PERIODS: GreetingPeriodConfig[] = [
  { key: 'morning', label: 'Good morning', startHour: 5, endHour: 12 },
  { key: 'afternoon', label: 'Good afternoon', startHour: 12, endHour: 17 },
  { key: 'evening', label: 'Good evening', startHour: 17, endHour: 21 },
];
const NIGHT_LABEL = 'Good night';

export function getGreetingPeriod(date: Date = new Date()): GreetingPeriod {
  const hour = date.getHours();
  return GREETING_PERIODS.find((p) => hour >= p.startHour && hour < p.endHour)?.key ?? 'night';
}

function greetingLabel(period: GreetingPeriod): string {
  return GREETING_PERIODS.find((p) => p.key === period)?.label ?? NIGHT_LABEL;
}

// Rotating subtitle, chosen by day-of-year modulo length so it's stable all day. The one place that selection is still
// used: these are interchangeable sentences, unlike the Daily Highlight (lib/dailyContent.ts), which is keyed by month/day.
const SUBTITLES: string[] = [
  'Ready to make learning more engaging today?',
  'What are we teaching today?',
  "Let's make today's lesson a little easier.",
  'How can I help you teach today?',
];

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diffMs = date.getTime() - start.getTime();
  return Math.floor(diffMs / 86_400_000);
}

export function getSubtitle(date: Date = new Date()): string {
  return SUBTITLES[dayOfYear(date) % SUBTITLES.length];
}

// ---- Combined view models ----

export interface WelcomeGreeting {
  /** e.g. "Good morning, Asha 👋" */
  greeting: string;
  /** Special-day greeting takes priority over the rotating subtitle. */
  subtitle: string;
}

export function getWelcomeGreeting(name: string, date: Date = new Date()): WelcomeGreeting {
  const label = greetingLabel(getGreetingPeriod(date));
  const special = getSpecialDay(date);
  return {
    greeting: `${label}${name ? `, ${name}` : ''} 👋`,
    subtitle: special ? special.greeting : getSubtitle(date),
  };
}

export interface WelcomeHighlight {
  kind: 'special' | 'fact' | 'thought';
  emoji: string;
  /** Small eyebrow label, e.g. "Today's Highlight" / "Fact of the Day". */
  eyebrow: string;
  /** One-line summary shown on the (deliberately unobtrusive) card. */
  summary: string;
  /** Title shown in the detail view when the card is opened. */
  detailTitle: string;
  /** Fuller body shown in the detail view. May contain multiple '\n\n'-separated paragraphs. */
  detailBody: string;
}

function fromSpecialDay(special: SpecialDay): WelcomeHighlight {
  return {
    kind: 'special',
    emoji: special.emoji,
    eyebrow: "Today's Highlight",
    summary: special.highlightTitle,
    detailTitle: `${special.emoji} ${special.label}`,
    detailBody: special.detailBody,
  };
}

function fromDailyFact(fact: DailyFact): WelcomeHighlight {
  const meta = KIND_META[fact.kind];
  return {
    kind: fact.kind,
    emoji: meta.emoji,
    eyebrow: meta.eyebrow,
    summary: fact.summary,
    detailTitle: `${meta.emoji} ${meta.eyebrow}`,
    detailBody: fact.detailBody,
  };
}

// Special-day content always wins over a normal fact/thought; only one highlight is shown (see getSpecialDay and getDailyFact).
export function getDailyHighlight(date: Date = new Date()): WelcomeHighlight {
  const special = getSpecialDay(date);
  if (special) return fromSpecialDay(special);
  return fromDailyFact(getDailyFact(date));
}
