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
    ['/library/abc123', { tab: 'LibraryTab', screen: 'ResourceView', params: { resourceId: 'abc123' } }],
    ['/library/abc123/edit', { tab: 'LibraryTab', screen: 'ResourceEdit', params: { resourceId: 'abc123' } }],
    ['/library', { tab: 'LibraryTab', screen: 'ResourceList' }],
    ['/classroom', { tab: 'ClassroomTab', screen: 'ClassList' }],
    ['/generator', { tab: 'GeneratorTab', screen: 'GeneratorForm' }],
    ['/settings', { tab: 'MoreTab', screen: 'Settings' }],
  ] as const)('resolves %s', (link, expected) => {
    expect(resolveNotificationLink(link)).toEqual(expected);
  });

  it.each([null, undefined, '', '/', '/unknown-route', '/admin/manage'])(
    'falls back to Notifications for an unrecognized/absent link: %s',
    (link) => {
      expect(resolveNotificationLink(link)).toEqual({ tab: 'MoreTab', screen: 'Notifications' });
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

  it('is a no-op when the container is not ready', () => {
    navigationRef.isReady.mockReturnValue(false);
    navigateToNotificationLink('/library/xyz');
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });
});
