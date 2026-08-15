// Festival / national-day / international-day content for the Coach welcome
// screen's Daily Highlight. Split from welcome.ts (which owns the greeting
// and priority logic) purely because this table is large — see
// lib/dailyContent.ts for the same split applied to the everyday
// fact/thought table.
//
// Two kinds of date, two tables:
//
// - FIXED_SPECIAL_DAYS: days that fall on the same Gregorian month/day every
//   year (national days, solar-calendar harvest festivals, Christmas).
//   Matched by month/day only — no year — so one entry covers every year
//   forever with zero yearly maintenance.
//
// - YEAR_SPECIFIC_SPECIAL_DAYS: festivals whose date is set by a lunar or
//   lunisolar calendar (or, for the two Eids, by moon sighting) and so moves
//   on the Gregorian calendar from year to year. These are NEVER guessed as
//   a fixed month/day — each entry is only valid for the specific year it is
//   filed under. See the comment above that table for sourcing/accuracy
//   notes and how to extend it.

export interface SpecialDay {
  id: string;
  month: number; // 1-12
  day: number;
  emoji: string;
  label: string;
  /** Subtitle shown under the greeting on this day, replacing the rotating subtitle. */
  greeting: string;
  /** Short line shown on the Daily Highlight card, e.g. "15 August · India's Independence Day". */
  highlightTitle: string;
  /** Fuller, teacher-facing context shown in the highlight detail view. Paragraphs separated by '\n\n'. */
  detailBody: string;
}

// ---- Fixed-date special days ------------------------------------------------
//
// Extend by appending an entry — getSpecialDay below needs no changes.
export const FIXED_SPECIAL_DAYS: SpecialDay[] = [
  {
    id: 'makar-sankranti',
    month: 1,
    day: 14,
    emoji: '🪁',
    label: 'Makar Sankranti',
    greeting: 'Happy Makar Sankranti! 🪁',
    highlightTitle: '14 January · Makar Sankranti',
    detailBody:
      "Makar Sankranti marks the sun's transition into Capricorn and the start of longer days — one of the few Indian festivals tied to the solar calendar, which is why it falls on (almost) the same date every year. It is celebrated as Pongal in Tamil Nadu, Uttarayan in Gujarat, and Bihu in Assam.\n\n"
      + 'For teachers: A natural entry point into the solstice, the seasons, or how different regions of India mark the same astronomical event with different names and customs.',
  },
  {
    id: 'republic-day',
    month: 1,
    day: 26,
    emoji: '🇮🇳',
    label: 'Republic Day',
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
    id: 'ambedkar-jayanti',
    month: 4,
    day: 14,
    emoji: '📖',
    label: 'Ambedkar Jayanti',
    greeting: "Remembering Dr. B.R. Ambedkar's contribution to India today.",
    highlightTitle: '14 April · Ambedkar Jayanti',
    detailBody:
      "Ambedkar Jayanti marks the birth anniversary of Dr. B.R. Ambedkar, chief architect of the Indian Constitution and a lifelong campaigner for social justice and equal rights.\n\n"
      + 'For teachers: A meaningful day to discuss equality, the Constitution, and the value of education as a tool for social change — Dr. Ambedkar himself was a strong advocate for it.',
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
      "World Environment Day is the UN's flagship day for encouraging awareness and action for the protection of the environment.\n\n"
      + 'For teachers: Consider a lesson tie-in on sustainability, local ecosystems, or a class pledge/activity around reducing waste.',
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
      "5 September is celebrated as Teachers' Day in India, on the birth anniversary of Dr. Sarvepalli Radhakrishnan — philosopher, and independent India's first Vice President and second President.\n\n"
      + 'A day to be celebrated, not just to celebrate — thank you for the work you put in every day.',
  },
  {
    id: 'gandhi-jayanti',
    month: 10,
    day: 2,
    emoji: '🕊️',
    label: 'Gandhi Jayanti',
    greeting: 'Gandhi Jayanti — remembering the power of truth and non-violence.',
    highlightTitle: '2 October · Gandhi Jayanti',
    detailBody:
      "Gandhi Jayanti marks the birth anniversary of Mahatma Gandhi, leader of India's non-violent independence movement, and is observed globally as the International Day of Non-Violence.\n\n"
      + 'For teachers: A good day for a class discussion on non-violence, civic responsibility, and how small, everyday choices add up to character.',
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
    id: 'christmas',
    month: 12,
    day: 25,
    emoji: '🎄',
    label: 'Christmas',
    greeting: 'Merry Christmas! 🎄',
    highlightTitle: '25 December · Christmas',
    detailBody:
      "Christmas commemorates the birth of Jesus Christ and is celebrated worldwide, including by India's sizeable Christian community, with traditions of gift-giving, carols and family gatherings.\n\n"
      + 'For teachers: A gentle opportunity to talk about how different communities celebrate the winter season, alongside Indian festivals from the same time of year.',
  },
];

// ---- Movable (lunar / lunisolar / moon-sighting) festivals ------------------
//
// These do NOT get a fixed month/day: their Gregorian date shifts from year
// to year, so a "14 March every year" style entry would be wrong most years.
// Instead each year gets its own array of dated entries, filed under that
// year's key. A year with no entry here simply falls through to the normal
// daily fact/thought for every date in it — see getSpecialDay below — rather
// than showing a guessed or incorrect festival date.
//
// SOURCING / ACCURACY: dates below follow published Indian festival
// calendars for 2025 and 2026. The two Eids are additionally subject to
// local moon sighting and can shift by a day within India itself — treat
// them (and, to a lesser extent, the other lunar dates) as best-effort, not
// guaranteed to the day. Verify against an official calendar before relying
// on this for anything beyond the Coach welcome screen.
//
// MAINTENANCE: once each year's calendar is out, add a new `YYYY: [...]`
// entry below — nothing else in this file or in welcome.ts needs to change.
// Deliberately no entries beyond 2026 (this module's authoring date) rather
// than guessing years further out.
export const YEAR_SPECIFIC_SPECIAL_DAYS: Record<number, SpecialDay[]> = {
  2025: [
    {
      id: 'holi-2025',
      month: 3,
      day: 14,
      emoji: '🌈',
      label: 'Holi',
      greeting: 'Happy Holi! 🌈',
      highlightTitle: '14 March 2025 · Holi',
      detailBody:
        "Holi, the festival of colours, celebrates the arrival of spring and the triumph of good over evil, marked by the story of Prahlad and Holika.\n\n"
        + 'For teachers: A colourful hook for a lesson on spring/seasons, pigments and colour, or simply a class discussion on festivals that mark the turn of a season.',
    },
    {
      id: 'eid-al-fitr-2025',
      month: 3,
      day: 31,
      emoji: '🌙',
      label: 'Eid al-Fitr',
      greeting: 'Eid Mubarak! 🌙',
      highlightTitle: '31 March 2025 · Eid al-Fitr',
      detailBody:
        'Eid al-Fitr marks the end of the fasting month of Ramadan, celebrated with prayer, charity and family gatherings.\n\n'
        + 'For teachers: A good moment to talk about the lunar Islamic calendar and why its festivals move each year on the Gregorian calendar.',
    },
    {
      id: 'mahavir-jayanti-2025',
      month: 4,
      day: 10,
      emoji: '☸️',
      label: 'Mahavir Jayanti',
      greeting: 'Mahavir Jayanti — a day of peace and non-violence.',
      highlightTitle: '10 April 2025 · Mahavir Jayanti',
      detailBody:
        'Mahavir Jayanti marks the birth of Lord Mahavira, the 24th Jain Tirthankara, whose teachings centre on non-violence (ahimsa) and truth.\n\n'
        + 'For teachers: Pairs naturally with a discussion of Gandhi Jayanti (2 October) on the shared theme of non-violence across Indian traditions.',
    },
    {
      id: 'buddha-purnima-2025',
      month: 5,
      day: 12,
      emoji: '☸️',
      label: 'Buddha Purnima',
      greeting: 'Buddha Purnima — a day of peace and reflection.',
      highlightTitle: '12 May 2025 · Buddha Purnima',
      detailBody:
        "Buddha Purnima marks the birth, enlightenment and passing of Gautama Buddha, all traditionally believed to have occurred on this full-moon day.\n\n"
        + 'For teachers: A good opening for a short reflection or mindfulness exercise with older students, or a geography/history link to the spread of Buddhism from India across Asia.',
    },
    {
      id: 'eid-al-adha-2025',
      month: 6,
      day: 7,
      emoji: '🌙',
      label: 'Eid al-Adha',
      greeting: 'Eid Mubarak! 🌙',
      highlightTitle: '7 June 2025 · Eid al-Adha',
      detailBody:
        'Eid al-Adha, the "festival of sacrifice", commemorates Ibrahim\'s willingness to obey God and is marked with prayer and charitable giving to those in need.\n\n'
        + 'For teachers: A useful example when teaching how different calendars (solar vs. lunar) place festivals differently within the Gregorian year.',
    },
    {
      id: 'raksha-bandhan-2025',
      month: 8,
      day: 9,
      emoji: '🧵',
      label: 'Raksha Bandhan',
      greeting: 'Happy Raksha Bandhan! 🧵',
      highlightTitle: '9 August 2025 · Raksha Bandhan',
      detailBody:
        'Raksha Bandhan celebrates the bond between siblings, marked by tying a rakhi (thread) as a symbol of protection and care.\n\n'
        + 'For teachers: A gentle classroom discussion starter on family bonds, responsibility, and traditions that mark relationships rather than events.',
    },
    {
      id: 'janmashtami-2025',
      month: 8,
      day: 16,
      emoji: '🪈',
      label: 'Janmashtami',
      greeting: 'Happy Janmashtami! 🪈',
      highlightTitle: '16 August 2025 · Janmashtami',
      detailBody:
        'Janmashtami celebrates the birth of Lord Krishna, marked with fasting, midnight prayers, and dahi handi (human-pyramid pot-breaking) events in many states.\n\n'
        + 'For teachers: The dahi handi tradition itself is a fun, real-world example of teamwork and balance — a light classroom talking point.',
    },
    {
      id: 'ganesh-chaturthi-2025',
      month: 8,
      day: 27,
      emoji: '🐘',
      label: 'Ganesh Chaturthi',
      greeting: 'Happy Ganesh Chaturthi! 🐘',
      highlightTitle: '27 August 2025 · Ganesh Chaturthi',
      detailBody:
        'Ganesh Chaturthi celebrates the birth of Lord Ganesha and is marked, especially in Maharashtra, by installing clay idols that are later immersed in water.\n\n'
        + 'For teachers: A good link to environmental science — many communities now specifically choose eco-friendly, biodegradable idols to reduce water pollution.',
    },
    {
      id: 'onam-2025',
      month: 9,
      day: 5,
      emoji: '🌼',
      label: 'Onam',
      greeting: 'Happy Onam! 🌼',
      highlightTitle: '5 September 2025 · Onam',
      detailBody:
        "Onam is Kerala's harvest festival, commemorating the mythical King Mahabali, and is marked with flower rangolis (pookalam), boat races and a grand feast (Onam sadya).\n\n"
        + 'For teachers: A colourful example of a regional harvest festival — a good pairing with Makar Sankranti/Pongal when discussing how India marks the harvest season differently across states.',
    },
    {
      id: 'dussehra-2025',
      month: 10,
      day: 2,
      emoji: '🏹',
      label: 'Dussehra',
      greeting: 'Happy Dussehra! 🏹',
      highlightTitle: '2 October 2025 · Dussehra (Vijayadashami)',
      detailBody:
        "Dussehra marks Lord Rama's victory over Ravana, celebrated with the burning of effigies, and also marks the end of Navratri's celebration of the goddess Durga.\n\n"
        + 'For teachers: A natural entry point for the Ramayana, or a broader discussion on stories across cultures that centre good triumphing over evil.',
    },
    {
      id: 'diwali-2025',
      month: 10,
      day: 20,
      emoji: '🪔',
      label: 'Diwali',
      greeting: 'Happy Diwali! 🪔',
      highlightTitle: '20 October 2025 · Diwali',
      detailBody:
        "Diwali, the festival of lights, celebrates the return of Lord Rama to Ayodhya and, more broadly, the victory of light over darkness and knowledge over ignorance.\n\n"
        + 'For teachers: A good moment for a class activity on light and shadow (physics), or a discussion on gratitude and giving, both central Diwali themes.',
    },
    {
      id: 'guru-nanak-jayanti-2025',
      month: 11,
      day: 5,
      emoji: '☬',
      label: 'Guru Nanak Jayanti',
      greeting: 'Guru Nanak Jayanti — a day of humility and service.',
      highlightTitle: '5 November 2025 · Guru Nanak Jayanti',
      detailBody:
        'Guru Nanak Jayanti marks the birth of Guru Nanak, founder of Sikhism, whose teachings emphasise equality, honest work and selfless service (seva).\n\n'
        + 'For teachers: The langar (free community kitchen) tradition is a strong, concrete example of community service for a classroom discussion on values.',
    },
  ],
  2026: [
    {
      id: 'holi-2026',
      month: 3,
      day: 4,
      emoji: '🌈',
      label: 'Holi',
      greeting: 'Happy Holi! 🌈',
      highlightTitle: '4 March 2026 · Holi',
      detailBody:
        "Holi, the festival of colours, celebrates the arrival of spring and the triumph of good over evil, marked by the story of Prahlad and Holika.\n\n"
        + 'For teachers: A colourful hook for a lesson on spring/seasons, pigments and colour, or simply a class discussion on festivals that mark the turn of a season.',
    },
    {
      id: 'eid-al-fitr-2026',
      month: 3,
      day: 20,
      emoji: '🌙',
      label: 'Eid al-Fitr',
      greeting: 'Eid Mubarak! 🌙',
      highlightTitle: '20 March 2026 · Eid al-Fitr (approximate)',
      detailBody:
        "Eid al-Fitr marks the end of the fasting month of Ramadan, celebrated with prayer, charity and family gatherings. Its exact date depends on the sighting of the new moon and can shift by a day.\n\n"
        + 'For teachers: A good moment to talk about the lunar Islamic calendar and why its festivals move each year on the Gregorian calendar.',
    },
    {
      id: 'mahavir-jayanti-2026',
      month: 3,
      day: 31,
      emoji: '☸️',
      label: 'Mahavir Jayanti',
      greeting: 'Mahavir Jayanti — a day of peace and non-violence.',
      highlightTitle: '31 March 2026 · Mahavir Jayanti',
      detailBody:
        'Mahavir Jayanti marks the birth of Lord Mahavira, the 24th Jain Tirthankara, whose teachings centre on non-violence (ahimsa) and truth.\n\n'
        + 'For teachers: Pairs naturally with a discussion of Gandhi Jayanti (2 October) on the shared theme of non-violence across Indian traditions.',
    },
    {
      id: 'buddha-purnima-2026',
      month: 5,
      day: 1,
      emoji: '☸️',
      label: 'Buddha Purnima',
      greeting: 'Buddha Purnima — a day of peace and reflection.',
      highlightTitle: '1 May 2026 · Buddha Purnima',
      detailBody:
        'Buddha Purnima marks the birth, enlightenment and passing of Gautama Buddha, all traditionally believed to have occurred on this full-moon day.\n\n'
        + 'For teachers: A good opening for a short reflection or mindfulness exercise with older students, or a geography/history link to the spread of Buddhism from India across Asia.',
    },
    {
      id: 'eid-al-adha-2026',
      month: 5,
      day: 27,
      emoji: '🌙',
      label: 'Eid al-Adha',
      greeting: 'Eid Mubarak! 🌙',
      highlightTitle: '27 May 2026 · Eid al-Adha (approximate)',
      detailBody:
        "Eid al-Adha, the \"festival of sacrifice\", commemorates Ibrahim's willingness to obey God and is marked with prayer and charitable giving to those in need. Like Eid al-Fitr, its exact date depends on moon sighting.\n\n"
        + 'For teachers: A useful example when teaching how different calendars (solar vs. lunar) place festivals differently within the Gregorian year.',
    },
    {
      id: 'raksha-bandhan-2026',
      month: 8,
      day: 28,
      emoji: '🧵',
      label: 'Raksha Bandhan',
      greeting: 'Happy Raksha Bandhan! 🧵',
      highlightTitle: '28 August 2026 · Raksha Bandhan',
      detailBody:
        'Raksha Bandhan celebrates the bond between siblings, marked by tying a rakhi (thread) as a symbol of protection and care.\n\n'
        + 'For teachers: A gentle classroom discussion starter on family bonds, responsibility, and traditions that mark relationships rather than events.',
    },
    {
      id: 'janmashtami-2026',
      month: 9,
      day: 4,
      emoji: '🪈',
      label: 'Janmashtami',
      greeting: 'Happy Janmashtami! 🪈',
      highlightTitle: '4 September 2026 · Janmashtami',
      detailBody:
        'Janmashtami celebrates the birth of Lord Krishna, marked with fasting, midnight prayers, and dahi handi (human-pyramid pot-breaking) events in many states.\n\n'
        + 'For teachers: The dahi handi tradition itself is a fun, real-world example of teamwork and balance — a light classroom talking point.',
    },
    {
      id: 'onam-2026',
      month: 8,
      day: 26,
      emoji: '🌼',
      label: 'Onam',
      greeting: 'Happy Onam! 🌼',
      highlightTitle: '26 August 2026 · Onam (approximate)',
      detailBody:
        "Onam is Kerala's harvest festival, commemorating the mythical King Mahabali, and is marked with flower rangolis (pookalam), boat races and a grand feast (Onam sadya).\n\n"
        + 'For teachers: A colourful example of a regional harvest festival — a good pairing with Makar Sankranti/Pongal when discussing how India marks the harvest season differently across states.',
    },
    {
      id: 'ganesh-chaturthi-2026',
      month: 9,
      day: 14,
      emoji: '🐘',
      label: 'Ganesh Chaturthi',
      greeting: 'Happy Ganesh Chaturthi! 🐘',
      highlightTitle: '14 September 2026 · Ganesh Chaturthi',
      detailBody:
        'Ganesh Chaturthi celebrates the birth of Lord Ganesha and is marked, especially in Maharashtra, by installing clay idols that are later immersed in water.\n\n'
        + 'For teachers: A good link to environmental science — many communities now specifically choose eco-friendly, biodegradable idols to reduce water pollution.',
    },
    {
      id: 'dussehra-2026',
      month: 10,
      day: 20,
      emoji: '🏹',
      label: 'Dussehra',
      greeting: 'Happy Dussehra! 🏹',
      highlightTitle: '20 October 2026 · Dussehra (Vijayadashami)',
      detailBody:
        "Dussehra marks Lord Rama's victory over Ravana, celebrated with the burning of effigies, and also marks the end of Navratri's celebration of the goddess Durga.\n\n"
        + 'For teachers: A natural entry point for the Ramayana, or a broader discussion on stories across cultures that centre good triumphing over evil.',
    },
    {
      id: 'diwali-2026',
      month: 11,
      day: 8,
      emoji: '🪔',
      label: 'Diwali',
      greeting: 'Happy Diwali! 🪔',
      highlightTitle: '8 November 2026 · Diwali (approximate)',
      detailBody:
        "Diwali, the festival of lights, celebrates the return of Lord Rama to Ayodhya and, more broadly, the victory of light over darkness and knowledge over ignorance.\n\n"
        + 'For teachers: A good moment for a class activity on light and shadow (physics), or a discussion on gratitude and giving, both central Diwali themes.',
    },
    {
      id: 'guru-nanak-jayanti-2026',
      month: 11,
      day: 24,
      emoji: '☬',
      label: 'Guru Nanak Jayanti',
      greeting: 'Guru Nanak Jayanti — a day of humility and service.',
      highlightTitle: '24 November 2026 · Guru Nanak Jayanti (approximate)',
      detailBody:
        'Guru Nanak Jayanti marks the birth of Guru Nanak, founder of Sikhism, whose teachings emphasise equality, honest work and selfless service (seva).\n\n'
        + 'For teachers: The langar (free community kitchen) tradition is a strong, concrete example of community service for a classroom discussion on values.',
    },
  ],
};

// Fixed days are checked first: they are unambiguous (no moon-sighting or
// regional variation), and a handful of them are civic/national days that
// should never be silently displaced by a movable festival landing on the
// same date in a given year.
export function getSpecialDay(date: Date = new Date()): SpecialDay | null {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const fixed = FIXED_SPECIAL_DAYS.find((s) => s.month === month && s.day === day);
  if (fixed) return fixed;
  const year = date.getFullYear();
  return YEAR_SPECIFIC_SPECIAL_DAYS[year]?.find((s) => s.month === month && s.day === day) ?? null;
}
