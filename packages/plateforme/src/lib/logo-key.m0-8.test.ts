/**
 * Revue sécurité 2026-09-18 — garde des clés de logo R2 (lib/logo-key.ts).
 * Titrés « M0.8-XX » → exécutés par `pnpm test:module M0.8`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { bucketLogos, parseCleLogo } from '@/lib/logo-key';

const U = '0f8b2c1e-3d4a-4b5c-9d6e-7f8091a2b3c4';

describe('M0.8-50 — parseCleLogo borne la clé au bucket applicatif et à logos/', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepte le format des routes d’upload et découpe bucket / clé', () => {
    vi.stubEnv('R2_BUCKET_NAME', 'savr-prod');
    expect(parseCleLogo(`savr-prod/logos/${U}.jpg`)).toEqual({
      bucket: 'savr-prod',
      key: `logos/${U}.jpg`,
    });
  });

  it('repli savr-dev quand R2_BUCKET_NAME est absent (même repli que l’upload)', () => {
    vi.stubEnv('R2_BUCKET_NAME', '');
    expect(bucketLogos()).toBe('savr-dev');
    expect(parseCleLogo(`savr-dev/logos/${U}.png`)).not.toBeNull();
  });

  it('refuse un logo bien formé d’un autre bucket', () => {
    vi.stubEnv('R2_BUCKET_NAME', 'savr-prod');
    expect(parseCleLogo(`savr-dev/logos/${U}.png`)).toBeNull();
  });

  it.each([
    null,
    undefined,
    '',
    '   ',
    `savr-prod/logos/${U}.png `,
    `savr-prod/logos/${U.toUpperCase()}.png`,
  ])('refuse %j', (v) => {
    vi.stubEnv('R2_BUCKET_NAME', 'savr-prod');
    expect(parseCleLogo(v)).toBeNull();
  });
});
