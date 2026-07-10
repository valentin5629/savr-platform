/**
 * R23b-2 — logoKeyToDataUri / makeLogoResolver (BL-P3-05).
 * Titrés « M0.8-XX » → exécutés par `pnpm test:module M0.8`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getObjectBytes = vi.fn();
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import { logoKeyToDataUri, makeLogoResolver } from '@/lib/pdf/logo-inline';

describe('M0.8-49 — logoKeyToDataUri inline un logo R2 en data URI (BL-P3-05)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retourne un data URI base64 avec le mime déduit de l’extension (png)', async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    getObjectBytes.mockResolvedValue(bytes);
    expect(await logoKeyToDataUri('logos-savr/logos/abc.png')).toBe(
      `data:image/png;base64,${bytes.toString('base64')}`,
    );
  });

  it('déduit le mime jpeg (.jpg)', async () => {
    getObjectBytes.mockResolvedValue(Buffer.from([9]));
    expect(await logoKeyToDataUri('b/x.jpg')).toMatch(
      /^data:image\/jpeg;base64,/,
    );
  });

  it('null si clé absente/vide — aucune lecture R2', async () => {
    expect(await logoKeyToDataUri(null)).toBeNull();
    expect(await logoKeyToDataUri('   ')).toBeNull();
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it('null si la lecture R2 échoue (best-effort, jamais bloquant)', async () => {
    getObjectBytes.mockRejectedValue(new Error('R2 down'));
    expect(await logoKeyToDataUri('b/x.png')).toBeNull();
  });

  it('makeLogoResolver mémoïse : une seule lecture R2 par clé', async () => {
    getObjectBytes.mockResolvedValue(Buffer.from([1]));
    const resolve = makeLogoResolver();
    await resolve('b/a.png');
    await resolve('b/a.png');
    await resolve('b/b.png');
    expect(getObjectBytes).toHaveBeenCalledTimes(2);
  });
});
