// Component tests for the Phase 5 Library view screen (docs/mobile-app-plan.md
// §26 Phase 5 — matches ResourceView.tsx's view/delete behavior, plus the
// export/share flow that replaces window.print(), §19). api/resources.ts,
// expo-print, and expo-sharing are mocked here.
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ApiError } from '../../../api/client';
import { ResourceViewScreen } from '../ResourceViewScreen';

jest.mock('../../../api/resources', () => ({
  getResource: jest.fn(),
  deleteResource: jest.fn(),
}));
const { getResource, deleteResource } = jest.requireMock('../../../api/resources') as {
  getResource: jest.Mock;
  deleteResource: jest.Mock;
};

const RESOURCE = {
  id: 'res1',
  type: 'lesson_plan' as const,
  title: 'Photosynthesis Lesson',
  grade: 'Class 6-8',
  subject: 'Science',
  language: 'en',
  content: 'Explain how plants make food using **sunlight**.',
  structured: null,
  sourceQueryId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

function makeNavigation() {
  return { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()) };
}

function renderScreen(navigation = makeNavigation()) {
  const utils = render(
    <ThemeProvider>
      <ResourceViewScreen
        navigation={navigation as never}
        route={{ key: 'r', name: 'ResourceView', params: { resourceId: 'res1' } } as never}
      />
    </ThemeProvider>
  );
  return { ...utils, navigation };
}

describe('ResourceViewScreen', () => {
  beforeEach(() => {
    getResource.mockReset();
    deleteResource.mockReset();
    (Print.printToFileAsync as jest.Mock).mockClear();
    (Sharing.shareAsync as jest.Mock).mockClear();
  });

  it('loads and renders the resource title and content', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('Photosynthesis Lesson')).toBeTruthy());
    expect(getResource).toHaveBeenCalledWith('res1');
  });

  it('shows a "no longer exists" message on a 404', async () => {
    getResource.mockRejectedValueOnce(new ApiError('Resource not found.', 404));
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getByText('This resource no longer exists.')).toBeTruthy());
  });

  it('navigates to ResourceEdit when Edit is pressed', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    const navigation = makeNavigation();
    await act(async () => {
      renderScreen(navigation);
    });
    await waitFor(() => screen.getByText('Photosynthesis Lesson'));
    await fireEvent.press(screen.getByText('Edit'));
    expect(navigation.navigate).toHaveBeenCalledWith('ResourceEdit', { resourceId: 'res1' });
  });

  it('deletes the resource on confirm and goes back', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    deleteResource.mockResolvedValueOnce(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const navigation = makeNavigation();
    await act(async () => {
      renderScreen(navigation);
    });
    await waitFor(() => screen.getByText('Photosynthesis Lesson'));
    await fireEvent.press(screen.getByLabelText('Delete this resource'));

    await waitFor(() => expect(deleteResource).toHaveBeenCalledWith('res1'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('exports a non-assessment resource directly (no student/teacher prompt) and shares the PDF', async () => {
    getResource.mockResolvedValueOnce(RESOURCE);
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => screen.getByText('Photosynthesis Lesson'));

    await fireEvent.press(screen.getByLabelText('Print or export'));

    await waitFor(() => expect(Print.printToFileAsync).toHaveBeenCalledTimes(1));
    expect((Print.printToFileAsync as jest.Mock).mock.calls[0][0].html).toContain('Photosynthesis Lesson');
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledWith(
      expect.stringContaining('Photosynthesis_Lesson'),
      expect.objectContaining({ mimeType: 'application/pdf' })
    ));
  });

  it('offers a student/teacher choice before exporting an assessment', async () => {
    getResource.mockResolvedValueOnce({ ...RESOURCE, type: 'assessment' as const });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Teacher version (with answer key)')?.onPress?.();
    });
    await act(async () => {
      renderScreen();
    });
    await waitFor(() => expect(screen.getAllByText('Photosynthesis Lesson').length).toBeGreaterThan(0));

    await fireEvent.press(screen.getByLabelText('Print or export'));

    expect(alertSpy).toHaveBeenCalledWith('Export as…', undefined, expect.any(Array));
    await waitFor(() => expect(Print.printToFileAsync).toHaveBeenCalledTimes(1));
  });
});
