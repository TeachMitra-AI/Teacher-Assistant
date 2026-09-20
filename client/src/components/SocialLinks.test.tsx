import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SocialLinks } from './SocialLinks';
import { SOCIAL_PROFILES } from '../seo/site';

// SOCIAL_PROFILES is typed readonly; one test extends it temporarily to prove
// the fallback-icon path, and restores it in `finally`.
const SOCIAL_PROFILES_MUTABLE = SOCIAL_PROFILES as unknown as { id: string; name: string; url: string }[];

afterEach(cleanup);

describe('SocialLinks', () => {
  test('is a labelled section headed "Follow SarasTech" with a list of links', () => {
    render(<SocialLinks />);

    const section = screen.getByRole('region', { name: 'Follow SarasTech' });
    expect(within(section).getByRole('heading', { level: 2, name: 'Follow SarasTech' })).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(SOCIAL_PROFILES.length);
  });

  test.each([
    ['SarasTech on LinkedIn', 'https://www.linkedin.com/company/sarastechai/', 'LinkedIn'],
    ['SarasTech on Instagram', 'https://www.instagram.com/sarastechai/', 'Instagram'],
    ['SarasTech on X', 'https://x.com/SarasTechAI', 'X'],
    ['SarasTech on YouTube', 'https://www.youtube.com/@SarasTechAI', 'YouTube'],
    ['SarasTech on Substack', 'https://substack.com/@sarastechai', 'Substack'],
    ['SarasTech on Reddit', 'https://www.reddit.com/user/SarasTechAI/', 'Reddit'],
  ])('%s is a crawlable external <a> with visible text', (label, href, visibleText) => {
    render(<SocialLinks />);

    const link = screen.getByRole('link', { name: label });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('aria-label', label);
    // Not icon-only: the platform name is visible, and the icon is hidden from AT.
    expect(link).toHaveTextContent(visibleText);
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('a profile without a bespoke icon still renders as a working link', () => {
    // Guards the "add another platform later" path: config-only additions must not break.
    SOCIAL_PROFILES_MUTABLE.push({ id: 'facebook', name: 'Facebook', url: 'https://www.facebook.com/example' });
    try {
      render(<SocialLinks />);
      const link = screen.getByRole('link', { name: 'SarasTech on Facebook' });
      expect(link).toHaveAttribute('href', 'https://www.facebook.com/example');
      expect(link.querySelector('svg')).toBeInTheDocument();
    } finally {
      SOCIAL_PROFILES_MUTABLE.pop();
    }
  });
});
