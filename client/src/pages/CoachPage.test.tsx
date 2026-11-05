// How Settings defaults, the teaching-context panel and reopened chats decide what POST /coach receives. The panel is the real
// TeachingContextMenu; the sidebar and composer are stubs exposing only the props under test, and `api` is mocked.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import CoachPage from './CoachPage';
import { api } from '../api';
import type { HistoryItem } from '../types';

const mockUser = vi.hoisted(() => ({
  current: {
    id: 'u1', name: 'Demo Teacher', email: 't@example.com', role: 'teacher',
    school: { id: 's1', name: 'Test School', code: 'TS01' },
    preferences: {} as Record<string, unknown>,
  },
}));

vi.mock('../auth', () => ({ useAuth: () => ({ user: mockUser.current, updateUser: vi.fn() }) }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), api: vi.fn() }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../onboarding', () => ({ useOnboarding: () => ({ introReopened: false, closeIntro: vi.fn() }) }));
vi.mock('../hooks/useOnboardingTip', () => ({ useOnboardingTip: () => ({ visible: false, dismiss: vi.fn() }) }));
vi.mock('../components/TopBar', () => ({ default: ({ extraControl }: { extraControl?: ReactNode }) => <div>{extraControl}</div> }));
vi.mock('../components/WelcomeScreen', () => ({ default: () => null }));
vi.mock('../components/MessageList', () => ({ default: () => null }));
vi.mock('../components/ChatSearchOverlay', () => ({ default: () => null }));
vi.mock('../components/Sidebar', () => ({
  default: ({ items, onNewChat, onSelect }: { items: HistoryItem[]; onNewChat: () => void; onSelect: (item: HistoryItem) => void }) => (
    <div>
      <button type="button" onClick={onNewChat}>New chat</button>
      {items.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item)}>{item.query}</button>)}
    </div>
  ),
}));
vi.mock('../components/Composer', () => ({
  default: ({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) => (
    <div>
      <input aria-label="Question" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={() => onSubmit()}>Send</button>
    </div>
  ),
}));

const DEFAULTS = { defaultLanguage: 'hi', defaultGrade: 'Class 5', defaultSubject: 'Science', defaultClassroomType: 'Multi-Grade' };

const HISTORY_ROW = {
  id: 'q1', query: 'Saved question', text: 'Saved answer', language: 'bn', conversationId: 'thread-1', rating: null,
  context: { grade: 'Class 2', subject: 'English', classroomType: 'Mixed Ability', issueType: '' },
  responseTime: 1, createdAt: '2026-10-01T10:00:00.000Z', title: null, pinned: false,
};

const mockedApi = vi.mocked(api);

function coachBodies() {
  return mockedApi.mock.calls
    .filter(([path]) => path === '/coach')
    .map(([, options]) => (options as { body: { language: string; context: Record<string, string>; conversationId?: string } }).body);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CoachPage preferences={{} as never} />
    </MemoryRouter>
  );
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  const sentBefore = coachBodies().length;
  await user.type(screen.getByLabelText('Question'), text);
  await user.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(coachBodies()).toHaveLength(sentBefore + 1));
  return coachBodies()[sentBefore];
}

async function pickInPanel(user: ReturnType<typeof userEvent.setup>, field: string, value: string) {
  await user.click(screen.getByRole('button', { name: /^Teaching context/ }));
  await user.selectOptions(screen.getByLabelText(field), value);
  await user.click(screen.getByRole('button', { name: 'Close teaching context' }));
}

beforeEach(() => {
  mockUser.current.preferences = { onboarding: { seenWelcomeIntro: true }, ...DEFAULTS };
  mockedApi.mockReset();
  mockedApi.mockImplementation(async (path: string) => (
    path === '/coach' ? { success: true, text: 'An answer.', queryId: 'q9' } : { queries: [HISTORY_ROW] }
  ) as never);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

describe('CoachPage teaching context', () => {
  test('the first question uses the saved defaults', async () => {
    const user = userEvent.setup();
    renderPage();

    const body = await ask(user, 'First');

    expect(body.language).toBe('hi');
    expect(body.context).toEqual({ grade: 'Class 5', subject: 'Science', classroomType: 'Multi-Grade', issueType: '' });
  });

  test('New chat drops the last chat\'s panel choices and restores the saved defaults', async () => {
    const user = userEvent.setup();
    renderPage();

    await pickInPanel(user, 'Grade', 'Class 9');
    await pickInPanel(user, 'Focus', 'Assessment');
    const edited = await ask(user, 'First');
    expect(edited.context).toMatchObject({ grade: 'Class 9', issueType: 'Assessment' });

    await user.click(screen.getByRole('button', { name: 'New chat' }));
    const fresh = await ask(user, 'Second');

    expect(fresh.context).toEqual({ grade: 'Class 5', subject: 'Science', classroomType: 'Multi-Grade', issueType: '' });
  });

  test('New chat leaves the language as it was', async () => {
    const user = userEvent.setup();
    renderPage();

    await pickInPanel(user, 'Language', 'en');
    await user.click(screen.getByRole('button', { name: 'New chat' }));

    expect((await ask(user, 'Second')).language).toBe('en');
  });

  test('"Any" in the panel overrides a default with a blank for the turn', async () => {
    const user = userEvent.setup();
    renderPage();

    await pickInPanel(user, 'Grade', '');

    expect((await ask(user, 'First')).context.grade).toBe('');
  });

  test('a reopened chat continues with its own language and context, not the defaults', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Saved question' }));
    const body = await ask(user, 'Follow-up');

    expect(body.language).toBe('bn');
    expect(body.conversationId).toBe('thread-1');
    expect(body.context).toEqual({ grade: 'Class 2', subject: 'English', classroomType: 'Mixed Ability', issueType: '' });
  });
});
