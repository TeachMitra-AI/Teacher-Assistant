import type { ExamPaperMeta } from '../types';

// The exam-paper letterhead, laid out like a real school paper (CBSE/State-Board convention): centred school name and title,
// a Class/Subject row, a Time/Maximum-Marks row, Student Name / Roll No. lines and a "General Instructions" block, closed
// by a strong rule. Deterministic teacher input only (ExamPaperMeta), never AI text, rendered above the question body in
// both preview and print so ExamHeaderEditor's settings are exactly what prints.
// Subject/Class/Maximum Marks always get a fill-in line (core to an exam paper); Date/Time appear only when toggled on, and
// a toggled-on empty one prints a blank line to fill by hand.
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
