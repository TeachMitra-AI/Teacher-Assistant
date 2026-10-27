// Snap-to-Lesson (textbook page photos/PDFs) in the Generator. A separate file because SOURCE_GENERATION_ENABLED is a
// top-level const read once when config.ts loads; forcing it true belongs in this file's hoisted `vi.mock('../config')`.
// The flag-off case (no picker) is in GeneratorPage.test.tsx.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import GeneratorPage from './GeneratorPage';
import * as resourcesLib from '../lib/resources';
import * as configLib from '../config';
import * as downscaleLib from '../lib/imageDownscale';
import { ApiError } from '../api';

vi.mock('../components/TopBar', () => ({ default: () => null }));

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
  return {
    ...actual,
    generateAssessment: vi.fn(),
    generateAssessmentFromSource: vi.fn(),
    createResource: vi.fn(),
  };
});

vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof configLib>();
  // Structured mode pinned off so the result flows through the Markdown preview, whatever a local .env sets.
  return { ...actual, SOURCE_GENERATION_ENABLED: true, STRUCTURED_QUESTIONS_ENABLED: false };
});

// Pass-through by default (jsdom can't decode images anyway); one test holds it pending to simulate slow photo shrinking.
vi.mock('../lib/imageDownscale', () => ({ downscaleImage: vi.fn(async (file: File) => file) }));

const mockedResources = vi.mocked(resourcesLib);
const mockedDownscale = vi.mocked(downscaleLib);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/generator']}>
      <GeneratorPage preferences={{} as never} />
    </MemoryRouter>
  );
}

const photo = (name: string) => new File(['fake-jpeg-bytes'], name, { type: 'image/jpeg' });

const quizResult = {
  content: '# Quiz: Chapter 4: Fractions\n\n## Questions\n\n1. What is 1/2 + 1/2?\n\n## Answer Key\n\n1. B',
  structured: JSON.stringify({ schemaVersion: 2, instructions: 'Answer all.', questions: [] }),
  requestId: 'r1',
};

beforeEach(() => {
  showToast.mockClear();
  mockedDownscale.downscaleImage.mockImplementation(async (file: File) => file);
  mockedResources.generateAssessment.mockReset();
  mockedResources.generateAssessmentFromSource.mockReset();
  mockedResources.createResource.mockReset();
});

describe('GeneratorPage — Snap-to-Lesson (SOURCE_GENERATION_ENABLED on)', () => {
  test('shows the page picker; adding a photo shows its chip and relabels Topic', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText('From textbook page (optional)')).toBeInTheDocument();
    await user.upload(screen.getByTestId('source-file-input'), photo('page1.jpg'));

    expect(await screen.findByText('page1.jpg')).toBeInTheDocument();
    expect(screen.getByText('Chapter / topic name')).toBeInTheDocument();
  });

  test('generating with pages calls the page endpoint with the files; Save stores an assessment', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessmentFromSource.mockResolvedValue(quizResult);
    mockedResources.createResource.mockResolvedValue({ id: 'saved1' } as never);
    renderPage();

    await user.upload(screen.getByTestId('source-file-input'), [photo('page1.jpg'), photo('page2.jpg')]);
    await screen.findByText('page2.jpg');
    await user.type(screen.getByLabelText('Topic (required)'), 'Chapter 4: Fractions');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument());
    expect(mockedResources.generateAssessment).not.toHaveBeenCalled();
    const [input, files] = mockedResources.generateAssessmentFromSource.mock.calls[0];
    expect(input.topic).toBe('Chapter 4: Fractions');
    expect(files.map((f) => f.name)).toEqual(['page1.jpg', 'page2.jpg']);

    await user.type(screen.getByLabelText('Assessment title'), 'Fractions quiz');
    await user.click(screen.getByRole('button', { name: /save to library/i }));
    await waitFor(() => expect(mockedResources.createResource).toHaveBeenCalled());
    expect(mockedResources.createResource.mock.calls[0][0].type).toBe('assessment');
  });

  test('without pages, Generate still uses the normal topic endpoint', async () => {
    const user = userEvent.setup();
    mockedResources.generateAssessment.mockResolvedValue(quizResult);
    renderPage();

    await user.type(screen.getByLabelText('Topic (required)'), 'Fractions');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => expect(mockedResources.generateAssessment).toHaveBeenCalled());
    expect(mockedResources.generateAssessmentFromSource).not.toHaveBeenCalled();
  });

  test('keeps at most 3 pages and says why', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.upload(screen.getByTestId('source-file-input'), ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg'].map(photo));

    await screen.findByText('p3.jpg');
    expect(screen.queryByText('p4.jpg')).not.toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/up to 3 pages/i), 'error');
    // Full: the add button is gone until a page is removed.
    expect(screen.queryByRole('button', { name: /add (textbook pages|another page)/i })).not.toBeInTheDocument();
  });

  test('a pick made while an earlier pick is still being processed is ignored, so the list never exceeds 3', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mockedDownscale.downscaleImage.mockImplementation((file: File) => gate.then(() => file));
    renderPage();

    const input = screen.getByTestId('source-file-input');
    await user.upload(input, [photo('p1.jpg'), photo('p2.jpg')]);
    // First pick still shrinking: the Add button is disabled.
    expect(screen.getByRole('button', { name: /add textbook pages/i })).toBeDisabled();

    // A second pick that still arrives (e.g. a native-dialog race) is ignored rather than counted against a stale list.
    await user.upload(input, [photo('p3.jpg'), photo('p4.jpg')]);
    release();

    expect(await screen.findByText('p2.jpg')).toBeInTheDocument();
    expect(screen.getByText('p1.jpg')).toBeInTheDocument();
    expect(screen.queryByText('p3.jpg')).not.toBeInTheDocument();
    expect(screen.queryByText('p4.jpg')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2);
    await waitFor(() => expect(screen.getByRole('button', { name: /add another page/i })).toBeEnabled());
  });

  test('a page can be removed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.upload(screen.getByTestId('source-file-input'), photo('page1.jpg'));
    await user.click(await screen.findByRole('button', { name: 'Remove page1.jpg' }));

    expect(screen.queryByText('page1.jpg')).not.toBeInTheDocument();
    expect(screen.getByText('Topic')).toBeInTheDocument();
  });

  test('more than 15 questions from pages is blocked before any request', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.upload(screen.getByTestId('source-file-input'), photo('page1.jpg'));
    await screen.findByText('page1.jpg');
    await user.type(screen.getByLabelText('Topic (required)'), 'Fractions');
    const count = screen.getByLabelText(/number of questions/i);
    await user.clear(count);
    await user.type(count, '20');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/at most 15 questions/i), 'error');
    expect(mockedResources.generateAssessmentFromSource).not.toHaveBeenCalled();
  });

  test("shows the server's retake-photo message when the pages can't be read", async () => {
    const user = userEvent.setup();
    const message = "We couldn't read these pages clearly. Retake the photo in good light, flat and in focus, and try again.";
    mockedResources.generateAssessmentFromSource.mockRejectedValue(new ApiError(message, 422, { code: 'SOURCE_UNREADABLE' }));
    renderPage();

    await user.upload(screen.getByTestId('source-file-input'), photo('blurry.jpg'));
    await screen.findByText('blurry.jpg');
    await user.type(screen.getByLabelText('Topic (required)'), 'Fractions');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Preview' })).not.toBeInTheDocument();
  });
});
