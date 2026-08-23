// Maps a Notification.link string (server/prisma/schema.prisma's doc
// comment: "relative in-app path", e.g. "/library/<id>" — the SAME value the
// web client's NotificationBell already navigates to verbatim via React
// Router, client/src/components/Notifications.tsx:171) onto this app's own
// stack/tab route names. This is the ONE new piece Phase 7b adds on top of
// Phase 7's existing Notification model — reusing the `link` field and the
// route names navigation/types.ts already stubbed out for exactly this
// purpose ("deep linking... Phase 7b's push-notification `link` field...
// eventually target routes by these names"), not inventing a parallel
// deep-link model.
//
// Deliberately a plain path->route table, not a general router: the only
// links ever produced today are system-generated "/library/<id>"
// (routes/resources.js) and whatever an admin free-types into a broadcast's
// optional `link` field (routes/notifications.js's sendSchema — validated
// server-side only as "starts with / and has no whitespace", i.e. shaped
// like a WEB route, since the same field also feeds the web client). Any
// link this table doesn't recognize falls back to the Notifications screen
// itself — always a safe, always-mounted destination, and contextually the
// right one for a link this app doesn't have a screen for yet.
import { navigationRef } from '../navigation/navigationRef';

type ResolvedRoute = {
  tab: 'LibraryTab' | 'ClassroomTab' | 'GeneratorTab' | 'MoreTab';
  screen: string;
  params?: Record<string, unknown>;
};

const FALLBACK: ResolvedRoute = { tab: 'MoreTab', screen: 'Notifications' };

export function resolveNotificationLink(link: string | null | undefined): ResolvedRoute {
  if (!link) return FALLBACK;

  const editMatch = link.match(/^\/library\/([^/?#]+)\/edit\/?$/);
  if (editMatch) return { tab: 'LibraryTab', screen: 'ResourceEdit', params: { resourceId: editMatch[1] } };

  const viewMatch = link.match(/^\/library\/([^/?#]+)\/?$/);
  if (viewMatch) return { tab: 'LibraryTab', screen: 'ResourceView', params: { resourceId: viewMatch[1] } };

  if (/^\/library\/?$/.test(link)) return { tab: 'LibraryTab', screen: 'ResourceList' };
  if (/^\/classroom\/?$/.test(link)) return { tab: 'ClassroomTab', screen: 'ClassList' };
  if (/^\/generator\/?$/.test(link)) return { tab: 'GeneratorTab', screen: 'GeneratorForm' };
  if (/^\/settings\/?$/.test(link)) return { tab: 'MoreTab', screen: 'Settings' };

  return FALLBACK;
}

/**
 * Navigates to a Notification's `link`, imperatively (via navigationRef —
 * see that file's header for why: a push tap can arrive before/outside any
 * particular screen's own component tree). A no-op, not a crash, if the
 * NavigationContainer isn't mounted/ready yet or the target route doesn't
 * exist in whatever's currently rendered (e.g. the signed-out tree) —
 * react-native-navigation already treats both cases as safe no-ops.
 */
export function navigateToNotificationLink(link: string | null | undefined): void {
  if (!navigationRef.isReady()) return;
  const { tab, screen, params } = resolveNotificationLink(link);
  navigationRef.navigate(tab, { screen, params });
}
