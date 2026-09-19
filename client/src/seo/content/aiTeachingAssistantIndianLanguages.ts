import type { ContentPageData } from '../types';

// Verified against config.ts LANGUAGES / SPEECH_LOCALE, server/src/prompts.js
// languageDirective (the whole answer, headings included, is written in the
// chosen language; a teacher may still type the question in another language)
// and CoachPage's voice-input / TTS wiring. The UI itself stays in English
// (config.ts says so), and this page says so too rather than implying a
// translated interface.
export const aiTeachingAssistantIndianLanguages: ContentPageData = {
  kind: 'tool',
  path: '/ai-teaching-assistant-in-indian-languages',
  title: 'AI Teaching Assistant in Hindi & Indian Languages | SarasTech',
  description:
    'Get classroom coaching, lesson ideas, worksheets and quizzes in Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia, Hinglish or English.',
  h1: 'AI Teaching Assistant in Hindi and Other Indian Languages',
  eyebrow: 'Regional languages',
  navLabel: 'Hindi & Indian Languages',
  shortLabel: 'Indian Languages',
  teaser: 'Coaching, worksheets and quizzes in 9 Indian languages plus Hinglish.',
  intro:
    'Not every teacher plans in English, and not every classroom teaches in it. SarasTech’s AI Coach answers in the language you choose — Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia, Hinglish or English — and so do its worksheet and quiz generators.',
  published: '2026-09-19',
  updated: '2026-09-19',
  sections: [
    {
      id: 'languages',
      heading: 'Languages you can teach and plan in',
      blocks: [
        {
          type: 'table',
          headers: ['Language', 'In its own script'],
          rows: [
            ['English', 'English'],
            ['Hindi', 'हिंदी'],
            ['Bengali', 'বাংলা'],
            ['Telugu', 'తెలుగు'],
            ['Marathi', 'मराठी'],
            ['Tamil', 'தமிழ்'],
            ['Gujarati', 'ગુજરાતી'],
            ['Kannada', 'ಕನ್ನಡ'],
            ['Odia', 'ଓଡ଼ିଆ'],
            ['Hinglish', 'Hindi written in the Roman alphabet, mixed with English'],
          ],
        },
      ],
    },
    {
      id: 'what-works',
      heading: 'What works in your language',
      blocks: [
        {
          type: 'ul',
          items: [
            '**Classroom coaching.** Ask about a concept, a classroom activity or a behaviour problem and get the answer — including its headings — in your chosen language, not half in English.',
            '**Worksheets, quizzes and question papers.** Pick the language in the [worksheet](/ai-worksheet-generator) or [quiz](/ai-quiz-generator) generator and the questions and answer key are written in it.',
            '**Lesson plans.** Choose the response language before you ask and the [lesson plan](/ai-lesson-plan-generator) comes back in that language.',
            '**Ask in one language, answer in another.** You can type your question in Hinglish or English and have the answer written in Tamil or Marathi. If you state the language in the question itself — “answer in Hinglish” — SarasTech follows that.',
          ],
        },
      ],
    },
    {
      id: 'voice',
      heading: 'Speak your question, hear the answer',
      blocks: [
        {
          type: 'p',
          text: 'Instead of typing, you can dictate a question and have an answer read aloud. Both use your browser’s built-in speech features and follow the language you choose. Which languages work, and how well, depends on your browser, your device and the voices installed on it.',
        },
      ],
    },
    {
      id: 'limits',
      heading: 'What to keep in mind',
      blocks: [
        {
          type: 'note',
          title: 'Review regional-language output',
          text: 'AI writing can be stiff, or wrong, in any language — and the quality can differ from one language to another, especially for technical terms and subject vocabulary. Read what SarasTech produces before it reaches your students, and adjust anything that does not sound like your classroom. Also note that the SarasTech app’s own menus and buttons are in English; the language setting applies to the answers and materials it creates.',
        },
      ],
    },
    {
      id: 'who',
      heading: 'Who this helps',
      blocks: [
        {
          type: 'ul',
          items: [
            'Teachers in Hindi-medium or other regional-medium schools who want ideas and materials in the language they teach in.',
            'Bilingual classrooms where explanations move between English and the home language.',
            'Teachers comfortable speaking a language but slower at typing it, who can use voice input.',
          ],
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'Can SarasTech write a lesson plan or worksheet in Hindi?',
      answer:
        'Yes. Choose Hindi as the response language for the Coach, or in the worksheet and quiz generator, and the output is written in Hindi. The same works for Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia and Hinglish.',
    },
    {
      question: 'Is the SarasTech app itself available in Hindi?',
      answer:
        'Not yet — menus and buttons are in English. The language setting controls the language of the answers and materials SarasTech generates.',
    },
    {
      question: 'Can I ask my question in Hinglish?',
      answer:
        'Yes. You can type in any language you are comfortable with. The answer is written in the response language you have chosen, unless you ask for a specific language in the question itself.',
    },
    {
      question: 'How accurate is the regional-language output?',
      answer:
        'It is AI-generated, so it can contain mistakes or unnatural phrasing, and quality varies by language and topic. Treat it as a draft: read it, correct it and adapt it before use.',
    },
  ],
  related: ['/ai-lesson-plan-generator', '/ai-worksheet-generator', '/ai-quiz-generator'],
  cta: {
    heading: 'Plan in the language you teach in',
    text: 'Create a teacher account and choose your language for coaching, worksheets and quizzes.',
  },
  appPath: '/',
  appLabel: 'Open the Coach',
};
