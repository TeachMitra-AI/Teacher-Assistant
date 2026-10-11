import { cloneElement, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ResponseCard from './ResponseCard';
import { ToastProvider } from './Toast';
import { stopSpeaking } from '../lib/tts';

// ResponseCard is exercised against the real lib/tts.ts and a fake speech engine, so card-to-card ownership is tested
// through the same code the browser runs. jsdom has no speechSynthesis; the fake fires nothing on its own.
class FakeUtterance {
  text: string;
  lang = '';
  voice: unknown = null;
  rate = 1;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

interface FakeSynth {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  spoken: FakeUtterance[];
  voices: SpeechSynthesisVoice[];
  listeners: Set<() => void>;
}

const ENGLISH = { lang: 'en-US', name: 'en', default: true } as SpeechSynthesisVoice;

function installSynth(voices: SpeechSynthesisVoice[] = [ENGLISH]): FakeSynth {
  const spoken: FakeUtterance[] = [];
  const listeners = new Set<() => void>();
  const synth: FakeSynth = {
    spoken,
    voices,
    listeners,
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
    }),
    cancel: vi.fn(),
    getVoices: vi.fn(() => synth.voices),
    addEventListener: vi.fn((_t: string, fn: () => void) => {
      listeners.add(fn);
    }),
    removeEventListener: vi.fn((_t: string, fn: () => void) => {
      listeners.delete(fn);
    }),
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return synth;
}

afterEach(() => {
  // lib/tts.ts keeps module state, so end any request a test left active before the next one.
  stopSpeaking();
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const BASE = {
  query: 'How do I teach fractions?',
  text: 'Use a roti.',
  language: 'en',
  context: {},
  queryId: null,
  rating: null,
  onFeedback: () => {},
} as const;

function Card(props: Partial<React.ComponentProps<typeof ResponseCard>>) {
  return <ResponseCard {...BASE} {...props} />;
}

// ToastProvider renders its children as one nested slot, so a rerender must pass an array again or every card remounts.
// A card keeps its identity by an explicit key where a test removes its sibling, and by position otherwise.
const withToasts = (cards: React.ReactElement[]) =>
  createElement(ToastProvider, null, cards.map((card, i) => cloneElement(card, { key: card.key ?? i })));

function renderCards(...cards: React.ReactElement[]) {
  return render(withToasts(cards));
}

function rerenderCards(view: ReturnType<typeof render>, ...cards: React.ReactElement[]) {
  view.rerender(withToasts(cards));
}

const readAloud = () => screen.getAllByRole('button', { name: 'Read aloud' });
const stopReading = () => screen.getAllByRole('button', { name: 'Stop reading' });

describe('ResponseCard read aloud: text and language', () => {
  it('speaks the cleaned text, not the Markdown source, and leaves the displayed response alone', () => {
    const synth = installSynth();
    const { container } = renderCards(<Card text={'## Fractions\n**Cut** the roti.\n- Name each part'} />);
    fireEvent.click(readAloud()[0]);
    expect(synth.spoken[0].text).toBe('Fractions.\nCut the roti.\nName each part.');
    expect(container.querySelector('.response-body h2')).toHaveTextContent('Fractions');
    expect(container.querySelector('.response-body strong')).toHaveTextContent('Cut');
  });

  it('reads math and links as speech', () => {
    const synth = installSynth();
    renderCards(<Card text={'Half is $\\frac{1}{2}$, see [the guide](https://x.in/g).'} />);
    fireEvent.click(readAloud()[0]);
    expect(synth.spoken[0].text).toBe('Half is 1 by 2, see the guide.');
  });

  it('uses the response language for the speech locale', () => {
    const synth = installSynth();
    renderCards(<Card text="नमस्ते कक्षा।" language="hi" />);
    fireEvent.click(readAloud()[0]);
    expect(synth.spoken[0]).toMatchObject({ text: 'नमस्ते कक्षा।', lang: 'hi-IN' });
  });

  it('does not start when nothing readable is left after cleaning', () => {
    const synth = installSynth();
    renderCards(<Card text={'---\n**'} />);
    fireEvent.click(readAloud()[0]);
    expect(synth.spoken).toHaveLength(0);
    expect(readAloud()).toHaveLength(1);
  });

  it('shows no read-aloud control when speech is unsupported', () => {
    renderCards(<Card />);
    expect(screen.queryByRole('button', { name: /read aloud|stop reading/i })).toBeNull();
  });
});

describe('ResponseCard read aloud: start, stop and completion', () => {
  it('starts and stops on the same card', () => {
    const synth = installSynth();
    renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    expect(stopReading()).toHaveLength(1);
    fireEvent.click(stopReading()[0]);
    expect(synth.cancel).toHaveBeenCalled();
    expect(readAloud()).toHaveLength(1);
    expect(screen.queryByRole('status')?.textContent ?? '').toBe('');
  });

  it('returns to idle when speech finishes', () => {
    const synth = installSynth();
    renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    act(() => synth.spoken[0].onend?.());
    expect(readAloud()).toHaveLength(1);
  });

  it('can be started again after stopping', () => {
    const synth = installSynth();
    renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    fireEvent.click(stopReading()[0]);
    act(() => synth.spoken[0].onend?.());
    fireEvent.click(readAloud()[0]);
    expect(synth.spoken).toHaveLength(2);
    expect(stopReading()).toHaveLength(1);
  });

  it('resets the previous card when another card starts speaking', () => {
    const synth = installSynth();
    renderCards(<Card key="a" text="Card A." />, <Card key="b" text="Card B." />);
    const [a, b] = readAloud();
    fireEvent.click(a);
    fireEvent.click(b);
    expect(synth.spoken.map((u) => u.text)).toEqual(['Card A.', 'Card B.']);
    expect(stopReading()).toHaveLength(1);
    expect(readAloud()).toHaveLength(1);
    // The surviving "Stop reading" belongs to B: finishing B's utterance leaves both idle.
    act(() => synth.spoken[1].onend?.());
    expect(readAloud()).toHaveLength(2);
  });

  it('ignores a late end from the replaced card utterance', () => {
    const synth = installSynth();
    renderCards(<Card key="a" text="Card A." />, <Card key="b" text="Card B." />);
    const [a, b] = readAloud();
    fireEvent.click(a);
    fireEvent.click(b);
    act(() => synth.spoken[0].onend?.());
    expect(stopReading()).toHaveLength(1);
  });
});

describe('ResponseCard read aloud: cleanup ownership', () => {
  it('stops its own speech when it unmounts', () => {
    const synth = installSynth();
    const view = renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    synth.cancel.mockClear();
    view.unmount();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not stop card B when card A unmounts', () => {
    const synth = installSynth();
    const view = renderCards(<Card key="a" text="Card A." />, <Card key="b" text="Card B." />);
    fireEvent.click(readAloud()[1]);
    synth.cancel.mockClear();
    rerenderCards(view, <Card key="b" text="Card B." />);
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(stopReading()).toHaveLength(1);
    act(() => synth.spoken[0].onend?.());
    expect(readAloud()).toHaveLength(1);
  });

  it('does not stop card B when card A unmounts after A was replaced by B', () => {
    const synth = installSynth();
    const view = renderCards(<Card key="a" text="Card A." />, <Card key="b" text="Card B." />);
    const [a, b] = readAloud();
    fireEvent.click(a);
    fireEvent.click(b);
    synth.cancel.mockClear();
    rerenderCards(view, <Card key="b" text="Card B." />);
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(stopReading()).toHaveLength(1);
  });

  it('stops and resets when its response text changes during speech', () => {
    const synth = installSynth();
    const view = renderCards(<Card text="First answer." />);
    fireEvent.click(readAloud()[0]);
    synth.cancel.mockClear();
    rerenderCards(view, <Card text="Second answer." />);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(readAloud()).toHaveLength(1);
    fireEvent.click(readAloud()[0]);
    expect(synth.spoken[1].text).toBe('Second answer.');
  });

  it('leaves another card speaking when an idle card changes its text', () => {
    const synth = installSynth();
    const view = renderCards(<Card key="a" text="Card A." />, <Card key="b" text="Card B." />);
    fireEvent.click(readAloud()[1]);
    synth.cancel.mockClear();
    rerenderCards(view, <Card key="a" text="Card A, edited." />, <Card key="b" text="Card B." />);
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(stopReading()).toHaveLength(1);
  });

  it('does not touch an unmounted card when its utterance ends later', () => {
    const synth = installSynth();
    const view = renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    view.unmount();
    expect(() => act(() => synth.spoken[0].onend?.())).not.toThrow();
  });
});

describe('ResponseCard read aloud: error feedback', () => {
  it('tells the teacher when the device has no voice for the language', () => {
    const synth = installSynth();
    renderCards(<Card language="hi" text="नमस्ते।" />);
    fireEvent.click(readAloud()[0]);
    act(() => synth.spoken[0].onerror?.({ error: 'language-unavailable' }));
    expect(screen.getByRole('status')).toHaveTextContent(/no voice for the selected language/i);
    expect(readAloud()).toHaveLength(1);
  });

  it('shows a separate generic message for a genuine failure', () => {
    const synth = installSynth();
    renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    act(() => synth.spoken[0].onerror?.({ error: 'synthesis-failed' }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/couldn't read this aloud/i);
    expect(status).not.toHaveTextContent(/no voice/i);
    expect(readAloud()).toHaveLength(1);
  });

  it.each(['interrupted', 'canceled'])('shows no error for a "%s" cancellation', (error) => {
    const synth = installSynth();
    renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    act(() => synth.spoken[0].onerror?.({ error }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(readAloud()).toHaveLength(1);
  });

  it('shows no error when the teacher stops or another card replaces the speech', () => {
    const synth = installSynth();
    renderCards(<Card key="a" text="Card A." />, <Card key="b" text="Card B." />);
    const [a, b] = readAloud();
    fireEvent.click(a);
    fireEvent.click(b);
    act(() => synth.spoken[0].onerror?.({ error: 'interrupted' }));
    fireEvent.click(stopReading()[0]);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows the generic message and recovers when the engine throws', () => {
    const synth = installSynth();
    synth.speak.mockImplementation(() => {
      throw new Error('boom');
    });
    renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't read this aloud/i);
    expect(readAloud()).toHaveLength(1);
  });
});

describe('ResponseCard read aloud: while voices are loading', () => {
  it('shows the active control immediately, before any speech starts', () => {
    vi.useFakeTimers();
    const synth = installSynth([]);
    renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    expect(synth.spoken).toHaveLength(0);
    expect(stopReading()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(synth.spoken).toHaveLength(1);
    expect(stopReading()).toHaveLength(1);
  });

  it('stopping during the wait returns to idle and never speaks', () => {
    vi.useFakeTimers();
    const synth = installSynth([]);
    renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    fireEvent.click(stopReading()[0]);
    expect(readAloud()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(synth.spoken).toHaveLength(0);
    expect(synth.listeners.size).toBe(0);
  });

  it('unmounting during the wait leaves no timer, listener or later speech', () => {
    vi.useFakeTimers();
    const synth = installSynth([]);
    const view = renderCards(<Card />);
    fireEvent.click(readAloud()[0]);
    view.unmount();
    expect(synth.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(synth.spoken).toHaveLength(0);
  });

  it('a replaced card during the wait is reset and only the newer card speaks', () => {
    vi.useFakeTimers();
    const synth = installSynth([]);
    renderCards(<Card key="a" text="Card A." />, <Card key="b" text="Card B." />);
    const [a, b] = readAloud();
    fireEvent.click(a);
    fireEvent.click(b);
    expect(stopReading()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(synth.spoken.map((u) => u.text)).toEqual(['Card B.']);
  });
});

describe('ResponseCard read aloud: accessibility', () => {
  it('names the control for its action and carries no conflicting pressed state', () => {
    installSynth();
    renderCards(<Card />);
    const idle = readAloud()[0];
    expect(idle).toHaveAttribute('title', 'Read aloud');
    expect(idle).not.toHaveAttribute('aria-pressed');
    expect(idle).not.toHaveAttribute('aria-busy');
    fireEvent.click(idle);
    const active = stopReading()[0];
    expect(active).toHaveAttribute('title', 'Stop reading');
    expect(active).not.toHaveAttribute('aria-pressed');
    expect(active).toHaveClass('speaking');
    expect(active.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is a native button reachable and operable by keyboard', () => {
    installSynth();
    renderCards(<Card />);
    const button = readAloud()[0];
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    button.focus();
    expect(button).toHaveFocus();
  });
});

describe('ResponseCard: other actions are unchanged', () => {
  it('copies the original response text', async () => {
    installSynth();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCards(<Card text={'## Title\n**bold**'} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledWith('## Title\n**bold**');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('still offers Share and Save to Library', () => {
    installSynth();
    renderCards(<Card />);
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save to Library' })).toBeInTheDocument();
  });

  it('sends feedback and locks both buttons once rated', () => {
    installSynth();
    const onFeedback = vi.fn();
    const view = renderCards(<Card queryId="q1" onFeedback={onFeedback} />);
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(onFeedback).toHaveBeenCalledWith('helpful');
    rerenderCards(view, <Card queryId="q1" rating="helpful" onFeedback={onFeedback} />);
    expect(screen.getByRole('button', { name: 'Like' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dislike' })).toBeDisabled();
  });

  it('hides feedback when there is no query id and shows the grade and subject chips', () => {
    installSynth();
    const { container } = renderCards(<Card context={{ grade: 'Class 5', subject: 'Maths' }} />);
    expect(screen.queryByRole('button', { name: 'Like' })).toBeNull();
    expect(within(container.querySelector('.response-meta') as HTMLElement).getByText(/Class 5/)).toBeInTheDocument();
  });

  it('keeps reading actions independent of speech support', () => {
    renderCards(<Card queryId="q1" />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
  });
});

describe('ResponseCard read aloud: long responses', () => {
  const LONG = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(' ');

  it('stays active across chunks and returns to idle after the last one', () => {
    const synth = installSynth();
    renderCards(<Card text={LONG} />);
    fireEvent.click(readAloud()[0]);
    expect(synth.spoken).toHaveLength(1);
    act(() => synth.spoken[0].onend?.());
    expect(synth.spoken).toHaveLength(2);
    expect(stopReading()).toHaveLength(1);
    act(() => synth.spoken[1].onend?.());
    act(() => synth.spoken[2].onend?.());
    expect(synth.spoken.map((u) => u.text).join(' ')).toBe(LONG);
    expect(readAloud()).toHaveLength(1);
  });

  it('stopping mid-response cancels the rest of the queue', () => {
    const synth = installSynth();
    renderCards(<Card text={LONG} />);
    fireEvent.click(readAloud()[0]);
    act(() => synth.spoken[0].onend?.());
    fireEvent.click(stopReading()[0]);
    act(() => synth.spoken[1].onend?.());
    expect(synth.spoken).toHaveLength(2);
    expect(readAloud()).toHaveLength(1);
  });

  it('unmounting mid-response stops the queue', () => {
    const synth = installSynth();
    const view = renderCards(<Card text={LONG} />);
    fireEvent.click(readAloud()[0]);
    view.unmount();
    act(() => synth.spoken[0].onend?.());
    expect(synth.spoken).toHaveLength(1);
  });

  it('shows the failure message when a later chunk fails, and goes idle', () => {
    const synth = installSynth();
    renderCards(<Card text={LONG} />);
    fireEvent.click(readAloud()[0]);
    act(() => synth.spoken[0].onend?.());
    act(() => synth.spoken[1].onerror?.({ error: 'synthesis-failed' }));
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't read this aloud/i);
    expect(readAloud()).toHaveLength(1);
    expect(synth.spoken).toHaveLength(2);
  });

  it('does not let another card be cut off by this card running through its chunks', () => {
    const synth = installSynth();
    renderCards(<Card key="a" text={LONG} />, <Card key="b" text="Card B." />);
    const [a, b] = readAloud();
    fireEvent.click(a);
    fireEvent.click(b);
    act(() => synth.spoken[0].onend?.());
    expect(synth.spoken.map((u) => u.text)).toEqual([expect.stringContaining('Sentence number 0'), 'Card B.']);
    expect(stopReading()).toHaveLength(1);
  });
});
