import type { LucideIcon } from 'lucide-react';
import { Smartphone } from 'lucide-react';

// The site-wide announcement shown by <AnnouncementBar /> at the top of the
// home page. To change what visitors see, edit this list — nothing else.
//
// - The first entry that is active (inside its startsAt/endsAt window, when
//   given) is shown; only one announcement is ever shown at a time.
// - `id` is the dismissal key: a visitor who closes the bar stays dismissed
//   for that id only, so a NEW announcement (new id) appears for everyone.
// - The home page is prerendered at build time, so an expired entry still
//   sits in the static HTML until the next deploy. Treat `endsAt` as a safety
//   net and remove old entries when you next ship.
// - Same rule as the rest of this page: claim only what ships. No launch
//   dates, offers, prices or store links until they are real.
export interface Announcement {
  id: string;
  message: string;
  // Optional shorter copy for narrow screens; falls back to `message`.
  shortMessage?: string;
  cta: { label: string; href: string };
  icon: LucideIcon;
  // ISO date strings, e.g. '2026-11-01'. Both optional.
  startsAt?: string;
  endsAt?: string;
  // Defaults to true. Set false for something visitors must not close.
  dismissible?: boolean;
}

export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: 'android-coming-soon',
    message: 'SarasTech for Android is coming soon.',
    shortMessage: 'Android app coming soon',
    cta: { label: 'Learn more', href: '#android' },
    icon: Smartphone,
  },
];

export function pickAnnouncement(list: readonly Announcement[], now: Date): Announcement | null {
  return (
    list.find((a) => {
      if (a.startsAt && now < new Date(a.startsAt)) return false;
      if (a.endsAt && now > new Date(a.endsAt)) return false;
      return true;
    }) ?? null
  );
}
