// Builds the HTML document handed to expo-print for a resource's PDF export
// (docs/mobile-app-plan.md §19, §26 Phase 5 — the window.print() replacement).
// Ports the *layout intent* of client/src/pages/ResourceWorkspace.tsx's hidden
// .print-doc (§4.5) and client/src/components/ExamHeader.tsx's letterhead —
// not their JSX/CSS verbatim, since expo-print renders a standalone HTML
// string (no app stylesheet, no React) rather than a DOM node inside the app.
import { formatResponseHtml } from './formatHtml';
import { splitAnswerKey, stripAssessmentPreamble } from './assessment';
import { LANGUAGES, RESOURCE_TYPE_META } from '../config';
import type { ExamPaperMeta, ResourceType } from '../types';

export type PrintMode = 'full' | 'student' | 'teacher';

export interface ResourcePdfInput {
  title: string;
  type: ResourceType;
  grade?: string;
  subject?: string;
  language: string;
  content: string;
  updatedAt: string;
  examMeta?: ExamPaperMeta;
  printMode: PrintMode;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Shared page chrome — deliberately plain (no brand colors) so a printed page
// reads as a document, not a screenshot of the app; matches the web print
// stylesheet's own "#111111 on white" print-body rule (index.css:4289).
const BASE_STYLE = `
  @page { margin: 28px 32px; }
  body { font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; color: #111111; font-size: 13px; line-height: 1.6; }
  h1, h2, h3, h4, h5, h6 { color: #111111; margin: 0.9em 0 0.4em; }
  h1 { font-size: 20px; } h2 { font-size: 17px; } h3, h4, h5, h6 { font-size: 14px; }
  p { margin: 0.5em 0; }
  ul, ol { padding-left: 1.4em; }
  ol { list-style: none; padding-left: 0; }
  li { margin: 0.3em 0; }
  li.fmt-li-ol { padding-left: 1.9em; text-indent: -1.9em; }
  .fmt-qnum { font-weight: 700; }
  .fmt-options { display: grid; grid-template-columns: 1fr 1fr; gap: 0.15em 1.5em; margin: 0.3em 0 0.7em 1.9em; }
  .fmt-option { margin: 0; }
  .fmt-subpart { margin: 0.3em 0 0.3em 1.9em; }
  .fmt-table { width: 100%; border-collapse: collapse; margin: 0.8em 0; }
  .fmt-table th, .fmt-table td { border: 1px solid #999999; padding: 0.35em 0.5em; text-align: left; }
  .fmt-answer-key { border-top: 2px solid #bbbbbb; padding-top: 1em; margin-top: 1.7em; page-break-before: always; }
`;

function examHeaderHtml(meta: ExamPaperMeta, fallbackTitle: string, subject?: string, grade?: string): string {
  const blank = '____________';
  const rows: string[] = [];
  rows.push(`<div class="eh-row"><span><b>Class:</b> ${grade || blank}</span><span class="eh-right"><b>Subject:</b> ${subject || blank}</span></div>`);
  if (meta.showDate || meta.teacherName) {
    rows.push(
      `<div class="eh-row">${meta.showDate ? `<span><b>Date:</b> ${meta.date || blank}</span>` : ''}${
        meta.teacherName ? `<span class="eh-right"><b>Teacher:</b> ${meta.teacherName}</span>` : ''
      }</div>`
    );
  }
  rows.push(
    `<div class="eh-row">${meta.showTime ? `<span><b>Time:</b> ${meta.time || blank}</span>` : ''}<span class="eh-right"><b>Maximum Marks:</b> ${meta.maxMarks || blank}</span></div>`
  );
  rows.push(
    `<div class="eh-row eh-student"><span>Name: ________________________________</span><span class="eh-right">Roll No.: ______________</span></div>`
  );

  return `
    <header class="exam-header">
      ${meta.schoolName ? `<div class="eh-school">${meta.schoolName}</div>` : ''}
      <div class="eh-name">${meta.examName || fallbackTitle}</div>
      <div class="eh-rows">${rows.join('')}</div>
      ${meta.customInstructions ? `<p class="eh-instructions"><b>General Instructions:</b> ${meta.customInstructions}</p>` : ''}
    </header>
  `;
}

const EXAM_HEADER_STYLE = `
  .exam-header { text-align: center; border-bottom: 2px solid #111111; padding-bottom: 0.8em; margin-bottom: 1em; }
  .eh-school { font-size: 16px; font-weight: 700; }
  .eh-name { font-size: 15px; font-weight: 600; margin-top: 0.35em; }
  .eh-rows { text-align: left; margin-top: 0.6em; font-size: 12px; }
  .eh-row { display: flex; justify-content: space-between; gap: 1.5em; margin: 0.2em 0; }
  .eh-right { margin-left: auto; text-align: right; }
  .eh-student { margin-top: 0.3em; padding-top: 0.6em; border-top: 1px dashed #111111; }
  .eh-instructions { text-align: left; font-size: 12px; margin-top: 0.6em; }
`;

/** Builds a full standalone HTML document ready for expo-print's `html` option. */
export function buildResourcePdfHtml(input: ResourcePdfInput): string {
  const { title, type, grade, subject, language, content, updatedAt, examMeta, printMode } = input;
  const isAssessment = type === 'assessment';

  if (isAssessment) {
    const split = splitAnswerKey(content || '');
    const body =
      split.hasAnswerKey && printMode === 'student' ? split.questions : content || '';
    const html = formatResponseHtml(stripAssessmentPreamble(body));
    return `<!doctype html><html><head><meta charset="utf-8" />
      <style>${BASE_STYLE}${EXAM_HEADER_STYLE}</style></head>
      <body>${examHeaderHtml(examMeta || {}, title, subject, grade)}${html}</body></html>`;
  }

  const languageLabel = LANGUAGES.find((l) => l.value === language)?.label ?? language;
  const metaLine = [
    RESOURCE_TYPE_META[type].label,
    grade && `Grade: ${grade}`,
    subject && `Subject: ${subject}`,
    `Language: ${languageLabel}`,
  ]
    .filter(Boolean)
    .join('  &middot;  ');

  const html = formatResponseHtml(content || '');
  return `<!doctype html><html><head><meta charset="utf-8" />
    <style>${BASE_STYLE}
      .doc-brand { color: #888888; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
      .doc-title { font-size: 22px; margin: 0.2em 0; }
      .doc-meta { color: #555555; font-size: 12px; margin: 0.3em 0; }
      .doc-date { color: #888888; font-size: 11px; }
      .doc-rule { border: none; border-top: 1px solid #cccccc; margin: 0.8em 0 1.2em; }
    </style></head>
    <body>
      <div class="doc-brand">Teacher Assistant</div>
      <h1 class="doc-title">${title || 'Untitled resource'}</h1>
      <p class="doc-meta">${metaLine}</p>
      <p class="doc-date">Updated ${formatDate(updatedAt)}</p>
      <hr class="doc-rule" />
      ${html}
    </body></html>`;
}
