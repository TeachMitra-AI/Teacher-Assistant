import type { ContentPageData } from '../types';

// Verified against config.ts (GRADES, SUBJECTS, DIFFICULTIES, QUESTION_COUNT_*,
// ASSESSMENT_FORMATS), GeneratorPage.tsx and ResourceWorkspace.tsx. Only the
// four unflagged question types are named — descriptive / fill-in-the-blank /
// match-the-following sit behind STRUCTURED_QUESTIONS_ENABLED.
export const aiWorksheetGenerator: ContentPageData = {
  kind: 'tool',
  path: '/ai-worksheet-generator',
  title: 'AI Worksheet Generator with Answer Key | SarasTech',
  description:
    'Generate printable worksheets by grade, subject, topic and difficulty — with a teacher answer key and a student version that leaves the answers out.',
  h1: 'AI Worksheet Generator with Answer Key',
  eyebrow: 'Worksheets',
  navLabel: 'AI Worksheet Generator',
  shortLabel: 'Worksheets',
  teaser: 'Printable worksheets with a teacher answer key and a student-safe print.',
  intro:
    'Create a worksheet for any grade, subject and topic in minutes. SarasTech generates the questions, builds a teacher answer key, and lets you print a student version that leaves the answers out — in English or your regional language.',
  published: '2026-09-19',
  updated: '2026-09-19',
  sections: [
    {
      id: 'settings',
      heading: 'What you can set',
      blocks: [
        {
          type: 'p',
          text: 'The Generator asks for a handful of choices, then writes questions to match:',
        },
        {
          type: 'table',
          headers: ['Setting', 'Options'],
          rows: [
            ['Format', 'Worksheet (also Quiz, Exit Ticket and Homework)'],
            ['Grade', 'Pre-Primary, Class 1–2, Class 3–5, Class 6–8, Class 9–10, Class 11–12'],
            ['Subject', 'Mathematics, Science, English, Hindi, Social Studies, Languages, General'],
            ['Topic', 'Anything you type — for example “adding fractions” or “parts of a plant”'],
            ['Difficulty', 'Easy, Medium or Hard'],
            ['Question type', 'Multiple choice, True / False, Short answer, or Mixed'],
            ['Number of questions', 'From 3 to 30'],
            ['Language', 'English, Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia or Hinglish'],
            ['Extra instructions', 'Optional — for example “use examples from a village market”'],
          ],
        },
      ],
    },
    {
      id: 'how-it-works',
      heading: 'How to make a worksheet',
      blocks: [
        {
          type: 'ol',
          items: [
            { title: 'Open the Generator.', text: 'Sign in and choose Generator from the main navigation.' },
            { title: 'Choose “Worksheet” and fill in the details.', text: 'Grade, subject, topic, difficulty, question type and how many questions.' },
            { title: 'Generate and read it.', text: 'You get a preview with numbered questions and an answer key. Nothing is saved until you choose to save it.' },
            { title: 'Edit what you want to change.', text: 'Fix a question, change the wording, or add your school’s details to the paper header.' },
            { title: 'Save and print.', text: 'Save it to your Library as an assessment, open it in the Workspace, and print the version you need.' },
          ],
        },
      ],
    },
    {
      id: 'student-teacher',
      heading: 'A student version and a teacher version',
      blocks: [
        {
          type: 'p',
          text: 'Handing out a worksheet with the answers on the back is an easy mistake. When you print from the Workspace you choose between:',
        },
        {
          type: 'ul',
          items: [
            '**Student version** — questions only. The answer key is left out of the printed page entirely, not merely hidden.',
            '**Teacher version** — the questions plus the answer key, for marking.',
          ],
        },
        {
          type: 'p',
          text: 'If you edit a worksheet and accidentally remove the answer-key heading, SarasTech asks you to confirm before printing the student version, so answers are not printed by surprise.',
        },
      ],
    },
    {
      id: 'maths',
      heading: 'Maths that prints as maths',
      blocks: [
        {
          type: 'p',
          text: 'Fractions, exponents, roots and other mathematical notation are written as proper mathematical notation and rendered with KaTeX in both the preview and the printed sheet — so a fraction looks like a fraction, not slashes and carets.',
        },
      ],
    },
    {
      id: 'adjust',
      heading: 'Adjust it after it is generated',
      blocks: [
        {
          type: 'p',
          text: 'Open a saved worksheet in the Workspace and use the AI actions to reshape it. Each one shows a preview first, and nothing changes until you apply it:',
        },
        {
          type: 'ul',
          items: ['**Make easier** or **Make harder**', '**Generate more questions**', '**Simplify wording** for younger or second-language readers'],
        },
      ],
    },
    {
      id: 'better-worksheets',
      heading: 'Tips for a better worksheet',
      blocks: [
        {
          type: 'ul',
          items: [
            '**One idea per worksheet.** “Adding like fractions” makes a better sheet than “fractions”.',
            '**Order from easy to hard.** Start with questions every child can answer so nobody gives up on question one.',
            '**Mix question types.** A few multiple-choice questions for quick checking, a couple of short answers to see reasoning.',
            '**Solve a few yourself.** Always work through some questions to confirm the answer key is right — especially in maths.',
            '**Keep it finishable.** A worksheet that fits on one or two pages gets completed — choose fewer questions rather than cramming more in.',
          ],
        },
        {
          type: 'note',
          title: 'Check the answer key',
          text: 'AI-generated questions and answers can contain errors. Review every worksheet before it reaches students, and check it matches what you have actually taught.',
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'Does the worksheet come with an answer key?',
      answer:
        'Yes. Every generated worksheet includes a teacher answer key. When you print, you choose the student version (no answers) or the teacher version (with answers).',
    },
    {
      question: 'Can I generate a worksheet in Hindi or another Indian language?',
      answer:
        'Yes. Pick the language in the Generator — Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia, Hinglish or English. Review the wording before printing.',
    },
    {
      question: 'How many questions can I generate?',
      answer: 'Between 3 and 30 questions per worksheet, in easy, medium or hard difficulty.',
    },
    {
      question: 'Can I edit the worksheet before printing?',
      answer:
        'Yes. The preview is editable, and a saved worksheet opens in the Workspace where you can change any question, the paper header and the instructions.',
    },
    {
      question: 'Is the worksheet saved automatically?',
      answer: 'No. Nothing is saved until you choose Save to Library, so you can generate again freely.',
    },
  ],
  related: ['/ai-quiz-generator', '/ai-lesson-plan-generator', '/ai-teaching-assistant-in-indian-languages'],
  cta: {
    heading: 'Make your next worksheet in minutes',
    text: 'Create a teacher account, pick a grade and topic, and print a worksheet with its answer key.',
  },
  appPath: '/generator',
  appLabel: 'Open the Generator',
};
