import type { ExamPaperMeta } from '../types';

// The exam-paper letterhead — laid out like a real school examination paper
// (CBSE/State-Board convention): large centred school name, centred exam
// title, a Class/Subject row, a Time/Maximum-Marks row spread to the margins,
// Student Name / Roll No. fill-in lines, and a "General Instructions" block,
// all closed off by a strong rule. Deterministic teacher input only
// (ExamPaperMeta), never AI-generated text — rendered above the
// Markdown-rendered question body in both the on-screen preview and the print
// DOM, so what's configured in ExamHeaderEditor is exactly what prints.
//
// A field with no value still gets a blank fill-in line for Subject/Class/
// Maximum Marks (core to any exam paper); Date/Time are only shown once the
// teacher has toggled them on, so a quiz that doesn't care about scheduling
// doesn't get empty rows cluttering the header — and a toggled-on but empty
// Date/Time deliberately prints a blank line to fill in by hand.
export default function ExamHeader({
  meta, fallbackTitle, subject, grade,
}: {
  meta: ExamPaperMeta;
  fallbackTitle: string;
  subject?: string;
  grade?: string;
}) {
  const blank = '____________';

  return (
    <header className="exam-header">
      {meta.schoolName && <div className="exam-header-school">{meta.schoolName}</div>}
      <div className="exam-header-name">{meta.examName || fallbackTitle}</div>

      <div className="exam-header-rows">
        <div className="exam-header-row">
          <span><b>Class:</b> {grade || blank}</span>
          <span className="exam-header-right"><b>Subject:</b> {subject || blank}</span>
        </div>
        {(meta.showDate || meta.teacherName) && (
          <div className="exam-header-row">
            {meta.showDate && <span><b>Date:</b> {meta.date || blank}</span>}
            {meta.teacherName && <span className="exam-header-right"><b>Teacher:</b> {meta.teacherName}</span>}
          </div>
        )}
        <div className="exam-header-row">
          {meta.showTime && <span><b>Time:</b> {meta.time || blank}</span>}
          <span className="exam-header-right"><b>Maximum Marks:</b> {meta.maxMarks || blank}</span>
        </div>
        <div className="exam-header-row exam-header-student">
          <span>Name: ________________________________</span>
          <span className="exam-header-right">Roll No.: ______________</span>
        </div>
      </div>

      {meta.customInstructions && (
        <p className="exam-header-instructions"><b>General Instructions:</b> {meta.customInstructions}</p>
      )}
    </header>
  );
}
