import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/state/settings';
describe('silent mode', () => {
  it('is on by default so recording never feeds back', () => {
    expect(DEFAULT_SETTINGS.silentMode).toBe(true);
  });
});
