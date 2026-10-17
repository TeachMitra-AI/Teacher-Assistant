import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import RunStatus from './RunStatus';

describe('RunStatus', () => {
  test('renders the default waiting line in English when the turn was submitted in English', () => {
    render(<RunStatus startedAt={Date.now()} language="en" />);
    expect(screen.getByRole('status')).toHaveTextContent('Preparing practical advice for you…');
  });

  test('renders the same waiting line in Hindi when the turn was submitted in Hindi', () => {
    render(<RunStatus startedAt={Date.now()} language="hi" />);
    expect(screen.getByRole('status')).toHaveTextContent('आपके लिए व्यावहारिक सलाह तैयार की जा रही है…');
  });
});
