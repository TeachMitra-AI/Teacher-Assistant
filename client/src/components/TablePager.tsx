// Footer controls for a server-paginated admin table: a "showing X–Y of N"
// count and Prev/Next. Deliberately not numbered page links — with a search
// box and filters present, jumping to page 9 is not how anyone finds a
// specific teacher, and the link row would be the widest thing on mobile.
//
// Renders nothing when everything fits on one page, so a small school never
// sees pager chrome it has no use for.
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TablePagerProps {
  /**
   * Human label for the rows, e.g. { one: 'user', many: 'users' }. Both forms
   * are required rather than derived by appending an "s", because the count
   * genuinely reaches 1 in normal use — a pending queue with one sign-up left
   * is the common case, not an edge case.
   */
  noun: { one: string; many: string };
  page: number;
  totalPages: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPageChange: (page: number) => void;
  /** Disables both buttons while a page is in flight. */
  busy?: boolean;
}

export default function TablePager({
  noun,
  page,
  totalPages,
  total,
  rangeStart,
  rangeEnd,
  hasPrev,
  hasNext,
  onPageChange,
  busy = false,
}: TablePagerProps) {
  if (total === 0) return null;
  // One page of results needs a count but no navigation.
  const showNav = totalPages > 1;
  const label = total === 1 ? noun.one : noun.many;

  return (
    <div className="table-pager">
      <p className="table-pager-count" aria-live="polite">
        {showNav ? (
          <>
            Showing <strong>{rangeStart}–{rangeEnd}</strong> of {total} {label}
          </>
        ) : (
          <>
            {total} {label}
          </>
        )}
      </p>

      {showNav && (
        <div className="table-pager-nav">
          <button
            type="button"
            className="btn-text"
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrev || busy}
            aria-label={`Previous page of ${noun.many}`}
          >
            <ChevronLeft size={16} aria-hidden="true" /> Prev
          </button>
          <span className="table-pager-page">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn-text"
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNext || busy}
            aria-label={`Next page of ${noun.many}`}
          >
            Next <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
