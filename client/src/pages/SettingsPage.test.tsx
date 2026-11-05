// What the Settings forms send to PATCH /auth/me. The server keeps any preference key that's left out, so clearing a field
// depends on the key staying in the serialised body: bodies are compared after a JSON round trip, as the wire sees them.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';
import { api } from '../api';

const mockUser = vi.hoisted(() => ({
  current: {
    id: 'u1', name: 'Demo Teacher', displayName: null, email: 't@example.com', role: 'teacher', avatarUrl: null,
    school: { id: 's1', name: 'Test School', code: 'TS01' },
    preferences: {} as Record<string, unknown>,
  },
}));

vi.mock('../auth', () => ({ useAuth: () => ({ user: mockUser.current, updateUser: vi.fn() }) }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), api: vi.fn() }));
vi.mock('../components/TopBar', () => ({ default: () => null }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../components/HelpSupport', () => ({ useHelpSupport: () => ({ openMenu: vi.fn() }) }));
vi.mock('../hooks/useProfilePicture', () => ({
  useProfilePicture: () => ({ uploading: false, previewUrl: null, upload: vi.fn(), remove: vi.fn() }),
}));

const mockedApi = vi.mocked(api);

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage preferences={{} as never} />
    </MemoryRouter>
  );
}

async function sentPreferences() {
  await waitFor(() => expect(mockedApi).toHaveBeenCalled());
  const [path, options] = mockedApi.mock.calls[0];
  expect(path).toBe('/auth/me');
  return JSON.parse(JSON.stringify((options as { body: { preferences: unknown } }).body)).preferences;
}

beforeEach(() => {
  mockUser.current.preferences = {
    avatar: '🌟', defaultLanguage: 'hi', defaultGrade: 'Class 5', defaultSubject: 'Science',
    defaultClassroomType: 'Multi-Grade', responseStyle: 'concise',
    examPaperDefaults: { schoolName: 'Saved School' },
  };
  mockedApi.mockReset();
  mockedApi.mockResolvedValue({ user: mockUser.current } as never);
});

describe('SettingsPage teaching defaults', () => {
  test('"No default" sends an empty value for every cleared field', async () => {
    const user = userEvent.setup();
    renderPage();

    for (const field of ['Default language', 'Default grade', 'Default subject', 'Default classroom type']) {
      await user.selectOptions(screen.getByLabelText(field), '');
    }
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await sentPreferences()).toMatchObject({
      defaultLanguage: '', defaultGrade: '', defaultSubject: '', defaultClassroomType: '',
      responseStyle: 'concise', examPaperDefaults: { schoolName: 'Saved School' },
    });
  });

  test('a never-set field stays out of the request while a stored one is cleared', async () => {
    mockUser.current.preferences = { defaultGrade: 'Class 5', responseStyle: 'concise' };
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Default grade'), '');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const sent = await sentPreferences();
    expect(sent.defaultGrade).toBe('');
    for (const key of ['avatar', 'defaultLanguage', 'defaultSubject', 'defaultClassroomType']) {
      expect(sent).not.toHaveProperty(key);
    }
  });

  test('"No avatar" sends an empty avatar', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '🚫' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((await sentPreferences()).avatar).toBe('');
  });

  test('a grade outside this list stays visible and is kept on save', async () => {
    mockUser.current.preferences.defaultGrade = 'Class 3-5';
    const user = userEvent.setup();
    renderPage();

    const grade = screen.getByLabelText<HTMLSelectElement>('Default grade');
    expect(grade.selectedOptions[0].textContent).toBe('Class 3-5');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await sentPreferences()).defaultGrade).toBe('Class 3-5');
  });

  test('saving paper defaults leaves the teaching defaults as stored', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Default grade'), '');
    await user.click(screen.getByRole('button', { name: 'Save paper defaults' }));

    expect(await sentPreferences()).toMatchObject({ defaultGrade: 'Class 5', defaultLanguage: 'hi', responseStyle: 'concise' });
  });
});
