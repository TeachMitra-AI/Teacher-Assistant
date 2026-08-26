// resolveNotificationLink()/navigateToNotificationLink() (Phase 7b,
// mobile/src/notifications/pushLinking.ts) — the link->route table plus its
// navigationRef wiring.
import { resolveNotificationLink, navigateToNotificationLink } from '../pushLinking';

jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: { isReady: jest.fn(), navigate: jest.fn() },
}));
const { navigationRef } = jest.requireMock('../../navigation/navigationRef') as {
  navigationRef: { isReady: jest.Mock; navigate: jest.Mock };
};

describe('resolveNotificationLink', () => {
  it.each([
    ['/library/abc123', { kind: 'tab', tab: 'LibraryTab', screen: 'ResourceView', params: { resourceId: 'abc123' } }],
    ['/library/abc123/edit', { kind: 'tab', tab: 'LibraryTab', screen: 'ResourceEdit', params: { resourceId: 'abc123' } }],
    ['/library', { kind: 'tab', tab: 'LibraryTab', screen: 'ResourceList' }],
    ['/classroom', { kind: 'tab', tab: 'ClassroomTab', screen: 'ClassList' }],
    ['/generator', { kind: 'tab', tab: 'GeneratorTab', screen: 'GeneratorForm' }],
    ['/settings', { kind: 'root', screen: 'Settings' }],
  ] as const)('resolves %s', (link, expected) => {
    expect(resolveNotificationLink(link)).toEqual(expected);
  });

  it.each([null, undefined, '', '/', '/unknown-route', '/admin/manage'])(
    'falls back to Notifications for an unrecognized/absent link: %s',
    (link) => {
      expect(resolveNotificationLink(link)).toEqual({ kind: 'root', screen: 'Notifications' });
    }
  );
});

describe('navigateToNotificationLink', () => {
  beforeEach(() => {
    navigationRef.isReady.mockReset();
    navigationRef.navigate.mockReset();
  });

  it('navigates via the resolved tab/screen/params when the container is ready', () => {
    navigationRef.isReady.mockReturnValue(true);
    navigateToNotificationLink('/library/xyz');
    expect(navigationRef.navigate).toHaveBeenCalledWith('LibraryTab', {
      screen: 'ResourceView',
      params: { resourceId: 'xyz' },
    });
  });

  it('navigates via a plain root-level screen name for Notifications/Settings', () => {
    navigationRef.isReady.mockReturnValue(true);
    navigateToNotificationLink('/settings');
    expect(navigationRef.navigate).toHaveBeenCalledWith('Settings');
  });

  it('is a no-op when the container is not ready', () => {
    navigationRef.isReady.mockReturnValue(false);
    navigateToNotificationLink('/library/xyz');
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });
});
