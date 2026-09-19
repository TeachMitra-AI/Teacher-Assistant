import type { ContentPageData } from '../types';

// Every capability named here is one the signed-in app ships unflagged today:
// the Coach's "Create a Lesson Plan" quick action, grade/subject/classroom-type
// context (config.ts GRADES / SUBJECTS / CLASSROOM_TYPES), the 10 response
// languages (LANGUAGES), Save to Library, the Workspace editor, its four AI
// Assist actions (ResourceWorkspace AI_ACTIONS) and print/PDF. It deliberately
// does NOT describe the fixed ten-section NCERT-style lesson-plan document,
// which only exists behind the Classroom Mode flag (docs/classroom-mode.md).
export const aiLessonPlanGenerator: ContentPageData = {
  kind: 'tool',
  path: '/ai-lesson-plan-generator',
  title: 'AI Lesson Plan Generator for Indian Teachers | SarasTech',
  description:
    'Turn a topic, grade and subject into a practical lesson plan in English, Hindi or another Indian language. Edit it, save it, and print it as a PDF.',
  h1: 'AI Lesson Plan Generator for Indian Teachers',
  eyebrow: 'Lesson planning',
  navLabel: 'AI Lesson Plan Generator',
  shortLabel: 'Lesson Plans',
  teaser: 'Grade- and subject-specific lesson plans from a topic, in your language.',
  intro:
    'Tell SarasTech the topic, grade and subject, and its AI Coach drafts a lesson plan you can teach from — with teaching strategies, hands-on activities and a quick check for understanding. Ask in English, Hindi or another Indian language, edit the result in a built-in workspace, then print it or save it as a PDF.',
  published: '2026-09-19',
  updated: '2026-09-19',
  sections: [
    {
      id: 'what-you-get',
      heading: 'What SarasTech gives you',
      blocks: [
        {
          type: 'ul',
          items: [
            '**A grade- and subject-specific plan.** Pick a grade band (Pre-Primary up to Class 11–12) and a subject, and the answer is written for that level rather than for “students” in general.',
            '**Your classroom, not an imaginary one.** Set the classroom type — single grade, multi-grade, mixed ability, a large class (40+) or a small class (under 20) — and the suggestions are shaped around it.',
            '**Your language.** Get the plan in English, Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia or Hinglish. See [teaching in Hindi and other Indian languages](/ai-teaching-assistant-in-indian-languages).',
            '**A place to keep and refine it.** Save the plan to your personal Library, open it in the Workspace editor, and print it or export it as a PDF.',
            '**AI edits you approve first.** In the Workspace, ask the AI to make the plan simpler, add classroom activities, add assessment questions, or adapt it for another grade — you see a preview and choose whether to apply it.',
          ],
        },
      ],
    },
    {
      id: 'how-it-works',
      heading: 'How to create a lesson plan with SarasTech',
      blocks: [
        {
          type: 'ol',
          items: [
            { title: 'Open the Coach.', text: 'Create a teacher account and sign in. The Coach is the first screen you see.' },
            { title: 'Start from “Create a Lesson Plan”.', text: 'The quick action pre-fills the start of your request. Finish it with your topic.' },
            { title: 'Add your context.', text: 'Choose the grade, subject, classroom type and response language so the plan fits your class.' },
            { title: 'Read it, then refine it.', text: 'Ask a follow-up if something is off — for example, “shorten this to 30 minutes” or “use only materials we have in class”.' },
            { title: 'Save and edit.', text: 'Save it to your Library, open it in the Workspace, and adjust the wording, timing and activities until it matches your teaching.' },
          ],
        },
      ],
    },
    {
      id: 'example-requests',
      heading: 'Example requests that work well',
      blocks: [
        {
          type: 'p',
          text: 'The more specific your request, the more usable the plan. A few ways teachers phrase it:',
        },
        {
          type: 'ul',
          items: [
            '“Create a 40-minute lesson plan on adding fractions with like denominators for Class 4, single grade, with a short check at the end.”',
            '“Create a lesson plan on the water cycle for Class 3–5 in a multi-grade classroom with no projector. Answer in Hindi.”',
            '“Suggest a lesson plan for teaching the parts of a plant to Class 5 using only leaves, sticks and chalk.”',
          ],
        },
      ],
    },
    {
      id: 'indian-classrooms',
      heading: 'Made for the way Indian classrooms actually run',
      blocks: [
        {
          type: 'p',
          text: 'Many teachers plan for more than one grade at once, for classes with very different levels, or with few teaching aids. SarasTech’s coaching is written with those situations in mind: it has dedicated guidance for [multi-grade classrooms](/guides/multigrade-classroom-teaching), for zero-cost teaching aids made from local materials, and for foundational literacy and numeracy (FLN) — including strategies aligned with NIPUN Bharat and Teaching at the Right Level.',
        },
      ],
    },
    {
      id: 'review',
      heading: 'Always review before you teach',
      blocks: [
        {
          type: 'note',
          title: 'AI drafts, you decide',
          text: 'SarasTech generates plans with AI, and AI can make mistakes. It is not tied to any board’s official syllabus or to your textbook’s exact chapters, so check facts, examples and timings against your own materials — and follow your school’s required lesson-plan format. Our guide on [how to use AI for lesson planning](/guides/how-to-use-ai-for-lesson-planning) includes a checklist, and the [lesson plan format guide](/guides/lesson-plan-format) shows the sections most Indian schools expect.',
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'Does SarasTech follow the NCERT or B.Ed. lesson plan format?',
      answer:
        'The Coach gives practical, grade-specific teaching guidance rather than filling in a fixed college or board template. If your school needs a particular format, describe the sections you need in your request and use the Workspace editor to arrange the result. Our lesson plan format guide walks through the sections most Indian schools use.',
    },
    {
      question: 'Can I get a lesson plan in Hindi or another Indian language?',
      answer:
        'Yes. Choose Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Odia or Hinglish as the response language, and the answer — headings included — is written in that language. Review regional-language output before use, since AI wording can occasionally be unnatural.',
    },
    {
      question: 'Can I edit and print the lesson plan?',
      answer:
        'Yes. Save it to your Library, open it in the Workspace editor to change the text, then print it or export a PDF from the browser’s print dialog.',
    },
    {
      question: 'Does it work for multi-grade or mixed-ability classes?',
      answer:
        'Yes. Set the classroom type to multi-grade or mixed ability and the suggestions are shaped around that situation. You can also use the Workspace’s “Adapt for another grade” action to rework a plan for a different level.',
    },
    {
      question: 'Who can see the lesson plans I save?',
      answer:
        'Your saved resources and history are tied to your own account, so only you can see and edit them. Requests are processed by Google Gemini through SarasTech’s servers — see the Privacy Policy for details.',
    },
  ],
  related: ['/ai-worksheet-generator', '/guides/lesson-plan-format', '/guides/how-to-use-ai-for-lesson-planning'],
  cta: {
    heading: 'Draft your next lesson plan in minutes',
    text: 'Create a teacher account and turn a topic into a lesson plan you can edit, print and reuse.',
  },
  appPath: '/',
  appLabel: 'Open the Coach',
};
