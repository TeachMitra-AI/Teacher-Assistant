import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, AlertTriangle, Search, Download, ArrowUpDown, Pencil } from 'lucide-react';
import { ApiError } from '../../api';
import {
  getSchoolHistory,
  getTeacherAttendanceDetail,
  getSchoolConfig,
  getHolidays,
  getTodaySummary,
  downloadSchoolAttendanceReport,
} from '../../lib/teacherAttendanceApi';
import { addMonths, currentMonthString, formatMonthLabel, todayDateString } from '../../lib/classroomDate';
import {
  buildMonthDates,
  sinceDateFor,
  buildRows,
  summarizeRows,
  formatSummary,
  type HistoryRow,
  type HistorySummary,
} from '../../lib/teacherAttendanceCalendar';
import AttendanceCorrectionForm from './AttendanceCorrectionForm';
import HistoryDayRow from './HistoryDayRow';
import MiniCalendarStrip from './MiniCalendarStrip';
import type {
  SchoolHistoryTeacherSummary,
  TeacherAttendanceDetailDto,
  TeacherAttendanceSummary,
  TeacherAttendanceTodaySummary,
} from '../../types';

const TREND_MONTHS = 6;

function monthShortLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'short' });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const CURRENT_MONTH = currentMonthString();
// Server-side pagination (docs/feature-teacher-attendance-implementation-plan.md
// §7) — the list only ever loads this many teachers' summaries at once, no
// matter how large the school. A specific teacher's full day-by-day detail
// is a separate, on-demand fetch (loadDetail below), not part of this page.
const PAGE_SIZE = 25;

type SortKey = 'name' | keyof TeacherAttendanceSummary;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Teacher' },
  { key: 'present', label: 'Present' },
  { key: 'absent', label: 'Absent' },
  { key: 'late', label: 'Late' },
  { key: 'half_day', label: 'Half day' },
  { key: 'on_leave', label: 'On leave' },
  { key: 'on_duty', label: 'On duty' },
  { key: 'flagged_review', label: 'Needs review' },
  { key: 'pending_regularization', label: 'Missing checkout' },
];

export default function ReportsTab() {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [teachers, setTeachers] = useState<SchoolHistoryTeacherSummary[]>([]);
  const [total, setTotal] = useState(0);
  // `loading` is true only until the very first load finishes — it drives
  // the full-page skeleton for the empty-shell case. Every load after that
  // (paging, searching, changing month, or a background refresh triggered
  // from the detail view) flips `fetching` instead, which just dims the
  // existing table/cards in place — replacing the whole tab with a generic
  // skeleton on every keystroke or page click felt jarring, and briefly
  // wiped out an already-open teacher detail view too (its own
  // detailLoading skeleton was never the one hiding it — this top-level one
  // was, since it renders unconditionally regardless of selectedTeacherId).
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  // config/holidays are school-wide, fetched once per month and shared by
  // whichever teacher's drill-down is opened.
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getSchoolConfig>>>(null);
  const [holidays, setHolidays] = useState<Awaited<ReturnType<typeof getHolidays>>>([]);

  // Which teacher's own day-by-day view is open — set, the table is
  // replaced by that one teacher's detail (with a way back), not expanded
  // inline: a list of days doesn't fit inside a table cell without either
  // fighting the grid or getting cut off in the horizontal scroll.
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [detailRecords, setDetailRecords] = useState<TeacherAttendanceDetailDto[]>([]);
  const [detailTeacher, setDetailTeacher] = useState<{ id: string; name: string; email: string; createdAt: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  // Which single day, within the open drill-down, has its correction form
  // open — at most one at a time, closed whenever the drill-down changes.
  const [correctingDate, setCorrectingDate] = useState<string | null>(null);

  // Today's four dashboard numbers — the landing glance before the table
  // (docs/attendance-register-design.html §5).
  const [todaySummary, setTodaySummary] = useState<TeacherAttendanceTodaySummary | null>(null);

  // 6-month trend (late + missing-checkout count per month) for whichever
  // teacher's drill-down is open — so "getting better or worse" is visible
  // without opening six separate months (design doc §11).
  const [trend, setTrend] = useState<{ month: string; count: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  const load = useCallback(async () => {
    setFetching(true);
    setError('');
    try {
      const [listData, schoolConfig, holidayList] = await Promise.all([
        getSchoolHistory(month, { page, pageSize: PAGE_SIZE, search: search.trim() || undefined }),
        getSchoolConfig(),
        getHolidays(),
      ]);
      setTeachers(listData.teachers);
      setTotal(listData.total);
      setConfig(schoolConfig);
      setHolidays(holidayList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the school report.');
    } finally {
      setFetching(false);
      setLoading(false);
    }
  }, [month, page, search]);

  useEffect(() => {
    // A short debounce on search — a keystroke shouldn't fire a fresh
    // paginated query on every character.
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    getTodaySummary().then(setTodaySummary).catch(() => {}); // dashboard cards are a nicety — a failure here shouldn't block the rest of the page
  }, []);

  // Changing month or search invalidates the current page number.
  useEffect(() => {
    setPage(1);
  }, [month, search]);

  const needsLookCount = useMemo(
    () => teachers.filter((t) => t.summary.flagged_review > 0 || t.summary.pending_regularization > 0).length,
    [teachers]
  );

  const filtered = useMemo(() => {
    // Client-side, on just this page's rows — matches search/pagination's
    // server-side scope; a teacher needing a look on a different page still
    // needs that page opened to be seen. (Same tradeoff as sorting below.)
    if (!onlyFlagged) return teachers;
    return teachers.filter((t) => t.summary.flagged_review > 0 || t.summary.pending_regularization > 0);
  }, [teachers, onlyFlagged]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = sortKey === 'name' ? a.name.localeCompare(b.name) : a.summary[sortKey] - b.summary[sortKey];
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc'); // counts: biggest first is usually what you want first
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setDownloadError('');
    try {
      await downloadSchoolAttendanceReport(month);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : 'Could not download the report.');
    } finally {
      setDownloading(false);
    }
  }

  const loadDetail = useCallback(
    async (teacherId: string) => {
      setDetailLoading(true);
      setDetailError('');
      setCorrectingDate(null);
      try {
        const data = await getTeacherAttendanceDetail(teacherId, month);
        setDetailTeacher(data.teacher);
        setDetailRecords(data.records);
      } catch (err) {
        setDetailError(err instanceof ApiError ? err.message : 'Could not load this teacher\'s attendance.');
      } finally {
        setDetailLoading(false);
      }
    },
    [month]
  );

  const loadTrend = useCallback(
    async (teacherId: string) => {
      setTrendLoading(true);
      try {
        // Oldest to newest, ending at the currently-viewed month.
        const months = Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(month, -(TREND_MONTHS - 1 - i)));
        const results = await Promise.all(
          months.map((m) => getTeacherAttendanceDetail(teacherId, m).catch(() => null))
        );
        setTrend(
          months.map((m, i) => {
            const records = results[i]?.records ?? [];
            // Raw-record count, not the day-filled buildRows/summarizeRows —
            // a past month's records already unambiguously show a real
            // late arrival or a real gap, with no weekly-off/holiday
            // context needed to tell them apart from an ordinary day off.
            const count = records.filter((r) => (r.lateMinutes ?? 0) > 0 || (r.checkInAt && !r.checkOutAt)).length;
            return { month: m, count };
          })
        );
      } finally {
        setTrendLoading(false);
      }
    },
    [month]
  );

  function openTeacher(teacherId: string) {
    setSelectedTeacherId(teacherId);
    void loadDetail(teacherId);
    void loadTrend(teacherId);
  }

  function backToAllTeachers() {
    setSelectedTeacherId(null);
    setDetailTeacher(null);
    setDetailRecords([]);
    setTrend([]);
    setCorrectingDate(null);
  }

  function handleCorrected() {
    setCorrectingDate(null);
    if (selectedTeacherId) {
      void loadDetail(selectedTeacherId); // reflect the correction immediately
      void loadTrend(selectedTeacherId);
    }
    void load(); // the summary counts on the list also just changed
    getTodaySummary().then(setTodaySummary).catch(() => {});
  }

  const detailByDate = useMemo(() => new Map(detailRecords.map((r) => [r.date, r])), [detailRecords]);

  const detailRows: HistoryRow[] = useMemo(() => {
    if (!detailTeacher) return [];
    const dates = config
      ? buildMonthDates(month, todayDateString(), sinceDateFor(config, detailTeacher.createdAt))
      : detailRecords.map((r) => r.date);
    return buildRows(dates, detailRecords, config, holidays);
  }, [detailTeacher, detailRecords, config, holidays, month]);

  const detailSummary: HistorySummary | null = detailTeacher ? summarizeRows(detailRows) : null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A count only turns into a coloured warning once it crosses the school's
  // own configured pattern threshold — a single one-off shouldn't look as
  // alarming as a genuine repeat (design doc §6/§10).
  const patternThreshold = config?.repeatPatternThreshold ?? 1;

  return (
    <div>
      <div className="attendance-date-nav">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="attendance-date-display">{formatMonthLabel(month)}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next month"
          disabled={month >= CURRENT_MONTH}
          onClick={() => setMonth((m) => addMonths(m, 1))}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      {loading && (
        <div className="run-skeleton" aria-label="Loading">
          <div className="sk-line" />
          <div className="sk-line" />
          <div className="sk-line" />
        </div>
      )}

      {!loading && error && (
        <div className="attendance-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && !selectedTeacherId && todaySummary && !todaySummary.nonWorkingDay && (
        <div className="attendance-stat-grid">
          <div className="attendance-stat-card present">
            <span className="attendance-stat-card-n">{todaySummary.present}</span>
            <span className="attendance-stat-card-l">Present today</span>
          </div>
          <div className="attendance-stat-card warning">
            <span className="attendance-stat-card-n">{todaySummary.late}</span>
            <span className="attendance-stat-card-l">Late today</span>
          </div>
          <div className="attendance-stat-card warning">
            <span className="attendance-stat-card-n">{todaySummary.missingCheckout}</span>
            <span className="attendance-stat-card-l">Missing checkout</span>
          </div>
          <div className="attendance-stat-card absent">
            <span className="attendance-stat-card-n">{todaySummary.absent}</span>
            <span className="attendance-stat-card-l">Absent, no leave on file</span>
          </div>
        </div>
      )}

      {!loading && !error && !selectedTeacherId && todaySummary?.nonWorkingDay && (
        <p className="attendance-hint">{todaySummary.nonWorkingDay.message}</p>
      )}

      {!loading && !error && selectedTeacherId && (
        <div className="attendance-reports-detail attendance-fade-in">
          <button type="button" className="btn-text attendance-reports-back" onClick={backToAllTeachers}>
            <ArrowLeft size={15} aria-hidden="true" />
            Back to all teachers
          </button>
          {detailLoading && (
            <div className="run-skeleton" aria-label="Loading">
              <div className="sk-line" />
              <div className="sk-line" />
              <div className="sk-line" />
            </div>
          )}
          {!detailLoading && detailError && (
            <div className="attendance-error" role="alert">
              <span>{detailError}</span>
            </div>
          )}
          {!detailLoading && !detailError && detailTeacher && detailSummary && (
            <>
              <div className="attendance-reports-detail-header">
                <span className="attendance-reports-avatar attendance-reports-avatar-lg" aria-hidden="true">
                  {initials(detailTeacher.name)}
                </span>
                <div>
                  <h3 className="attendance-subhead">{detailTeacher.name}</h3>
                  <p className="attendance-reports-email">{detailTeacher.email}</p>
                </div>
              </div>

              <div className="attendance-reports-panels">
                {!trendLoading && trend.length > 0 && (
                  <div className="attendance-reports-panel">
                    <h4 className="attendance-reports-panel-title">Late &amp; missing-checkout trend</h4>
                    <div className="attendance-trend-strip">
                      {(() => {
                        const max = Math.max(1, ...trend.map((t) => t.count));
                        return trend.map((t) => {
                          const ratio = t.count / max;
                          const cls = t.count === 0 ? '' : ratio >= 0.66 ? 'hi' : 'mid';
                          return (
                            <div
                              key={t.month}
                              className={`attendance-trend-bar ${cls}`}
                              style={{ height: `${Math.max(6, ratio * 100)}%` }}
                              title={`${monthShortLabel(t.month)}: ${t.count}`}
                            />
                          );
                        });
                      })()}
                    </div>
                    <div className="attendance-trend-labels">
                      {trend.map((t) => (
                        <span key={t.month}>{monthShortLabel(t.month)}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="attendance-reports-panel">
                  <h4 className="attendance-reports-panel-title">This month</h4>
                  <MiniCalendarStrip rows={detailRows} />
                  <p className="attendance-summary">{formatSummary(detailSummary)}</p>
                </div>
              </div>

              <h4 className="attendance-reports-panel-title attendance-reports-daybyday-title">Day by day</h4>
              <ul className="attendance-history-list">
                {detailRows.map((row) => {
                  const detailRecord = row.record ? detailByDate.get(row.date) : undefined;
                  if (correctingDate === row.date && detailRecord) {
                    return (
                      <li key={row.date}>
                        <AttendanceCorrectionForm
                          entry={detailRecord}
                          onResolved={handleCorrected}
                          onCancel={() => setCorrectingDate(null)}
                        />
                      </li>
                    );
                  }
                  return (
                    <HistoryDayRow
                      key={row.date}
                      row={row}
                      action={
                        row.record ? (
                          <button
                            type="button"
                            className="btn-text attendance-drilldown-correct"
                            onClick={() => setCorrectingDate(row.date)}
                          >
                            <Pencil size={12} aria-hidden="true" />
                            Correct
                          </button>
                        ) : undefined
                      }
                    />
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {!loading && !error && !selectedTeacherId && (
        <div className="attendance-fade-in">
          <div className="attendance-reports-toolbar">
            <div className="attendance-review-search">
              <Search size={15} aria-hidden="true" />
              <input
                className="text-input"
                type="search"
                placeholder="Search by teacher name"
                aria-label="Search by teacher name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              className={`attendance-reports-filter-chip${onlyFlagged ? ' active' : ''}`}
              aria-pressed={onlyFlagged}
              onClick={() => setOnlyFlagged((v) => !v)}
            >
              Needs a look
              {needsLookCount > 0 && <span className="attendance-reports-filter-chip-count">{needsLookCount}</span>}
            </button>
            <button type="button" className="btn-text attendance-reports-download" onClick={handleDownload} disabled={downloading}>
              <Download size={15} aria-hidden="true" />
              {downloading ? 'Downloading…' : 'Download Excel'}
            </button>
          </div>

          {/* A slim top-edge progress bar for every load AFTER the first —
              paging, searching, changing month, or a background refresh —
              so the table/toolbar stay in place instead of flashing back to
              the generic skeleton on every interaction. Always mounted at a
              fixed height so toggling it on/off never shifts the layout. */}
          <div className={`attendance-reports-progress-track${fetching ? ' active' : ''}`} aria-hidden="true">
            <div className="attendance-reports-progress-bar" />
          </div>

          {downloadError && (
            <div className="attendance-error" role="alert">
              <span>{downloadError}</span>
            </div>
          )}

          {sorted.length === 0 && (
            <p className="attendance-hint">
              {search.trim()
                ? `No teachers match "${search.trim()}".`
                : onlyFlagged
                  ? 'No teachers need a look right now.'
                  : 'No teachers found.'}
            </p>
          )}

          {sorted.length > 0 && (
            <div className="attendance-reports-table-wrap">
              <table className="attendance-reports-table">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={[
                          col.key === 'name' ? '' : 'attendance-reports-num-col',
                          col.key === 'flagged_review' ? 'attendance-reports-divider-col' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <button
                          type="button"
                          className={`attendance-reports-sort-btn${sortKey === col.key ? ' active' : ''}`}
                          onClick={() => handleSort(col.key)}
                        >
                          {col.label}
                          {sortKey === col.key ? (
                            sortDir === 'asc' ? (
                              <ChevronUp size={13} aria-hidden="true" />
                            ) : (
                              <ChevronDown size={13} aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown size={12} aria-hidden="true" className="attendance-reports-sort-idle" />
                          )}
                        </button>
                      </th>
                    ))}
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.id} className="attendance-reports-row" onClick={() => openTeacher(r.id)}>
                      <td>
                        <div className="attendance-reports-name-cell">
                          <span className="attendance-reports-avatar" aria-hidden="true">{initials(r.name)}</span>
                          <span className="attendance-reports-name-text">
                            <span className="attendance-reports-name-primary">{r.name}</span>
                            {/* Two teachers can share a display name — the
                                email is the only thing that actually tells
                                them apart. Truncated with an ellipsis (see
                                CSS) rather than forcing the whole column
                                wide — some of these run 40+ characters. */}
                            <span className="attendance-reports-email">{r.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="attendance-reports-num-col">
                        <span className={r.summary.present === 0 ? 'attendance-reports-zero' : undefined}>{r.summary.present}</span>
                      </td>
                      <td className="attendance-reports-num-col">
                        <span className={r.summary.absent === 0 ? 'attendance-reports-zero' : undefined}>{r.summary.absent}</span>
                      </td>
                      <td className="attendance-reports-num-col">
                        <span className={r.summary.late === 0 ? 'attendance-reports-zero' : undefined}>{r.summary.late}</span>
                      </td>
                      <td className="attendance-reports-num-col">
                        <span className={r.summary.half_day === 0 ? 'attendance-reports-zero' : undefined}>{r.summary.half_day}</span>
                      </td>
                      <td className="attendance-reports-num-col">
                        <span className={r.summary.on_leave === 0 ? 'attendance-reports-zero' : undefined}>{r.summary.on_leave}</span>
                      </td>
                      <td className="attendance-reports-num-col">
                        <span className={r.summary.on_duty === 0 ? 'attendance-reports-zero' : undefined}>{r.summary.on_duty}</span>
                      </td>
                      <td className="attendance-reports-num-col attendance-reports-divider-col">
                        {r.summary.flagged_review > 0 ? (
                          <span className={`attendance-reports-badge${r.summary.flagged_review >= patternThreshold ? ' warn' : ''}`}>
                            {r.summary.flagged_review}
                          </span>
                        ) : (
                          <span className="attendance-reports-zero">0</span>
                        )}
                      </td>
                      <td className="attendance-reports-num-col">
                        {r.summary.pending_regularization > 0 ? (
                          <span className={`attendance-reports-badge${r.summary.pending_regularization >= patternThreshold ? ' warn' : ''}`}>
                            {r.summary.pending_regularization}
                          </span>
                        ) : (
                          <span className="attendance-reports-zero">0</span>
                        )}
                      </td>
                      <td className="attendance-reports-chevron-col">
                        <ChevronRight size={16} aria-hidden="true" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="attendance-reports-pagination">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} teachers
                </span>
                <div className="attendance-reports-pagination-btns">
                  <button type="button" className="btn-text" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button type="button" className="btn-text" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
