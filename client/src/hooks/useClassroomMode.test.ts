import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useClassroomMode } from './useClassroomMode';

function renderMode(userId: string | undefined) {
  return renderHook(({ id }) => useClassroomMode(id), { initialProps: { id: userId } });
}

function turnOn(result: { current: ReturnType<typeof useClassroomMode> }) {
  act(() => result.current[1](true));
  expect(result.current[0]).toBe(true);
}

describe('useClassroomMode', () => {
  it('starts off', () => {
    expect(renderMode('u1').result.current[0]).toBe(false);
  });

  it('stays on while the same user is signed in', () => {
    const { result, rerender } = renderMode('u1');
    turnOn(result);

    rerender({ id: 'u1' });

    expect(result.current[0]).toBe(true);
  });

  it('does not carry over to a different account', () => {
    const { result, rerender } = renderMode('u1');
    turnOn(result);

    rerender({ id: 'u2' });

    expect(result.current[0]).toBe(false);
  });

  it('is off when the same user signs back in after a logout', () => {
    const { result, rerender } = renderMode('u1');
    turnOn(result);

    rerender({ id: undefined });
    rerender({ id: 'u1' });

    expect(result.current[0]).toBe(false);
  });
});
