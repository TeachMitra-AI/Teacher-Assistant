import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { ManageSchoolsScreen } from '../ManageSchoolsScreen';

jest.mock('../../../../api/admin', () => ({
  listAdminSchools: jest.fn(),
  createSchool: jest.fn(),
}));
const { listAdminSchools, createSchool } = jest.requireMock('../../../../api/admin') as {
  listAdminSchools: jest.Mock; createSchool: jest.Mock;
};

function renderScreen() {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <ManageSchoolsScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('ManageSchoolsScreen', () => {
  beforeEach(() => {
    listAdminSchools.mockReset();
    createSchool.mockReset();
  });

  it('lists schools once loaded', async () => {
    listAdminSchools.mockResolvedValue({
      items: [{ id: 's1', name: 'Rampur High', code: 'RAMPUR03', district: 'Rampur', users: 12 }],
      total: 1, page: 1, limit: 25,
    });
    await act(async () => { renderScreen(); });

    await waitFor(() => expect(screen.getByText('Rampur High')).toBeTruthy());
    expect(screen.getByText('12 teachers')).toBeTruthy();
  });

  it('rejects a code shorter than 3 characters without calling the API', async () => {
    listAdminSchools.mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('No schools yet.')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('School name'), 'Rampur High');
    await fireEvent.changeText(screen.getByLabelText('School code'), 'RA');
    await fireEvent.press(screen.getByTestId('manage-add-school'));

    expect(await screen.findByText('Enter a name and a code of at least 3 characters')).toBeTruthy();
    expect(createSchool).not.toHaveBeenCalled();
  });

  it('creates a school and refetches the list', async () => {
    listAdminSchools.mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });
    createSchool.mockResolvedValue({ id: 's2', name: 'New School', code: 'NEW001', users: 0 });
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('No schools yet.')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('School name'), 'New School');
    await fireEvent.changeText(screen.getByLabelText('School code'), 'NEW001');
    await fireEvent.press(screen.getByTestId('manage-add-school'));

    await waitFor(() => expect(createSchool).toHaveBeenCalledWith({ name: 'New School', code: 'NEW001' }));
    expect(await screen.findByText('School created')).toBeTruthy();
    expect(listAdminSchools).toHaveBeenCalledTimes(2);
  });
});
