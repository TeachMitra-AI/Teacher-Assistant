import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { AdminSettingsScreen } from '../AdminSettingsScreen';
import { ApiError } from '../../../../api/client';

jest.mock('../../../../api/adminFeatureFlags', () => ({
  listFeatureFlags: jest.fn(),
  setBooleanSetting: jest.fn(),
  setRoleListSetting: jest.fn(),
}));
const { listFeatureFlags, setBooleanSetting, setRoleListSetting } = jest.requireMock('../../../../api/adminFeatureFlags') as {
  listFeatureFlags: jest.Mock; setBooleanSetting: jest.Mock; setRoleListSetting: jest.Mock;
};

const FLAGS = [
  {
    id: 'learning-representation', label: 'Learning Representation', kind: 'feature_flag' as const, type: 'boolean' as const,
    enabled: false, source: 'env-default' as const, updatedAt: null,
  },
  {
    id: 'assistant-allowed-roles', label: 'Assistant Access', description: 'Who may use the AI Assistant.',
    kind: 'access_control' as const, type: 'role_list' as const, roles: ['teacher'], source: 'override' as const, updatedAt: '2026-08-01T00:00:00Z',
  },
];

function renderScreen() {
  return render(
    <ThemeProvider>
      <AdminSettingsScreen />
    </ThemeProvider>
  );
}

describe('AdminSettingsScreen', () => {
  beforeEach(() => {
    listFeatureFlags.mockReset();
    setBooleanSetting.mockReset();
    setRoleListSetting.mockReset();
  });

  it('renders both sections once loaded', async () => {
    listFeatureFlags.mockResolvedValue(FLAGS);
    await act(async () => { renderScreen(); });

    await waitFor(() => expect(screen.getByText('Learning Representation')).toBeTruthy());
    expect(screen.getByText('AI Access')).toBeTruthy();
    expect(screen.getByText('Using server default — no override set')).toBeTruthy();
  });

  it('toggles a boolean feature flag', async () => {
    listFeatureFlags.mockResolvedValue(FLAGS);
    setBooleanSetting.mockResolvedValue({ ...FLAGS[0], enabled: true, source: 'override' });
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('Learning Representation')).toBeTruthy());

    await fireEvent(screen.getByTestId('feature-flag-learning-representation'), 'valueChange', true);

    await waitFor(() => expect(setBooleanSetting).toHaveBeenCalledWith('learning-representation', true));
  });

  it('toggles a role in the AI Access role list', async () => {
    listFeatureFlags.mockResolvedValue(FLAGS);
    setRoleListSetting.mockResolvedValue({ ...FLAGS[1], roles: ['teacher', 'school_admin'] });
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('Who may use the AI Assistant.', { exact: false })).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('School Admin'));

    await waitFor(() => expect(setRoleListSetting).toHaveBeenCalledWith('assistant-allowed-roles', ['teacher', 'school_admin']));
  });

  it('shows the server error message on failure to load', async () => {
    listFeatureFlags.mockRejectedValue(new ApiError('Admins only.', 403));
    await act(async () => { renderScreen(); });

    expect(await screen.findByText('Admins only.')).toBeTruthy();
  });
});
