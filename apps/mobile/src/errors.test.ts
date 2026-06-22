import { describe, it, expect } from 'vitest';
import { toUserMessage } from './errors';

describe('toUserMessage', () => {
  it('maps React Native network failures to a connectivity hint', () => {
    expect(toUserMessage(new TypeError('Network request failed'), 'fallback')).toBe(
      'Could not reach the server. Please check your connection and try again.',
    );
  });

  it('maps undici fetch failures to a connectivity hint', () => {
    expect(toUserMessage(new TypeError('fetch failed'), 'fallback')).toBe(
      'Could not reach the server. Please check your connection and try again.',
    );
  });

  it('replaces internal api-client diagnostics with the caller fallback', () => {
    expect(toUserMessage(new Error('API /workspaces returned 500'), 'Could not load')).toBe(
      'Could not load',
    );
    expect(toUserMessage(new Error('API returned 502'), 'Could not load')).toBe('Could not load');
  });

  it('passes through user-facing messages from our throws and the API error field', () => {
    expect(toUserMessage(new Error('Invalid email or password'), 'fallback')).toBe(
      'Invalid email or password',
    );
    expect(toUserMessage(new Error('A category with that name already exists'), 'fallback')).toBe(
      'A category with that name already exists',
    );
  });

  it('uses the fallback for non-Error throws and empty messages', () => {
    expect(toUserMessage('boom', 'fallback')).toBe('fallback');
    expect(toUserMessage(undefined, 'fallback')).toBe('fallback');
    expect(toUserMessage(new Error('   '), 'fallback')).toBe('fallback');
  });
});
