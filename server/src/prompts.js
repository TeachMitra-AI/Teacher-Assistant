// Prompt templates for different teaching scenarios (server-side).
// Ported from the frontend prompt-templates.js so the server owns prompt
// construction and never trusts a client-supplied prompt.

const LANGUAGE_NAMES = {
  en: 'English',
  hi: 'हिंदी',
  bn: 'বাংলা',
  te: 'తెలుగు',
  mr: 'मराठी',
  ta: 'தமிழ்',
  gu: 'ગુજરાતી',
  kn: 'ಕನ್ನಡ',
  or: 'ଓଡ଼ିଆ',
  hinglish: 'Hinglish',
};

// Some languages need a richer instruction than just their name. Hinglish in
// particular must be described so the model produces a natural Hindi+English
// mix in Roman script rather than pure Hindi.
const LANGUAGE_INSTRUCTIONS = {
  hinglish:
    'Respond in Hinglish — a natural, conversational mix of Hindi and English written in the Roman (Latin) script, the way Indian teachers actually speak in class. Use common English words where natural and write Hindi words in Roman script (NOT Devanagari). For example: "Bacchon ko groups mein baant do aur unhe ek fun activity dijiye."',
};

/**
 * Build the language directive appended to prompts. Returns '' for English.
 * @param {string} language
 * @returns {string}
 */
function languageDirective(language) {
  if (language === 'en' || !LANGUAGE_NAMES[language]) return '';
  return LANGUAGE_INSTRUCTIONS[language] || `Respond in ${LANGUAGE_NAMES[language]} language.`;
}

// Teacher-chosen presentation style for coaching responses. 'balanced' (or an
// unknown value) adds no directive so the default template structure is used.
const RESPONSE_STYLE_INSTRUCTIONS = {
  concise:
    'Keep the response short and to the point. Give only the 2-3 most important, immediately usable ideas in a compact form. Aim for roughly 150-200 words.',
  detailed:
    'Provide a thorough, in-depth response. Elaborate on each strategy with extra explanation, reasoning and multiple concrete examples.',
  step_by_step:
    'Structure the entire response as clear, numbered step-by-step instructions the teacher can follow in order, one action per step.',
  practical:
    'Focus on concrete, ready-to-use classroom actions, activities and examples the teacher can apply today. Keep theory to a minimum.',
  balanced: '',
};

/**
 * Build the response-style directive appended to prompts. Returns '' when the
 * style is 'balanced' or unrecognised.
 * @param {string} responseStyle
 * @returns {string}
 */
function styleDirective(responseStyle) {
  return RESPONSE_STYLE_INSTRUCTIONS[responseStyle] || '';
}

const SYSTEM_PROMPT = `You are an expert educational coach for Indian government school teachers. Provide DETAILED, GRADE-SPECIFIC, ACTIONABLE guidance.

CRITICAL REQUIREMENTS:
1. Use the EXACT grade level mentioned (e.g., "Class 3-5 students" not "students")
2. Reference the specific subject and classroom type in your advice
3. Provide CONCRETE examples with actual numbers/scenarios
4. Include AT LEAST 2 fun activities that can be done immediately
5. Use simple, practical language suitable for teachers with limited resources
6. Keep total response to 400-500 words (detailed but focused)

MANDATORY RESPONSE STRUCTURE:
1. Brief acknowledgment (1 sentence mentioning the grade and concept)
2. Why this is challenging for THIS specific grade level (2 sentences)
3. Teaching Strategy 1: [Detailed explanation with step-by-step example]
4. Teaching Strategy 2: [Different approach with concrete example]
5. Teaching Strategy 3: [Visual/hands-on method]
6. Fun Activity 1: [Engaging game/activity with clear instructions]
7. Fun Activity 2: [Alternative activity for different learning styles]
8. Quick Assessment: [How to check if students understood]

DO NOT give generic advice. Every sentence must be specific to the grade, subject, and context provided.`;

const grade = (c) => c.grade || 'Not specified';
const subject = (c) => c.subject || 'Not specified';
const classroomType = (c) => c.classroomType || 'Not specified';

const templates = {
  classroomManagement: (query, c) => `
${SYSTEM_PROMPT}

TEACHER'S CONTEXT (USE THIS IN EVERY SENTENCE):
- Teaching Grade: ${grade(c)}
- Subject: ${subject(c)}
- Classroom Type: ${classroomType(c)}
- Management Issue: ${query}

Provide IMMEDIATE, GRADE-SPECIFIC classroom management strategies.

REQUIRED SECTIONS:
1. Acknowledge the challenge for THIS specific grade and classroom type
2. Strategy 1: Immediate action (what to do in the next 30 seconds)
3. Strategy 2: Short-term solution (for this class period)
4. Strategy 3: Long-term prevention (for future classes)
5. Fun Activity: Engaging alternative to redirect behavior
6. Example Scenario: Show exactly how to implement in ${grade(c)}

Use the exact grade level (e.g., "Class 3-5 students") throughout your response.`,

  conceptExplanation: (query, c) => `
${SYSTEM_PROMPT}

TEACHER'S CONTEXT (REFERENCE IN EVERY STRATEGY):
- Teaching Grade: ${grade(c)}
- Subject: ${subject(c)}
- Classroom Type: ${classroomType(c)}
- Concept to Explain: ${query}

Provide DETAILED, GRADE-APPROPRIATE ways to teach this concept.

MANDATORY SECTIONS (DO NOT SKIP ANY):
1. Why ${grade(c)} find this difficult (cognitive challenge for this age group)
2. Teaching Method 1 - Concrete Example (step-by-step with ACTUAL NUMBERS)
3. Teaching Method 2 - Visual/Drawing Technique (what to draw on the blackboard)
4. Teaching Method 3 - Hands-On Activity (locally available materials)
5. Fun Activity 1 - Interactive Game (zero-cost materials, step-by-step)
6. Fun Activity 2 - Group/Pair Work (suitable for ${classroomType(c)})
7. Quick Assessment Check (2-3 questions to verify understanding)
8. Common Mistakes (typical misconceptions and how to address them)

Use "${grade(c)}" not just "students" and reference ${subject(c)} throughout.`,

  multiGradeTeaching: (query, c) => `
${SYSTEM_PROMPT}

TEACHER'S SITUATION:
- Teaching Multiple Grades: ${grade(c)}
- Subject: ${subject(c)}
- Challenge: ${query}

Provide strategies specifically for multi-grade classrooms:
1. How to organize the physical space
2. How to structure the lesson (timing, grouping)
3. How to keep all groups engaged simultaneously
4. How to assess different levels efficiently

Include a sample 30-minute lesson structure.`,

  studentEngagement: (query, c) => `
${SYSTEM_PROMPT}

TEACHER'S CONTEXT:
- Teaching Grade: ${grade(c)}
- Subject: ${subject(c)}
- Classroom Type: ${classroomType(c)}
- Engagement Issue: ${query}

Provide DETAILED engagement strategies for ${grade(c)}.

MANDATORY SECTIONS:
1. Why ${grade(c)} are disengaged (specific reasons for this age group)
2. Immediate Hook (30 seconds) in ${subject(c)}
3. Interactive Activity 1 (requires ALL students to participate)
4. Interactive Activity 2 (different learning style)
5. Fun Game to make ${subject(c)} exciting for ${grade(c)}
6. Real-Life Connection to ${grade(c)} daily lives
7. Ongoing Engagement Technique for the full class period

Include SPECIFIC examples suitable for ${classroomType(c)}.`,

  flnSupport: (query, c) => `
${SYSTEM_PROMPT}

TEACHER'S CONTEXT:
- Teaching Grade: ${grade(c)}
- FLN Area: ${subject(c)}
- Classroom Type: ${classroomType(c)}
- Challenge: ${query}

Provide NIPUN Bharat-aligned strategies for ${grade(c)}.

MANDATORY SECTIONS:
1. Diagnostic Check (quick 2-minute test to identify the exact gap)
2. Foundational Skill Building (step-by-step activity with concrete examples)
3. TaRL Approach (Teaching at the Right Level for mixed abilities)
4. Fun Activity 1 (game to practice the skill, zero-cost materials)
5. Fun Activity 2 (different approach for variety)
6. Differentiation (support strugglers while challenging advanced students)
7. Progress Tracking (simple daily assessment method)
8. Parent Involvement (one activity parents can do at home)`,

  assessment: (query, c) => `
${SYSTEM_PROMPT}

TEACHER'S CONTEXT:
- Teaching Grade: ${grade(c)}
- Subject: ${subject(c)}
- Classroom Type: ${classroomType(c)}
- Assessment Need: ${query}

Provide PRACTICAL assessment methods for ${grade(c)}.

MANDATORY SECTIONS:
1. Quick Check (5 minutes) formative assessment for ${subject(c)}
2. No-Grading Method (assess without taking work home)
3. Fun Assessment Activity 1 (game-based check)
4. Fun Assessment Activity 2 (peer/self-assessment)
5. Visual Progress Tracker
6. Differentiated Questions (Easy/Medium/Hard)
7. Immediate Feedback during class
8. Next Steps based on results`,

  resourceConstrained: (query, c) => `
${SYSTEM_PROMPT}

TEACHER'S CONTEXT:
- Teaching Grade: ${grade(c)}
- Subject: ${subject(c)}
- Classroom Type: ${classroomType(c)}
- Resource Need: ${query}

Provide ZERO-COST creative solutions for ${grade(c)}.

MANDATORY SECTIONS:
1. Local Materials (stones, sticks, leaves, chalk, sand, etc.)
2. DIY Teaching Aid (step-by-step instructions)
3. Classroom Environment (use walls, floor, windows, desks creatively)
4. Student Bodies (activities using students themselves)
5. Nature-Based Activity for ${subject(c)}
6. Fun Activity 1 (zero-cost materials)
7. Fun Activity 2 (for ${classroomType(c)})
8. Peer Learning (how students can teach each other)`,

  general: (query, c) => `
${SYSTEM_PROMPT}

TEACHER'S CONTEXT:
- Teaching Grade: ${grade(c)}
- Subject: ${subject(c)}
- Classroom Type: ${classroomType(c)}
- Question: ${query}

Provide DETAILED, GRADE-SPECIFIC guidance for ${grade(c)}.

MANDATORY SECTIONS:
1. Understanding the Challenge (why this is relevant for ${grade(c)})
2. Strategy 1 (detailed approach with step-by-step example)
3. Strategy 2 (alternative method with concrete example)
4. Strategy 3 (hands-on or visual technique)
5. Fun Activity 1 (clear instructions)
6. Fun Activity 2 (different approach)
7. Quick Tips (3-4 practical tips for ${classroomType(c)})
8. Assessment (how to check if it worked)`,
};

/**
 * Select the appropriate template based on keywords in the query.
 * @param {string} query
 * @param {object} context
 * @returns {string} the fully constructed prompt
 */
function selectTemplate(query, context = {}) {
  const q = String(query).toLowerCase();

  if (q.match(/disrupt|behavior|control|manage|noise|fight|attention/)) {
    return templates.classroomManagement(query, context);
  }
  if (q.match(/explain|understand|concept|confus|difficult|teach how/)) {
    return templates.conceptExplanation(query, context);
  }
  if (q.match(/multi.?grade|different level|mixed class/)) {
    return templates.multiGradeTeaching(query, context);
  }
  if (q.match(/engag|interest|boring|motivat|participat/)) {
    return templates.studentEngagement(query, context);
  }
  if (q.match(/fln|literacy|numeracy|foundational|basic|reading|counting/)) {
    return templates.flnSupport(query, context);
  }
  if (q.match(/assess|test|evaluat|grade|check understanding/)) {
    return templates.assessment(query, context);
  }
  if (q.match(/no material|no resource|limited|poor|lack of/)) {
    return templates.resourceConstrained(query, context);
  }
  return templates.general(query, context);
}

module.exports = { selectTemplate, LANGUAGE_NAMES, languageDirective, styleDirective };
