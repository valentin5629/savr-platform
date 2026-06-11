import { existsSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('M0.0', () => {
  it('SMOKE-1 — scripts/sync-specs.sh est exécutable', () => {
    const path = 'scripts/sync-specs.sh';
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode;
    expect(mode & 0o100).toBeTruthy();
  });
});
