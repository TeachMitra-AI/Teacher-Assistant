import type { ContentPageData } from '../types';

// A responsible-use guide. The privacy point cites UNESCO's 2023 "Guidance for
// generative AI in education and research", which stresses protecting learners'
// data and a human-centred approach. The statement about SarasTech's coach is
// limited to what server/src/prompts.js actually instructs it to do.
export const guideAiLessonPlanning: ContentPageData = {
  kind: 'guide',
  path: '/guides/how-to-use-ai-for-lesson-planning',
  title: 'How to Use AI for Lesson Planning: A Teacher’s Guide',
  description:
    'A practical workflow for AI lesson planning: what to ask, how to give context, a checklist for checking the output, and how to protect student privacy.',
  h1: 'How to Use AI for Lesson Planning: A Practical Guide for Teachers',
  eyebrow: 'Guide',
  navLabel: 'Using AI for Lesson Planning',
  shortLabel: 'AI Lesson Planning',
  teaser: 'A workflow, a prompt formula and a checklist for planning lessons with AI.',
  intro:
    'AI can turn a blank page into a workable first draft of a lesson in seconds. It can also produce confident mistakes. This guide shows how to get useful drafts, what to check before you teach from them, and how to keep your students’ information safe.',
  published: '2026-09-19',
  updated: '2026-09-19',
  sections: [
    {
      id: 'good-at',
      heading: 'What AI is good at in lesson planning',
      blocks: [
        {
          type: 'ul',
          items: [
            '**A first draft.** A structure to react to is faster than a blank page.',
            '**Activity ideas.** Games, group tasks and hands-on demonstrations for a concept, including ones that use only everyday materials.',
            '**Different levels.** Easier and harder versions of the same task for a mixed-ability class.',
            '**Practice material.** Worksheets and quizzes with an answer key — see the [worksheet generator](/ai-worksheet-generator) and [quiz generator](/ai-quiz-generator).',
            '**Language.** Rewriting an explanation in simpler words, or in Hindi or another regional language.',
          ],
        },
      ],
    },
    {
      id: 'careful',
      heading: 'Where you need to be careful',
      blocks: [
        {
          type: 'ul',
          items: [
            '**Facts and numbers.** AI can state wrong facts or wrong answers fluently — especially in maths, science and history.',
            '**Your textbook and syllabus.** Unless you supply them, an AI does not know your textbook’s chapter, its examples or your board’s exact learning outcomes.',
            '**Your classroom.** It cannot see your room, your students’ levels or what materials you actually have — you have to tell it.',
            '**Age-appropriateness.** Check that examples, vocabulary and difficulty suit the grade.',
          ],
        },
      ],
    },
    {
      id: 'workflow',
      heading: 'A five-step workflow',
      blocks: [
        {
          type: 'ol',
          items: [
            { title: 'Decide the outcome first.', text: 'Write the one thing students should be able to do at the end. If you cannot, the AI cannot either.' },
            { title: 'Give context.', text: 'Grade, subject, time available, class size or type, materials, and the language you want the answer in.' },
            { title: 'Ask for a draft.', text: 'Request a specific thing — a 30-minute plan, five discussion questions, a ten-question worksheet — not “help with fractions”.' },
            { title: 'Check and edit.', text: 'Use the checklist below, then rewrite anything that does not sound like your teaching.' },
            { title: 'Teach it, then note what to change.', text: 'Jot down what worked and what did not, and save the improved version for next time.' },
          ],
        },
      ],
    },
    {
      id: 'ingredients',
      heading: 'What to put in your request',
      blocks: [
        {
          type: 'table',
          headers: ['Ingredient', 'Example'],
          rows: [
            ['Task', 'Create a lesson plan; suggest an activity; write a 10-question quiz'],
            ['Topic', 'The water cycle'],
            ['Grade and subject', 'Class 5, EVS'],
            ['Time', '35 minutes'],
            ['Classroom', 'Multi-grade, 30 students, no projector'],
            ['Materials', 'Only chalk, a steel glass and a plate'],
            ['Output', 'Include a 3-question check at the end; answer in Hindi'],
          ],
        },
        {
          type: 'p',
          text: 'Compare “lesson plan on the water cycle” with “Create a 35-minute lesson plan on the water cycle for Class 5 EVS in a multi-grade classroom with no projector, using only chalk, a steel glass and a plate. Include a 3-question check at the end. Answer in Hindi.” The second gives the AI something to work with — and gives you something you can use.',
        },
      ],
    },
    {
      id: 'checklist',
      heading: 'A checklist before you use AI output',
      blocks: [
        {
          type: 'ul',
          items: [
            'Are the facts correct? Check anything you are not certain of against your textbook.',
            'Have I solved the maths and checked the answer key myself?',
            'Does it match the chapter and learning outcomes I am actually teaching?',
            'Is the language natural for my students, at their reading level?',
            'Is the timing realistic for my period length?',
            'Can I get the materials it lists?',
            'Is everything safe and appropriate for this age group?',
          ],
        },
      ],
    },
    {
      id: 'privacy',
      heading: 'Protect your students’ privacy',
      blocks: [
        {
          type: 'p',
          text: 'Never type students’ full names, addresses, health details or family circumstances into an AI tool. Describe situations in general terms instead — “a Class 6 student who struggles with reading” rather than a name. UNESCO’s [guidance for generative AI in education and research](https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research) stresses protecting learners’ data privacy and keeping a human-centred approach, and it is a helpful read for any school adopting AI.',
        },
        {
          type: 'p',
          text: 'SarasTech’s coach is instructed not to ask for or encourage sharing of identifying details about a specific student. Even so, the safest habit is not to enter them at all. Also check whether your school or education department has a policy on AI tools before you use one for official documents.',
        },
      ],
    },
    {
      id: 'sarastech',
      heading: 'Where SarasTech fits',
      blocks: [
        {
          type: 'p',
          text: 'SarasTech is an AI teaching assistant built for Indian classrooms. Its Coach drafts lesson plans and classroom activities in your language, its Generator creates worksheets and quizzes with answer keys, and a Library and Workspace let you save, edit and print what you keep. Start with the [AI lesson plan generator](/ai-lesson-plan-generator), and see the [lesson plan format guide](/guides/lesson-plan-format) for what a finished plan should contain.',
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'Will AI replace lesson planning?',
      answer:
        'No. AI is good at producing a draft, but deciding what your students need, judging whether an activity will work in your room and checking accuracy are still your job.',
    },
    {
      question: 'How do I make AI content match my textbook or syllabus?',
      answer:
        'Tell it the chapter title and the learning outcomes from your own textbook or syllabus in your request, and check its output against the textbook afterwards. Do not assume it already knows them.',
    },
    {
      question: 'Is it acceptable to use AI-generated lesson plans in school?',
      answer:
        'That depends on your school and education department. Ask your head teacher or check any policy on AI tools, and always review and adapt the plan so it reflects your own teaching.',
    },
    {
      question: 'Can AI plan for a class with several grades or abilities?',
      answer:
        'Yes, if you describe the situation. Say how many grades or levels you have and how much time you have, and ask for activities that different groups can work on independently. Our multigrade guide has a sample lesson structure.',
    },
  ],
  related: ['/ai-lesson-plan-generator', '/guides/lesson-plan-format', '/guides/multigrade-classroom-teaching'],
  cta: {
    heading: 'Try it on your next lesson',
    text: 'Create a teacher account and draft a lesson plan in your language — then use the checklist above.',
  },
  appPath: '/',
  appLabel: 'Open the Coach',
};
