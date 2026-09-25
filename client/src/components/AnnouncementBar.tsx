import { useEffect, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { ANNOUNCEMENTS, pickAnnouncement, type Announcement } from '../announcements';

// Slim, non-sticky strip above the home page header. Content comes from
// announcements.ts; this component only picks the active entry and handles
// dismissal. Prerendered HTML shows the bar; a visitor who dismissed it
// earlier in this browser tab session has it hidden right after mount
// (sessionStorage is read in an effect, so server/prerender output and the
// first client render always match).

// sessionStorage on purpose: the X hides the bar for the current visit only, and
// it comes back on the next visit. Do not switch this to localStorage.
const STORAGE_PREFIX = 'announcement-dismissed:';

function wasDismissed(id: string): boolean {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + id) === '1';
  } catch {
    return false;
  }
}

interface AnnouncementBarProps {
  announcements?: readonly Announcement[];
  now?: Date;
}

export function AnnouncementBar({ announcements = ANNOUNCEMENTS, now }: AnnouncementBarProps) {
  const announcement = pickAnnouncement(announcements, now ?? new Date());
  const [dismissed, setDismissed] = useState(false);

  const id = announcement?.id;
  useEffect(() => {
    if (id && wasDismissed(id)) setDismissed(true);
  }, [id]);

  if (!announcement || dismissed) return null;

  const Icon = announcement.icon;
  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(STORAGE_PREFIX + announcement.id, '1');
    } catch {
      // Storage blocked: dismissal just lasts for this page view.
    }
  };

  return (
    <div className="home-announcement" role="region" aria-label="Announcement">
      <div className="home-announcement-inner">
        <Icon size={16} aria-hidden="true" className="home-announcement-icon" />
        <p className="home-announcement-text">
          {announcement.shortMessage ? (
            <>
              <span className="home-announcement-full">{announcement.message}</span>
              <span className="home-announcement-short">{announcement.shortMessage}</span>
            </>
          ) : (
            announcement.message
          )}
        </p>
        <a className="home-announcement-link" href={announcement.cta.href}>
          {announcement.cta.label}
          <ArrowRight size={14} aria-hidden="true" />
        </a>
        {announcement.dismissible !== false && (
          <button type="button" className="home-announcement-close" onClick={dismiss} aria-label="Dismiss announcement">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
