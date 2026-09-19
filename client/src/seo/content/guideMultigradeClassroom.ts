import type { ContentPageData } from '../types';

// General pedagogy for a common Indian situation. The product tie-ins are the
// real ones: classroom type "Multi-Grade" (config.ts CLASSROOM_TYPES), the
// Coach's dedicated multi-grade guidance (server/src/prompts.js
// multiGradeTeaching), the Generator's difficulty picker and the Workspace's
// "Adapt for another grade" action. No statistics are quoted.
export const guideMultigradeClassroom: ContentPageData = {
  kind: 'guide',
  path: '/guides/multigrade-classroom-teaching',
  title: 'Multigrade Classroom Teaching: Practical Strategies | SarasTech',
  description:
    'How to teach two or more grades at once: a 30-minute lesson structure, peer learning, task cards, quick assessment and how to prepare multi-level materials.',
  h1: 'Teaching a Multigrade Classroom: Practical Strategies for One-Teacher Schools',
  eyebrow: 'Guide',
  navLabel: 'Multigrade Classroom Teaching',
  shortLabel: 'Multigrade Teaching',
  teaser: 'A 30-minute lesson structure and strategies for teaching several grades at once.',
  intro:
    'In many government schools, especially in rural and remote areas, one teacher takes children of two, three or more grades in the same room at the same time. It is demanding, but it is workable with the right routines. This guide covers the strategies that help most, with a sample 30-minute lesson you can adapt tomorrow.',
  published: '2026-09-19',
  updated: '2026-09-19',
  sections: [
    {
      id: 'challenge',
      heading: 'What makes multigrade teaching hard',
      blocks: [
        {
          type: 'p',
          text: 'You cannot teach every group at once, so at any moment some children are working without you. Levels within one grade also vary, and preparation multiplies: three grades can mean three lesson plans a day. The answer is not to work three times harder. It is to build routines in which children can learn independently, help each other, and know what to do next without asking.',
        },
      ],
    },
    {
      id: 'one-theme',
      heading: '1. Teach one theme at different depths',
      blocks: [
        {
          type: 'p',
          text: 'Where the syllabus allows, choose a common topic and pitch it differently for each group. A lesson on “water” can have Class 3 children observing and naming where water comes from, Class 4 drawing and labelling the water cycle, and Class 5 explaining what happens at each stage. One story, one demonstration or one question can open the lesson for everyone before the groups separate.',
        },
      ],
    },
    {
      id: 'rotation',
      heading: '2. Rotate between teacher-led and independent work',
      blocks: [
        {
          type: 'p',
          text: 'While you teach one group directly, the others work on a clear, self-contained task. Here is a sample 30-minute structure for two groups (Group A and Group B):',
        },
        {
          type: 'table',
          headers: ['Minutes', 'Group A', 'Group B'],
          rows: [
            ['0–5', 'Whole-class starter: a shared question, story or song', 'Whole-class starter'],
            ['5–15', 'Teacher-led lesson with you', 'Independent task: worksheet, drawing, reading or practice cards'],
            ['15–25', 'Independent task set by you', 'Teacher-led lesson with you'],
            ['25–30', 'Whole-class share: pairs show one thing they learned', 'Whole-class share'],
          ],
        },
        {
          type: 'p',
          text: 'With three groups, add a third rotation and shorten each slot. The independent tasks must be something children can start without you — that is where most of your preparation goes.',
        },
      ],
    },
    {
      id: 'peer',
      heading: '3. Use peer learning and student leaders',
      blocks: [
        {
          type: 'ul',
          items: [
            '**Pair older with younger children** for reading aloud, checking answers or explaining a step. The helper learns as much as the child being helped.',
            '**Give groups a leader** who hands out materials, keeps time and asks for help only after the group has tried together.',
            '**Teach the routine first.** Practise “ask three classmates before you ask me” for a week and it becomes habit.',
          ],
        },
      ],
    },
    {
      id: 'room',
      heading: '4. Organise the room and the routines',
      blocks: [
        {
          type: 'ul',
          items: [
            'Seat groups in separate zones so the teacher-led group can hear you and the others can work quietly.',
            'Keep a “What can I do when I finish?” list on the board — a reading corner, a puzzle, a drawing task — so early finishers do not disrupt.',
            'Prepare task cards in advance and keep them in a box the group leader can reach.',
            'Post the day’s timetable so children know when their group is up next.',
          ],
        },
      ],
    },
    {
      id: 'assess',
      heading: '5. Check understanding quickly',
      blocks: [
        {
          type: 'p',
          text: 'You do not have time to mark three sets of notebooks every day. Use short checks that give you the answer in seconds: a two-question exit slip per group, thumbs up/down on a statement, or a “show me” task — children hold up their slate with an answer. Note who struggled, and start the next lesson with that group.',
        },
      ],
    },
    {
      id: 'prepare',
      heading: '6. Prepare in batches, and reuse',
      blocks: [
        {
          type: 'p',
          text: 'Preparation is where an AI assistant can save the most time. With SarasTech you can set your classroom type to multi-grade and ask the Coach for guidance on organising the room, timing the groups and keeping every group busy. Use the [worksheet generator](/ai-worksheet-generator) to create the same topic at easy, medium and hard difficulty — one for each group — and the Workspace’s “Adapt for another grade” action to rework a saved plan for a different level. Save the tasks you build to your Library and reuse them next term.',
        },
        {
          type: 'note',
          title: 'Review before you use',
          text: 'AI-generated tasks and answer keys can contain mistakes. Check each one, and make sure it fits the level of the group you are giving it to.',
        },
      ],
    },
    {
      id: 'pitfalls',
      heading: 'Common pitfalls',
      blocks: [
        {
          type: 'ul',
          items: [
            '**Independent tasks that are too hard.** If children cannot start without you, the rotation collapses. Make tasks slightly easier than the teacher-led work.',
            '**Always teaching the youngest group first.** Vary the order so no group always gets your best energy — or your last five minutes.',
            '**Copying the same task for every grade.** Different levels need different tasks, even when the topic is shared.',
            '**No fixed routines.** Routines take time to teach, but they are what frees you to teach.',
          ],
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'How do I teach two grades at the same time?',
      answer:
        'Give one group a self-contained task while you teach the other, then swap. Start and finish with a short whole-class activity, and use pair work and group leaders so children can help each other.',
    },
    {
      question: 'How long should each group’s teacher-led slot be?',
      answer:
        'Around 10 minutes is a good starting point in a 30-minute lesson with two groups. With three groups, shorten each slot and add a third rotation.',
    },
    {
      question: 'How can I plan for several grades without triple the work?',
      answer:
        'Choose a shared theme where possible, prepare reusable task cards and multi-level worksheets, and save what you make so you build a library over the year. AI tools can speed up the first drafts, but review them before use.',
    },
    {
      question: 'Can SarasTech help with multigrade classes?',
      answer:
        'Yes. Set the classroom type to multi-grade in the Coach for guidance on organising space, timing and keeping every group engaged, and generate worksheets at different difficulty levels in the Generator.',
    },
  ],
  related: ['/ai-worksheet-generator', '/ai-lesson-plan-generator', '/guides/lesson-plan-format'],
  cta: {
    heading: 'Plan for every group in your class',
    text: 'Create a teacher account, set your classroom to multi-grade and get guidance and materials in your language.',
  },
  appPath: '/',
  appLabel: 'Open the Coach',
};
