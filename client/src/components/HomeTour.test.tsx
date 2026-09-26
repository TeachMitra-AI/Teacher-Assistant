import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HomeTour } from './HomeTour';

afterEach(cleanup);

// jsdom doesn't implement media playback; stub just what the component calls.
let playSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function getVideo(container: HTMLElement) {
  const video = container.querySelector('video');
  if (!video) throw new Error('no <video> rendered');
  return video;
}

// jsdom has no matchMedia; stub one where only the phone-width query can be flipped.
function stubViewport(mobile: boolean) {
  const listeners = new Set<() => void>();
  const phone = {
    matches: mobile,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('max-width')
      ? phone
      : { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined },
  );
  return {
    resize(nextMobile: boolean) {
      phone.matches = nextMobile;
      act(() => listeners.forEach((cb) => cb()));
    },
  };
}

function setPlayhead(video: HTMLVideoElement, currentTime: number, duration = 28) {
  Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: currentTime });
  Object.defineProperty(video, 'duration', { configurable: true, value: duration });
}

describe('HomeTour', () => {
  test('is a labelled "See it in action" section with a described, silent, looping video', () => {
    const { container } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);

    const section = screen.getByRole('region', { name: /lesson prep and your classroom, in one workspace/i });
    expect(section).toHaveAttribute('id', 'see-it-in-action');
    expect(within(section).getByText('See it in action')).toBeInTheDocument();

    const video = getVideo(container);
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('loop');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('aria-describedby', 'home-tour-desc');
    expect(document.getElementById('home-tour-desc')).toHaveTextContent(/silent screen recording/i);
  });

  test('loads nothing up front: preload is "none" and the poster shows until played', () => {
    const { container } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);
    const video = getVideo(container);

    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('poster', '/product/sarastech-tour-light.webp');
    expect(playSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /play the 30-second product tour/i })).toBeInTheDocument();
  });

  test('serves the file and poster for the active theme, and swaps them on a theme change', () => {
    const { container, rerender } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);
    expect(getVideo(container)).toHaveAttribute('src', '/product/sarastech-tour-light.mp4');

    rerender(<HomeTour theme="dark" onGetStarted={() => undefined} />);
    const video = getVideo(container);
    expect(video).toHaveAttribute('src', '/product/sarastech-tour-dark.mp4');
    expect(video).toHaveAttribute('poster', '/product/sarastech-tour-dark.webp');
  });

  test('the play button starts playback and requests the full file', () => {
    const { container } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /play the 30-second product tour/i }));

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(getVideo(container)).toHaveAttribute('preload', 'auto');
  });

  test('offers four chapters; choosing one seeks to it and plays', () => {
    const { container } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);
    const chapters = within(screen.getByRole('list', { name: /jump to a part of the tour/i }));
    expect(chapters.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Library',
      'Lesson plan',
      'Worksheet',
      'Classroom',
    ]);

    const video = getVideo(container);
    setPlayhead(video, 0);
    fireEvent.click(chapters.getByRole('button', { name: 'Classroom' }));

    expect(video.currentTime).toBeGreaterThan(15);
    expect(playSpy).toHaveBeenCalled();
    expect(chapters.getByRole('button', { name: 'Classroom' })).toHaveAttribute('aria-current', 'true');
  });

  test('the active chapter follows playback, and the looped tail returns to the Library', () => {
    const { container } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);
    const video = getVideo(container);
    const active = () =>
      screen
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-current') === 'true')
        .map((button) => button.textContent);

    setPlayhead(video, 9);
    fireEvent.timeUpdate(video);
    expect(active()).toEqual(['Worksheet']);

    setPlayhead(video, 27);
    fireEvent.timeUpdate(video);
    expect(active()).toEqual(['Library']);
  });

  test('a video that fails to load falls back to the poster with no dead controls', () => {
    const { container } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);

    fireEvent.error(getVideo(container));

    expect(screen.queryByRole('button', { name: /play the 30-second product tour/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /jump to a part of the tour/i })).not.toBeInTheDocument();
    expect(getVideo(container)).toHaveAttribute('poster', '/product/sarastech-tour-light.webp');
  });

  test('keeps the page CTAs: Get Started opens sign-up, See how it works anchors to the steps', () => {
    const onGetStarted = vi.fn();
    render(<HomeTour theme="light" onGetStarted={onGetStarted} />);

    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(onGetStarted).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /see how it works/i })).toHaveAttribute('href', '#how-it-works');
  });
  test('a phone-width viewport gets the dedicated mobile cut and poster, in a portrait frame', () => {
    stubViewport(true);
    const { container } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);
    const video = getVideo(container);

    expect(video).toHaveAttribute('src', '/product/sarastech-tour-mobile-light.mp4');
    expect(video).toHaveAttribute('poster', '/product/sarastech-tour-mobile-light.webp');
    expect(video).toHaveAttribute('width', '390');
    expect(video).toHaveAttribute('height', '586');
    expect(container.querySelector('.home-tour-stage--mobile')).not.toBeNull();
  });

  test('a wider viewport keeps the desktop cut and frame', () => {
    stubViewport(false);
    const { container } = render(<HomeTour theme="dark" onGetStarted={() => undefined} />);

    expect(getVideo(container)).toHaveAttribute('src', '/product/sarastech-tour-dark.mp4');
    expect(container.querySelector('.home-tour-stage--mobile')).toBeNull();
  });

  test('mobile follows the theme too, and never requests the desktop files', () => {
    stubViewport(true);
    const { container, rerender } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);
    rerender(<HomeTour theme="dark" onGetStarted={() => undefined} />);
    const video = getVideo(container);

    expect(video).toHaveAttribute('src', '/product/sarastech-tour-mobile-dark.mp4');
    expect(video).toHaveAttribute('poster', '/product/sarastech-tour-mobile-dark.webp');
  });

  test('the mobile cut has its own chapter times', () => {
    stubViewport(true);
    const { container } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);
    const video = getVideo(container);
    setPlayhead(video, 0);

    fireEvent.click(screen.getByRole('button', { name: 'Worksheet' }));

    expect(video.currentTime).toBeCloseTo(9.2, 1); // the desktop cut's Worksheet starts at 7.9
  });

  test('crossing the phone breakpoint swaps to the other cut', () => {
    const viewport = stubViewport(false);
    const { container } = render(<HomeTour theme="light" onGetStarted={() => undefined} />);
    expect(getVideo(container)).toHaveAttribute('src', '/product/sarastech-tour-light.mp4');

    viewport.resize(true);
    expect(getVideo(container)).toHaveAttribute('src', '/product/sarastech-tour-mobile-light.mp4');

    viewport.resize(false);
    expect(getVideo(container)).toHaveAttribute('src', '/product/sarastech-tour-light.mp4');
  });
});
