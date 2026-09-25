import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Smartphone } from 'lucide-react';
import { AnnouncementBar } from './AnnouncementBar';
import { pickAnnouncement, type Announcement } from '../announcements';

const base: Announcement = {
  id: 'a',
  message: 'First message',
  cta: { label: 'Learn more', href: '#x' },
  icon: Smartphone,
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(cleanup);

describe('pickAnnouncement', () => {
  const now = new Date('2026-10-15');

  test('returns the first active entry and null when none are', () => {
    expect(pickAnnouncement([base], now)?.id).toBe('a');
    expect(pickAnnouncement([], now)).toBeNull();
  });

  test('skips entries outside their startsAt/endsAt window', () => {
    const upcoming = { ...base, id: 'upcoming', startsAt: '2026-11-01' };
    const expired = { ...base, id: 'expired', endsAt: '2026-10-01' };
    const current = { ...base, id: 'current', startsAt: '2026-10-01', endsAt: '2026-10-31' };
    expect(pickAnnouncement([upcoming, expired, current], now)?.id).toBe('current');
    expect(pickAnnouncement([upcoming, expired], now)).toBeNull();
  });
});

describe('AnnouncementBar', () => {
  test('renders a labelled region with the message and CTA link', () => {
    render(<AnnouncementBar announcements={[base]} />);
    const region = screen.getByRole('region', { name: 'Announcement' });
    expect(region).toHaveTextContent('First message');
    expect(screen.getByRole('link', { name: /Learn more/ })).toHaveAttribute('href', '#x');
  });

  test('renders nothing when no announcement is active', () => {
    const { container } = render(<AnnouncementBar announcements={[{ ...base, endsAt: '2020-01-01' }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('dismissing hides it for the rest of the session (survives a remount), but is never written to localStorage', () => {
    const { unmount } = render(<AnnouncementBar announcements={[base]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }));
    expect(screen.queryByRole('region', { name: 'Announcement' })).toBeNull();
    unmount();

    render(<AnnouncementBar announcements={[base]} />);
    expect(screen.queryByRole('region', { name: 'Announcement' })).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  test('comes back on a new visit (fresh session), and an old localStorage flag is ignored', () => {
    localStorage.setItem('announcement-dismissed:a', '1');
    render(<AnnouncementBar announcements={[base]} />);
    expect(screen.getByRole('region', { name: 'Announcement' })).toBeInTheDocument();
  });

  test('a new announcement id appears even after an older one was dismissed', () => {
    sessionStorage.setItem('announcement-dismissed:a', '1');
    render(<AnnouncementBar announcements={[{ ...base, id: 'b', message: 'Second message' }]} />);
    expect(screen.getByRole('region', { name: 'Announcement' })).toHaveTextContent('Second message');
  });

  test('dismissible: false hides the close button', () => {
    render(<AnnouncementBar announcements={[{ ...base, dismissible: false }]} />);
    expect(screen.queryByRole('button', { name: 'Dismiss announcement' })).toBeNull();
  });

  test('shows the short message alongside the full one when provided', () => {
    render(<AnnouncementBar announcements={[{ ...base, shortMessage: 'Short one' }]} />);
    const region = screen.getByRole('region', { name: 'Announcement' });
    expect(region).toHaveTextContent('First message');
    expect(region).toHaveTextContent('Short one');
  });
});
