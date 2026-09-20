import type { ContentPageData } from '../types';
import { SOCIAL_PROFILES } from '../site';

// Every product statement here restates something the site already says
// elsewhere — the home page FAQ, the tool pages and the languages page — so this
// page adds no claim the product cannot back. In particular it names no team,
// founders, location, customer numbers or partnerships, none of which the site
// currently states. The official profile links are generated from
// SOCIAL_PROFILES (seo/site.ts), the same list behind Organization `sameAs` and
// the home page's "Follow SarasTech" section, so the three can never disagree.
export const aboutSarasTech: ContentPageData = {
  kind: 'about',
  path: '/about',
  title: 'About SarasTech AI — AI Teaching Assistant for India',
  description:
    'SarasTech AI is an AI teaching assistant for Indian teachers and classrooms: a classroom coach plus lesson plan, worksheet and quiz generators, in Indian languages.',
  h1: 'About SarasTech AI',
  eyebrow: 'About SarasTech',
  navLabel: 'About SarasTech AI',
  shortLabel: 'About',
  teaser: 'What SarasTech AI is, who it is for and what it can do.',
  intro:
    'SarasTech AI — SarasTech for short — is an AI teaching assistant for teachers and classrooms in India. It pairs a classroom coach you can ask in plain language with generators for lesson plans, worksheets, quizzes and question papers, in English, eight Indian languages and Hinglish.',
  published: '2026-09-20',
  updated: '2026-09-20',
  sections: [
    {
      id: 'what-it-does',
      heading: 'What SarasTech AI does',
      blocks: [
        {
          type: 'p',
          text: 'Planning lessons and preparing practice material takes time most teachers do not have between classes. The assistant is designed to shorten that work: you describe your class and topic, and it drafts something you can teach from.',
        },
        {
          type: 'ul',
          items: [
            '**AI Classroom Coach.** Ask a classroom question — about a concept, an activity or a behaviour problem — and get grade- and subject-specific coaching.',
            '**Lesson plans, worksheets and quizzes.** Generate a [lesson plan](/ai-lesson-plan-generator), a [worksheet](/ai-worksheet-generator) or a [quiz or question paper](/ai-quiz-generator) from a topic, grade and subject. Worksheets and quizzes come with a teacher answer key.',
            '**Editor and Library.** Open what you save in a built-in editor, refine it, keep it in your personal library, and print it or export it as a PDF.',
            '**Voice input and read-aloud.** Dictate a question or hear an answer read aloud, using your browser’s speech features.',
          ],
        },
      ],
    },
    {
      id: 'who-its-for',
      heading: 'Who SarasTech AI is for',
      blocks: [
        {
          type: 'ul',
          items: [
            'Teachers in India who plan their own lessons and make their own worksheets and quizzes.',
            'Teachers of multi-grade, mixed-ability or large classes — you can set your classroom type so the coaching and the resources match how you teach.',
            'Teachers who work in Hindi or another Indian language, including in [Hindi and other Indian languages](/ai-teaching-assistant-in-indian-languages).',
          ],
        },
      ],
    },
    {
      id: 'languages',
      heading: 'Languages',
      blocks: [
        {
          type: 'p',
          text: 'SarasTech writes answers and materials in English, Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia or Hinglish — you choose. The app’s own menus and buttons are in English. The [language page](/ai-teaching-assistant-in-indian-languages) explains how this works.',
        },
      ],
    },
    {
      id: 'limits',
      heading: 'What to keep in mind',
      blocks: [
        {
          type: 'note',
          title: 'Treat every result as a draft',
          text: 'AI-generated lesson ideas, questions and answer keys can contain mistakes. Review and edit them, and check answer keys yourself, before they reach students. The assistant builds content from the grade, subject and topic you give it; it is not tied to any board’s official syllabus or to a specific textbook.',
        },
        {
          type: 'p',
          text: 'Your saved resources and history are tied to your own account, so only you can see and edit them.',
        },
      ],
    },
    {
      id: 'official-profiles',
      heading: 'Official website and profiles',
      blocks: [
        {
          type: 'p',
          text: 'This website, sarastech.co.in, is the official home of SarasTech AI. Its official profiles are:',
        },
        {
          type: 'ul',
          items: SOCIAL_PROFILES.map((profile) => `[SarasTech on ${profile.name}](${profile.url})`),
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'What is SarasTech AI?',
      answer:
        'SarasTech AI is an AI teaching assistant for teachers in India. It combines an AI classroom coach with a lesson plan, worksheet and quiz generator, plus a personal library and editor for the resources you keep.',
    },
    {
      question: 'Is SarasTech the same as SarasTech AI?',
      answer:
        'Yes. SarasTech is the short name and SarasTech AI is the same AI teaching assistant named in full. You may also see it written “Saras Tech”.',
    },
    {
      question: 'Who is SarasTech AI for?',
      answer:
        'It is designed for teachers and classrooms in India, including multi-grade, mixed-ability and large classes, and for teachers who plan in Hindi or another Indian language.',
    },
    {
      question: 'Does SarasTech AI follow the NCERT, CBSE or a state-board syllabus?',
      answer:
        'It is not tied to any board’s official syllabus or textbook. It creates content from the grade, subject and topic you give it, so check the result against your own curriculum before using it.',
    },
    {
      question: 'How can I contact SarasTech?',
      answer:
        'Use the “Need Help?” option in the app. The Privacy Policy page explains how your data is handled.',
    },
  ],
  related: [
    '/ai-lesson-plan-generator',
    '/ai-worksheet-generator',
    '/ai-quiz-generator',
    '/ai-teaching-assistant-in-indian-languages',
  ],
  cta: {
    heading: 'Try SarasTech on your next lesson',
    text: 'Create a teacher account, ask the Coach a classroom question, or draft a lesson plan, worksheet or quiz.',
  },
  appPath: '/',
  appLabel: 'Open the Coach',
};
