import type { ContentPageData } from '../types';

// An informational guide, not a product claim. The section names are the ones
// used by the B.Ed / DIET-style formats that Indian teachers are trained on
// (also the structure server/src/lib/lessonPlanSchema.js encodes for Classroom
// Mode). The page says plainly that formats vary by institution. The worked
// example's arithmetic is checked: 5+25+5+5 = 40 minutes and 8+7+10 = 25.
export const guideLessonPlanFormat: ContentPageData = {
  kind: 'guide',
  path: '/guides/lesson-plan-format',
  title: 'Lesson Plan Format for Indian Teachers, With Example',
  description:
    'The sections of a standard lesson plan used in Indian schools — objectives, TLM, presentation, blackboard summary — with a worked Class 4 maths example.',
  h1: 'Lesson Plan Format for Indian Teachers (With a Worked Example)',
  eyebrow: 'Guide',
  navLabel: 'Lesson Plan Format',
  shortLabel: 'Lesson Plan Format',
  teaser: 'The sections of a standard lesson plan, explained with a worked example.',
  intro:
    'A good lesson plan answers three questions: what should students be able to do by the end, what will you and they do to get there, and how will you know it worked? This guide walks through the sections most Indian schools and B.Ed. programmes expect, then shows them filled in for a real 40-minute lesson.',
  published: '2026-09-19',
  updated: '2026-09-19',
  sections: [
    {
      id: 'why',
      heading: 'What a lesson plan is for',
      blocks: [
        {
          type: 'p',
          text: 'A lesson plan is not paperwork for its own sake. It is the ten minutes of thinking that stops a lesson from drifting: you decide the one thing students should leave knowing, choose an activity that gets them there, and prepare the board work and materials before the bell rings. It also makes it easy to reuse, share and improve a lesson next year.',
        },
      ],
    },
    {
      id: 'sections',
      heading: 'The sections of a standard lesson plan',
      blocks: [
        {
          type: 'p',
          text: 'Names and order vary between schools, but most Indian lesson plans contain the following:',
        },
        {
          type: 'table',
          headers: ['Section', 'What goes in it', 'Tip'],
          rows: [
            ['General details', 'Class, subject, topic, date and duration (for example, 40 minutes)', 'Write the duration down — it forces the plan to be realistic.'],
            ['Learning objectives', 'What students will be able to do by the end, phrased as outcomes', 'Use action verbs — “add”, “explain”, “identify” — not “understand”. Two to four is plenty.'],
            ['Previous knowledge', 'What students should already know for this lesson to make sense', 'Be specific about the prior concept, not just “basic maths”.'],
            ['Teaching-learning material (TLM)', 'Everything you will use: chart, objects, paper strips, blackboard', 'List only what you can actually get by tomorrow morning.'],
            ['Introduction', 'The opening question, story or demonstration that connects to what students know', 'This is the motivation, not a summary of the lesson.'],
            ['Presentation', 'The main teaching, step by step, with what the teacher does beside what students do', 'Write teacher activity and student activity for every step, with a time.'],
            ['Blackboard summary', 'Exactly what you will write on the board: headings, key terms, one worked example', 'Draft it in full; it is the part students copy.'],
            ['Recapitulation and evaluation', 'Questions that check whether the objectives were met', 'Ask questions you can answer in seconds, so you can react in the same lesson.'],
            ['Home assignment', 'A short task that practises what was taught', 'Keep it short enough to finish in 10–15 minutes.'],
          ],
        },
      ],
    },
    {
      id: 'time',
      heading: 'Splitting the time in a 40-minute period',
      blocks: [
        {
          type: 'p',
          text: 'One common split is about 5 minutes for the introduction, 25 for the presentation, 5 for recapitulation and 5 for evaluation and the home assignment. It is a starting point, not a rule — a practical lesson may need a longer presentation, and a revision lesson a longer recap.',
        },
      ],
    },
    {
      id: 'example',
      heading: 'Worked example: Class 4 Mathematics',
      blocks: [
        {
          type: 'p',
          text: 'Here is a complete plan for a 40-minute lesson on adding fractions with the same denominator. Use it as a model, not a script.',
        },
        {
          type: 'table',
          caption: 'Class 4 Mathematics — Adding fractions with like denominators (40 minutes)',
          headers: ['Section', 'Plan'],
          rows: [
            ['Learning objectives', 'Students will be able to (1) add two fractions with the same denominator, (2) explain why the denominator stays the same, and (3) solve a simple word problem using addition of like fractions.'],
            ['Previous knowledge', 'A fraction as equal parts of a whole; the words numerator and denominator; reading fractions such as 1/4 and 3/4.'],
            ['TLM', 'Blackboard and chalk; a paper strip for each pair of students; colour pencils.'],
            ['Introduction (5 min)', 'Ask: “In the morning I eat 1 quarter of a roti, and in the evening 2 quarters. How much did I eat in all?” Take a few answers without correcting them yet.'],
            ['Presentation step 1 (8 min)', 'Teacher: fold a paper strip into 4 equal parts, shade 1 part, then shade 2 more, and write 1/4 + 2/4 beside it. Students: fold their own strips, shade the same parts and count the shaded parts.'],
            ['Presentation step 2 (7 min)', 'Teacher: ask what happened to the number of equal parts, then write 1/4 + 2/4 = 3/4. Students: discuss in pairs why the bottom number did not change, and share one answer.'],
            ['Presentation step 3 (10 min)', 'Teacher: write 2/5 + 1/5, 3/8 + 4/8 and 1/7 + 3/7 on the board and walk around checking. Students: solve in notebooks, then verify with a partner using a strip or a drawing.'],
            ['Blackboard summary', 'Heading “Adding like fractions”. Rule: add the numerators, keep the denominator. Worked example: 1/4 + 2/4 = 3/4, with a small picture of the shaded strip.'],
            ['Recapitulation (5 min)', 'What do we add? What stays the same? Why?'],
            ['Evaluation and home assignment (5 min)', 'Quick check: 2/9 + 5/9. Home assignment: four short sums and one word problem — Ravi ate 2/8 of a pizza and Meena ate 3/8; how much did they eat together? (Answer: 5/8.)'],
          ],
        },
      ],
    },
    {
      id: 'variations',
      heading: 'Other formats you may be asked to use',
      blocks: [
        {
          type: 'p',
          text: 'Teacher-training colleges, DIET programmes, state boards and individual schools each have their own templates, so always follow the one you are given. Two you may meet:',
        },
        {
          type: 'ul',
          items: [
            '**Herbartian steps** — preparation, presentation, comparison, generalisation and application — common in older B.Ed. formats.',
            '**The 5E model** — Engage, Explore, Explain, Elaborate, Evaluate — often used for science lessons.',
          ],
        },
        {
          type: 'p',
          text: 'The thinking is the same in all of them: know your objective, prepare an activity that gets students there, and check that it worked.',
        },
      ],
    },
    {
      id: 'mistakes',
      heading: 'Common lesson-planning mistakes',
      blocks: [
        {
          type: 'ul',
          items: [
            '**Too many objectives.** Three objectives a lesson can achieve beat eight it cannot.',
            '**Vague objectives.** “Students will understand fractions” cannot be checked; “students will add like fractions” can.',
            '**No student activity.** A plan that lists only what the teacher does is a lecture outline.',
            '**No timings.** Without them the last (most important) part of the lesson is the part that gets cut.',
            '**Materials you do not have.** Plan around what is in your classroom, not what an ideal classroom would have.',
          ],
        },
      ],
    },
    {
      id: 'ai',
      heading: 'Drafting a plan faster with AI',
      blocks: [
        {
          type: 'p',
          text: 'If you would like a first draft to react to, SarasTech’s [AI lesson plan generator](/ai-lesson-plan-generator) can produce one from a topic, grade and subject in your own language, which you then edit to match your school’s format. Read our guide on [using AI for lesson planning](/guides/how-to-use-ai-for-lesson-planning) first — it explains how to ask well and how to check what comes back.',
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'How many learning objectives should a lesson plan have?',
      answer:
        'Usually two to four for a single 30–45 minute lesson. Each should describe something students can do and that you can check before the lesson ends.',
    },
    {
      question: 'What is the difference between a lesson plan and a unit plan?',
      answer:
        'A lesson plan covers one class period. A unit plan covers a whole topic across several periods and breaks it into the individual lessons.',
    },
    {
      question: 'What is TLM in a lesson plan?',
      answer:
        'TLM stands for teaching-learning material: the charts, objects, models, worksheets and board work you use to teach the lesson.',
    },
    {
      question: 'Do I have to use this exact format?',
      answer:
        'No. This is a common structure, but your school, board or training institution may prescribe its own. Use the required format and treat this guide as a way to think through each part.',
    },
  ],
  related: ['/ai-lesson-plan-generator', '/guides/how-to-use-ai-for-lesson-planning', '/guides/multigrade-classroom-teaching'],
  cta: {
    heading: 'Want a first draft to work from?',
    text: 'Create a teacher account and turn your topic into a lesson plan you can edit and print.',
  },
  appPath: '/',
  appLabel: 'Open the Coach',
};
