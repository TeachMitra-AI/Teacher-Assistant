// Component tests for GettingStartedScreen.tsx — mirrors client/src/
// components/OnboardingIntro.tsx's feature list and admin-only filtering.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import { GettingStartedScreen } from '../GettingStartedScreen';

let mockUser: { role: string } | null = { role: 'teacher' };
jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

function makeNavigation() {
  return { canGoBack: jest.fn(() => true), goBack: jest.fn() };
}

async function renderScreen(navigation = makeNavigation()) {
  await render(
    <SafeAreaProvider>
      <ThemeProvider>
        <GettingStartedScreen
          navigation={navigation as never}
          route={{ key: 'g', name: 'GettingStarted', params: undefined } as never}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return navigation;
}

describe('GettingStartedScreen', () => {
  beforeEach(() => {
    mockUser = { role: 'teacher' };
  });

  it('shows the non-admin feature list for a teacher, excluding admin-only items', async () => {
    await renderScreen();
    expect(screen.getByText('Coach')).toBeTruthy();
    expect(screen.getByText('My Library')).toBeTruthy();
    expect(screen.getByText('Generator')).toBeTruthy();
    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByText('AI Assist')).toBeTruthy();
    expect(screen.queryByText('Manage & Dashboard')).toBeNull();
  });

  it('includes the admin-only feature for an admin role', async () => {
    mockUser = { role: 'school_admin' };
    await renderScreen();
    expect(screen.getByText('Manage & Dashboard')).toBeTruthy();
  });

  it('the CTA button navigates back', async () => {
    const navigation = await renderScreen();
    await fireEvent.press(screen.getByTestId('getting-started-cta'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
