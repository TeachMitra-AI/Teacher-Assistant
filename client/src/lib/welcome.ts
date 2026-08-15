// Dynamic Coach/Home welcome experience: time-based greeting, special-day
// awareness, and a deterministic "Daily Highlight". All content lives in the
// data tables below (SPECIAL_DAYS / DAILY_FACTS / SUBTITLES) — adding a new
// event or fact is a one-line append, never a change to the functions that
// read them. Everything here is a pure function of a `Date`, so the same
// date always produces the same greeting/highlight (no Math.random(), no
// per-render drift) and the whole module is trivially unit-testable without
// mocking the clock beyond passing in a fixed Date.

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

interface GreetingPeriodConfig {
  key: GreetingPeriod;
  label: string;
  startHour: number; // inclusive, 24h local time
  endHour: number; // exclusive
}

// Ordered, non-wrapping ranges; anything not covered (21:00–04:59) is night —
// see getGreetingPeriod's fallback rather than a fourth wrapping range here.
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

// Rotating subtitle set. Selection is deterministic (day-of-year modulo
// length), not random, so the subtitle is stable for the whole day and only
// changes date to date.
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

function pickByDay<T>(items: T[], date: Date): T {
  return items[dayOfYear(date) % items.length];
}

// ---- Special days ----------------------------------------------------------
//
// Matched by month/day only (no year), so the same entry recurs every year
// with no maintenance. Extend by appending an entry here — no other code
// needs to change.
export interface SpecialDay {
  id: string;
  month: number; // 1-12
  day: number;
  emoji: string;
  label: string;
  /** Subtitle shown under the greeting on this day, replacing the rotating SUBTITLES pick. */
  greeting: string;
  /** Short line shown on the Daily Highlight card, e.g. "15 August · India's Independence Day". */
  highlightTitle: string;
  /** Fuller, teacher-facing context shown in the highlight detail view. */
  detailBody: string;
}

export const SPECIAL_DAYS: SpecialDay[] = [
  {
    id: 'republic-day',
    month: 1,
    day: 26,
    emoji: '🇮🇳',
    label: "Republic Day",
    greeting: 'Wishing you a proud Republic Day! 🇮🇳',
    highlightTitle: "26 January · India's Republic Day",
    detailBody:
      "26 January marks the day India's Constitution came into effect in 1950, completing its transition to a sovereign republic.\n\n"
      + 'For teachers: A good day to talk about the Constitution, fundamental rights and duties, and what democracy asks of every citizen — including students.',
  },
  {
    id: 'womens-day',
    month: 3,
    day: 8,
    emoji: '💜',
    label: "International Women's Day",
    greeting: "Happy International Women's Day! 💜",
    highlightTitle: "8 March · International Women's Day",
    detailBody:
      "International Women's Day celebrates the achievements of women and calls for continued progress toward equality.\n\n"
      + 'For teachers: A chance to highlight women scientists, leaders and role models across your subject, and to talk about equal opportunity in the classroom.',
  },
  {
    id: 'independence-day',
    month: 8,
    day: 15,
    emoji: '🇮🇳',
    label: "India's Independence Day",
    greeting: 'Wishing you a meaningful Independence Day! 🇮🇳',
    highlightTitle: "15 August · India's Independence Day",
    detailBody:
      "15 August marks India's independence from British rule in 1947.\n\n"
      + "For teachers: You can use today as an opportunity to discuss India's freedom movement, civic responsibility, democracy and the importance of contributing to society.",
  },
  {
    id: 'teachers-day',
    month: 9,
    day: 5,
    emoji: '🍎',
    label: "Teachers' Day",
    greeting: "Happy Teachers' Day — thank you for everything you do! 🍎",
    highlightTitle: "5 September · Teachers' Day",
    detailBody:
      "Teachers' Day, observed on the birth anniversary of Dr. Sarvepalli Radhakrishnan, honours the role teachers play in shaping students' lives.\n\n"
      + 'A day to be celebrated, not just to celebrate — thank you for the work you put in every day.',
  },
  {
    id: 'childrens-day',
    month: 11,
    day: 14,
    emoji: '🎈',
    label: "Children's Day",
    greeting: "Happy Children's Day! 🎈",
    highlightTitle: "14 November · India's Children's Day",
    detailBody:
      "Children's Day, marked on Jawaharlal Nehru's birthday, celebrates children and renews focus on their rights, education and wellbeing.\n\n"
      + 'For teachers: A good day for a lighter, activity-based lesson, or a class discussion on what students hope to become.',
  },
  {
    id: 'world-science-day',
    month: 11,
    day: 10,
    emoji: '🔬',
    label: 'World Science Day for Peace and Development',
    greeting: 'Happy World Science Day! 🔬',
    highlightTitle: '10 November · World Science Day',
    detailBody:
      'World Science Day highlights the role science plays in society and encourages public engagement with it.\n\n'
      + 'For teachers: A natural hook for a hands-on demo, a "science in the news" discussion, or a quick project idea.',
  },
  {
    id: 'environment-day',
    month: 6,
    day: 5,
    emoji: '🌍',
    label: 'World Environment Day',
    greeting: 'Happy World Environment Day! 🌍',
    highlightTitle: '5 June · World Environment Day',
    detailBody:
      'World Environment Day is the UN\'s flagship day for encouraging awareness and action for the protection of the environment.\n\n'
      + 'For teachers: Consider a lesson tie-in on sustainability, local ecosystems, or a class pledge/activity around reducing waste.',
  },
];

export function getSpecialDay(date: Date = new Date()): SpecialDay | null {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return SPECIAL_DAYS.find((s) => s.month === month && s.day === day) ?? null;
}

// ---- Daily fact / thought of the day ---------------------------------------
//
// Shown on a normal (non-special) day. Selection is deterministic by
// day-of-year, so it is stable across the session and only changes at
// midnight. Extend by appending an entry — order doesn't matter.
export interface DailyFact {
  id: string;
  kind: 'fact' | 'thought';
  eyebrow: string; // "Fact of the Day" | "Thought of the Day"
  emoji: string;
  /** Short line shown on the card. */
  summary: string;
  /** Fuller explanation shown in the detail view. */
  detailBody: string;
}

export const DAILY_FACTS: DailyFact[] = [
  {
    id: 'photosynthesis',
    kind: 'fact',
    eyebrow: 'Fact of the Day',
    emoji: '✨',
    summary: 'Plants produce oxygen during photosynthesis.',
    detailBody:
      'Plants convert sunlight, water and carbon dioxide into glucose and oxygen. The oxygen released is what most life on Earth depends on to breathe.\n\n'
      + 'For teachers: A simple entry point into food chains, cellular respiration, or a "why do we plant trees" classroom discussion.',
  },
  {
    id: 'learning-styles',
    kind: 'thought',
    eyebrow: 'Thought of the Day',
    emoji: '💡',
    summary: 'Every child learns differently. Great teaching starts by noticing how.',
    detailBody:
      'Some students grasp an idea fastest through a story, others through a diagram, others by trying it themselves.\n\n'
      + 'For teachers: When a concept isn\'t landing, try changing the format before you assume the student isn\'t trying.',
  },
  {
    id: 'water-cycle',
    kind: 'fact',
    eyebrow: 'Fact of the Day',
    emoji: '✨',
    summary: 'A single water molecule can spend thousands of years in the ocean before evaporating.',
    detailBody:
      'Water continuously moves between oceans, the atmosphere and land through evaporation, condensation and precipitation — the water cycle.\n\n'
      + 'For teachers: Useful when introducing the water cycle, or as a hook into how long-term Earth systems actually operate.',
  },
  {
    id: 'mistakes',
    kind: 'thought',
    eyebrow: 'Thought of the Day',
    emoji: '💡',
    summary: 'A mistake explained well teaches more than a right answer given quickly.',
    detailBody:
      'When a student gets something wrong, the "why" behind the mistake is often more instructive than the correct answer itself.\n\n'
      + 'For teachers: Where time allows, ask a student to explain their reasoning before correcting it — the error usually points straight at the gap.',
  },
  {
    id: 'honey',
    kind: 'fact',
    eyebrow: 'Fact of the Day',
    emoji: '✨',
    summary: 'Honey found in ancient Egyptian tombs is still edible today.',
    detailBody:
      "Honey's low moisture content and natural acidity make it inhospitable to bacteria, so it essentially never spoils if sealed properly.\n\n"
      + 'For teachers: A fun way into a lesson on preservatives, microbiology, or simply "why do some foods go bad and others don\'t?"',
  },
  {
    id: 'questions',
    kind: 'thought',
    eyebrow: 'Thought of the Day',
    emoji: '💡',
    summary: 'A classroom where students feel safe to ask "why" is already halfway to learning.',
    detailBody:
      'Curiosity drops fast when a question feels risky to ask. Students who feel safe asking "why" tend to retain more, not less.\n\n'
      + 'For teachers: Praising a good question as much as a good answer costs nothing and compounds over the year.',
  },
  {
    id: 'gravity',
    kind: 'fact',
    eyebrow: 'Fact of the Day',
    emoji: '✨',
    summary: 'You weigh very slightly less at the equator than at the poles.',
    detailBody:
      "Earth bulges slightly at the equator and spins fastest there, both of which slightly reduce the effective pull of gravity you feel.\n\n"
      + 'For teachers: A good surprise fact to open a unit on gravity, or on how Earth\'s shape isn\'t a perfect sphere.',
  },
  {
    id: 'feedback',
    kind: 'thought',
    eyebrow: 'Thought of the Day',
    emoji: '💡',
    summary: 'Specific feedback beats praise. "Nice work" teaches less than "this step was clear."',
    detailBody:
      'General praise feels good but gives a student nothing to repeat. Naming the specific thing that worked is what actually reinforces it.\n\n'
      + 'For teachers: Try replacing one "good job" a day with one sentence about exactly what was good.',
  },
];

export function getDailyFact(date: Date = new Date()): DailyFact {
  return pickByDay(DAILY_FACTS, date);
}

export function getSubtitle(date: Date = new Date()): string {
  return pickByDay(SUBTITLES, date);
}

// ---- Combined view models ---------------------------------------------------

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
  /** Fuller body shown in the detail view. May contain multiple '\n'-separated paragraphs. */
  detailBody: string;
}

// Special-day content always wins over a normal fact/thought — see
// docs/SPECIAL-DAY-PRIORITY in the task brief: only one highlight is ever
// shown, never both.
export function getDailyHighlight(date: Date = new Date()): WelcomeHighlight {
  const special = getSpecialDay(date);
  if (special) {
    return {
      kind: 'special',
      emoji: special.emoji,
      eyebrow: "Today's Highlight",
      summary: special.highlightTitle,
      detailTitle: `${special.emoji} ${special.label}`,
      detailBody: special.detailBody,
    };
  }
  const fact = getDailyFact(date);
  return {
    kind: fact.kind,
    emoji: fact.emoji,
    eyebrow: fact.eyebrow,
    summary: fact.summary,
    detailTitle: `${fact.emoji} ${fact.eyebrow}`,
    detailBody: fact.detailBody,
  };
}
