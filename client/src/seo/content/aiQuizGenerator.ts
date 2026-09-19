import type { ContentPageData } from '../types';

// Verified against config.ts (ASSESSMENT_FORMATS hints, QUESTION_TYPES,
// DIFFICULTIES), README ("Exam-paper letterhead", "Structural answer-key
// separation") and ExamHeader/ExamHeaderEditor. There is NO auto-grading of
// student answers in the product, and the FAQ says so plainly.
export const aiQuizGenerator: ContentPageData = {
  kind: 'tool',
  path: '/ai-quiz-generator',
  title: 'AI Quiz and Question Paper Generator | SarasTech',
  description:
    'Create quizzes, exit tickets, homework and printable question papers for any grade — multiple-choice, true/false or short answer, with an answer key.',
  h1: 'AI Quiz and Question Paper Generator for Teachers',
  eyebrow: 'Quizzes and tests',
  navLabel: 'AI Quiz Generator',
  shortLabel: 'Quizzes',
  teaser: 'Quizzes, exit tickets, homework and exam-style papers with answer keys.',
  intro:
    'Generate a quiz, a three-question exit ticket, a homework set or a printable question paper for any grade and subject. Choose multiple-choice, true/false or short-answer questions, set the difficulty, and get an answer key that stays separate from the student’s copy.',
  published: '2026-09-19',
  updated: '2026-09-19',
  sections: [
    {
      id: 'formats',
      heading: 'Four ready-made formats',
      blocks: [
        {
          type: 'table',
          headers: ['Format', 'What it is', 'Good for'],
          rows: [
            ['Quiz', 'Questions with a separate answer key', 'A quick check at the end of a chapter'],
            ['Worksheet', 'A printable sheet with name/date lines and a teacher answer key', 'Practice in class or at home — see the [worksheet generator](/ai-worksheet-generator)'],
            ['Exit ticket', 'A 3-question check for the last minutes of a lesson', 'Finding out who understood before the bell rings'],
            ['Homework', 'Practice to do at home, with a note for parents', 'Regular home practice'],
          ],
        },
      ],
    },
    {
      id: 'question-types',
      heading: 'Multiple-choice, true/false and short-answer questions',
      blocks: [
        {
          type: 'p',
          text: 'Choose one question type or a mix. Multiple-choice questions come with lettered options (A–D) and a marked correct answer in the key; true/false and short-answer questions are marked in the key too. Set the difficulty to easy, medium or hard, and ask for anywhere from 3 to 30 questions. You can also add your own instructions — for example, “questions should use rupees and everyday shopping examples”.',
        },
      ],
    },
    {
      id: 'question-paper',
      heading: 'Turn a quiz into a question paper',
      blocks: [
        {
          type: 'p',
          text: 'Assessments print like an exam paper, with a header you control. In “Paper details” you can add:',
        },
        {
          type: 'ul',
          items: [
            'School name, exam name and teacher name',
            'Maximum marks and your own instructions to students',
            'Date and time, switched on only when you want them',
          ],
        },
        {
          type: 'p',
          text: 'Class, subject and maximum marks, plus Student Name and Roll No. lines, always print — as blank fill-in lines when you leave them empty. Your school name, teacher name and default instructions can be saved once in Settings and pre-filled on every new paper.',
        },
      ],
    },
    {
      id: 'consistent',
      heading: 'A consistent layout every time',
      blocks: [
        {
          type: 'p',
          text: 'The AI writes the questions; SarasTech’s own code builds the document around them. Question numbering, the A–D option letters and the answer-key heading are added by the application rather than left to the AI, so every paper has the same structure and the student and teacher versions can be separated reliably when you print.',
        },
      ],
    },
    {
      id: 'adjust',
      heading: 'Make it easier, harder or longer',
      blocks: [
        {
          type: 'p',
          text: 'Open a saved quiz in the Workspace and use **Make easier**, **Make harder**, **Generate more questions** or **Simplify wording**. Each shows a preview and only changes the quiz when you apply it. Maths is displayed as proper mathematical notation, both on screen and in print.',
        },
      ],
    },
    {
      id: 'tips',
      heading: 'Writing better quiz questions',
      blocks: [
        {
          type: 'ul',
          items: [
            '**Test understanding, not just recall.** Mix “what is…” questions with “why” and “what would happen if” questions.',
            '**Keep one correct answer.** If two options could be defended, the question needs fixing.',
            '**Make wrong options plausible.** Use common student mistakes as distractors, not silly answers.',
            '**Read the whole quiz once.** Check that the wording matches how you taught the topic and that the answer key is right.',
          ],
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'Does SarasTech grade my students’ answers?',
      answer:
        'No. SarasTech generates the quiz and its answer key; you or your students mark the answers by hand. That keeps you in control of how work is assessed.',
    },
    {
      question: 'Can I make a printable question paper with my school’s name?',
      answer:
        'Yes. Add the school name, exam name, teacher name, maximum marks and instructions in Paper details, or set defaults once in Settings so new papers are pre-filled.',
    },
    {
      question: 'What kinds of questions can it create?',
      answer: 'Multiple-choice, true/false and short-answer questions, or a mix, at easy, medium or hard difficulty.',
    },
    {
      question: 'Can I print a version without the answers?',
      answer:
        'Yes. Printing offers a student version (questions only) and a teacher version (with the answer key). The student version leaves the answers out of the page altogether.',
    },
    {
      question: 'Can I create a quiz in Hindi or another Indian language?',
      answer:
        'Yes. Choose the language when you generate — Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia, Hinglish or English — and check the wording before you print.',
    },
  ],
  related: ['/ai-worksheet-generator', '/ai-lesson-plan-generator', '/ai-teaching-assistant-in-indian-languages'],
  cta: {
    heading: 'Build your next quiz or question paper',
    text: 'Create a teacher account, pick a grade and topic, and print a quiz with its answer key.',
  },
  appPath: '/generator',
  appLabel: 'Open the Generator',
};
