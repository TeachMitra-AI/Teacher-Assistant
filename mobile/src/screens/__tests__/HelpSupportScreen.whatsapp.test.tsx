// Covers Contact Support's WhatsApp option, gated by SUPPORT_WHATSAPP_NUMBER
// (empty by default — see HelpSupportScreen.test.tsx for that path). Config
// must be mocked at file scope, before HelpSupportScreen.tsx's own import of
// it — same reasoning RootNavigator.test.tsx documents for NOTIFICATIONS_ENABLED,
// which is why this is a separate file rather than a second `it()` in
// HelpSupportScreen.test.tsx (a mid-file jest.mock can't retroactively
// change what an already-evaluated import saw).
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import { HelpSupportScreen } from '../HelpSupportScreen';

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  SUPPORT_WHATSAPP_NUMBER: '911234567890',
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Verma', displayName: null, email: 'asha@example.com', role: 'teacher', preferences: {}, school: { id: 's1', name: 'Rampur Primary', code: 'RAMPUR01' } } }),
}));

jest.mock('../../api/support', () => ({
  createSupportTicket: jest.fn(),
  captureAutoContext: jest.fn(() => ({ buildId: 'mobile', theme: 'light', language: undefined })),
}));

function makeNavigation() {
  return { setOptions: jest.fn(), goBack: jest.fn() };
}

async function renderScreen() {
  await render(
    <SafeAreaProvider>
      <ThemeProvider>
        <HelpSupportScreen
          navigation={makeNavigation() as never}
          route={{ key: 'h', name: 'HelpSupport', params: undefined } as never}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('HelpSupportScreen (SUPPORT_WHATSAPP_NUMBER set)', () => {
  it('Contact Support offers WhatsApp, and opens it with a prefilled message', async () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await renderScreen();

    await fireEvent.press(screen.getByText('Contact Support'));
    expect(screen.getByText('Message us on WhatsApp')).toBeTruthy();
    // Copy changes once WhatsApp is offered too (mirrors the web version).
    expect(screen.getByText('Send a message instead')).toBeTruthy();

    await fireEvent.press(screen.getByText('Message us on WhatsApp'));

    expect(openURLSpy).toHaveBeenCalledTimes(1);
    const url = openURLSpy.mock.calls[0][0];
    expect(url).toContain('https://wa.me/911234567890?text=');
    expect(decodeURIComponent(url)).toContain('Asha Verma (Rampur Primary)');

    openURLSpy.mockRestore();
  });
});
