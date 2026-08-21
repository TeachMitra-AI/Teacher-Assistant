// Component tests for the Phase 5 Library list screen (docs/mobile-app-plan.md
// §26 Phase 5 — matches LibraryPage.tsx's list/search/filter/delete
// behavior). api/resources.ts is mocked here — its own request-shaping is
// covered by api/__tests__/resources.test.ts. `navigation`/`route` are
// passed as plain mock objects since the screen reads them from props, not
// from React Navigation context, so no NavigationContainer is needed.
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ApiError } from '../../../api/client';
import { ResourceListScreen } from '../ResourceListScreen';

jest.mock('../../../api/resources', () => ({
  listResources: jest.fn(),
  deleteResource: jest.fn(),
}));
const { listResources, deleteResource } = jest.requireMock('../../../api/resources') as {
  listResources: jest.Mock;
  deleteResource: jest.Mock;
};

function makeNavigation() {
  return { navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
}

function renderScreen(navigation = makeNavigation()) {
  const utils = render(
    <ThemeProvider>
      <ResourceListScreen navigation={navigation as never} route={{ key: 'r', name: 'ResourceList', params: undefined } as never} />
    </ThemeProvider>
  );
  return { ...utils, navigation };
}

const RESOURCE = {
  id: 'res1',
  type: 'lesson_plan' as const,
  title: 'Photosynthesis Lesson',
  grade: 'Class 6-8',
  subject: 'Science',
  language: 'en',
  content: 'Explain how plants make food using sunlight.',
  structured: null,
  sourceQueryId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

describe('ResourceListScreen', () => {
  beforeEach(() => {
    listResources.mockReset();
    deleteResource.mockReset();
  });

  afterEach(() => {
    // Always restore real timers, even if a fake-timers test's own assertion
    // throws first — otherwise every later test's waitFor() hangs/fails.
    jest.useRealTimers();
  });

  it('shows a loading state, then the empty state when the library has nothing saved', async () => {
    listResources.mockResolvedValueOnce([]);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Your library is empty')).toBeTruthy());
  });

  it('renders saved resources as cards once loaded', async () => {
    listResources.mockResolvedValueOnce([RESOURCE]);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Photosynthesis Lesson')).toBeTruthy());
    expect(within(screen.getByTestId('library-list')).getByText('Lesson Plan')).toBeTruthy();
  });

  it('tapping a resource card navigates to ResourceView with its id', async () => {
    listResources.mockResolvedValueOnce([RESOURCE]);
    const navigation = makeNavigation();
    await act(async () => {
      renderScreen(navigation);
    });
    await waitFor(() => screen.getByText('Photosynthesis Lesson'));
    await fireEvent.press(screen.getByText('Photosynthesis Lesson'));
    expect(navigation.navigate).toHaveBeenCalledWith('ResourceView', { resourceId: 'res1' });
  });

  it('tapping a type filter chip re-queries with that type', async () => {
    listResources.mockResolvedValueOnce([RESOURCE]);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(listResources).toHaveBeenCalledWith({ type: '', q: '' }));

    listResources.mockResolvedValueOnce([]);
    await fireEvent.press(screen.getByText('Assessment'));
    await waitFor(() => expect(listResources).toHaveBeenLastCalledWith({ type: 'assessment', q: '' }));
  });

  it('debounces the search box before querying', async () => {
    jest.useFakeTimers();
    listResources.mockResolvedValue([]);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(listResources).toHaveBeenCalledTimes(1));

    await fireEvent.changeText(screen.getByLabelText('Search your library'), 'fractions');
    // Not yet — debounce hasn't elapsed.
    expect(listResources).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(listResources).toHaveBeenLastCalledWith({ type: '', q: 'fractions' }));
  });

  it('deleting a resource confirms, then removes it from the list on success', async () => {
    listResources.mockResolvedValueOnce([RESOURCE]);
    deleteResource.mockResolvedValueOnce(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });

    await act(async () => {
      renderScreen();
    });
    await waitFor(() => screen.getByText('Photosynthesis Lesson'));
    await fireEvent.press(screen.getByLabelText('Delete Photosynthesis Lesson'));

    await waitFor(() => expect(deleteResource).toHaveBeenCalledWith('res1'));
    await waitFor(() => expect(screen.queryByText('Photosynthesis Lesson')).toBeNull());
  });

  it('rolls back the optimistic delete if the server call fails', async () => {
    listResources.mockResolvedValueOnce([RESOURCE]);
    deleteResource.mockRejectedValueOnce(new ApiError('Could not delete.', 500));
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });

    await act(async () => {
      renderScreen();
    });
    await waitFor(() => screen.getByText('Photosynthesis Lesson'));
    await fireEvent.press(screen.getByLabelText('Delete Photosynthesis Lesson'));

    await waitFor(() => expect(deleteResource).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Photosynthesis Lesson')).toBeTruthy());
  });
});
