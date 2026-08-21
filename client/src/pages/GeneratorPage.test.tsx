// Legacy-fallback behavior — STRUCTURED_QUESTIONS_ENABLED is forced off via
// an explicit `vi.mock('../config')` below, rather than relying on the
// ambient env being unset. It used to rely on the real default (nothing
// stubbed) on the assumption that a dev machine's `client/.env` would never
// set VITE_STRUCTURED_QUESTIONS_ENABLED — that assumption broke the moment
// this feature was manually verified against a real dev server with the flag
// on: vitest's `import.meta.env` resolution reads the SAME `client/.env` file
// Vite's dev server does, so this suite started failing not because the app
// was wrong, but because the test's assumption about ambient env state was.
// Forcing the flag explicitly (like GeneratorPage.structured.test.tsx forces
// it true) makes this suite deterministic regardless of the developer's own
// `client/.env` contents.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import GeneratorPage from './GeneratorPage';
import * as resourcesLib from '../lib/resources';
import * as configLib from '../config';

vi.mock('../components/TopBar', () => ({ default: () => null }));

vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof configLib>();
  return { ...actual, STRUCTURED_QUESTIONS_ENABLED: false };
});

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: {
      id: 'u1', name: 'Demo Teacher', email: 't@example.com', role: 'teacher',
      school: { id: 's1', name: 'Test School', code: 'TS01' },
      preferences: { onboarding: { dismissedTips: ['generator-intro'] }, examPaperDefaults: {} },
    },
  }),
}));

const showToast = vi.fn();
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: showToast }) }));

vi.mock('../lib/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof resourcesLib>();
  return { ...actual, generateAssessment: vi.fn(), createResource: vi.fn() };
});

const mockedResources = vi.mocked(resourcesLib);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/generator']}>
      <GeneratorPage preferences={{} as never} />
    </MemoryRouter>
  );
}

async function fillAndGenerate(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Topic (required)'), 'Fractions');
  await user.click(screen.getByRole('button', { name: /generate/i }));
}

beforeEach(() => {
  showToast.mockClear();
});

describe('GeneratorPage — legacy fallback (STRUCTURED_QUESTIONS_ENABLED off)', () => {
  test('a plain generate result with no `structured` field renders the markdown textarea/preview, unchanged', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue({ content: '# Quiz: Fractions\n\n1. Q?', requestId: 'r1' });
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: /edit/i }));
    expect(screen.getByLabelText('Generated content')).toBeInTheDocument();
    // No structured question cards rendered.
    expect(screen.queryByLabelText('New question type')).not.toBeInTheDocument();
  });

  test('a `structured` field is present but the flag is off — still renders the legacy editor', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue({
      content: '# Quiz\n\n1. Q?',
      structured: JSON.stringify({ schemaVersion: 2, instructions: 'Go.', questions: [{ type: 'mcq', text: 'Q?', options: ['A', 'B', 'C', 'D'], correctOptionIndex: 0 }] }),
      requestId: 'r1',
    });
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /edit/i }));
    expect(screen.getByLabelText('Generated content')).toBeInTheDocument();
    expect(screen.queryByLabelText('New question type')).not.toBeInTheDocument();
  });

  test('save sends `content` and a flat (non-structured) `structured` config blob, matching pre-existing behavior', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue({ content: '# Quiz\n\n1. Q?', requestId: 'r1' });
    mockedResources.createResource.mockResolvedValue({ id: 'saved1' } as never);
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Assessment title'), 'My Quiz');
    await user.click(screen.getByRole('button', { name: /save to library/i }));

    await waitFor(() => expect(mockedResources.createResource).toHaveBeenCalled());
    const call = mockedResources.createResource.mock.calls[0][0];
    expect(call.content).toBe('# Quiz\n\n1. Q?');
    expect(JSON.parse(call.structured!)).not.toHaveProperty('schemaVersion');
  });

  test('regenerating after editing the markdown asks for confirmation (legacy dirty-check unaffected)', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue({ content: '# Quiz\n\n1. Q?', requestId: 'r1' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    await fillAndGenerate(user);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /edit/i }));
    await user.type(screen.getByLabelText('Generated content'), '!');

    await user.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
