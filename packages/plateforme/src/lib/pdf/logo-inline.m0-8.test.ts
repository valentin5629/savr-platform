/**
 * R23b-2 — logoKeyToDataUri / makeLogoResolver (BL-P3-05).
 * Titrés « M0.8-XX » → exécutés par `pnpm test:module M0.8`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getObjectBytes = vi.fn();
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import { logoKeyToDataUri, makeLogoResolver } from '@/lib/pdf/logo-inline';

// Clés au format des routes d'upload : `${R2_BUCKET_NAME}/logos/<uuid>.(png|jpg)`.
const B = 'savr-test';
const U = '0f8b2c1e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const V = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const cle = (id = U, ext = 'png') => `${B}/logos/${id}.${ext}`;

describe('M0.8-49 — logoKeyToDataUri inline un logo R2 en data URI (BL-P3-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('R2_BUCKET_NAME', B);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('retourne un data URI base64 avec le mime déduit de l’extension (png)', async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    getObjectBytes.mockResolvedValue(bytes);
    expect(await logoKeyToDataUri(cle())).toBe(
      `data:image/png;base64,${bytes.toString('base64')}`,
    );
  });

  it('déduit le mime jpeg (.jpg)', async () => {
    getObjectBytes.mockResolvedValue(Buffer.from([9]));
    expect(await logoKeyToDataUri(cle(U, 'jpg'))).toMatch(
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
    expect(await logoKeyToDataUri(cle())).toBeNull();
  });

  it('null si le logo dépasse 1 Mo (évite un data URI > limite 2 Mo du renderer)', async () => {
    getObjectBytes.mockResolvedValue(Buffer.alloc(1_000_001));
    expect(await logoKeyToDataUri(cle())).toBeNull();
  });

  it('makeLogoResolver mémoïse : une seule lecture R2 par clé', async () => {
    getObjectBytes.mockResolvedValue(Buffer.from([1]));
    const resolve = makeLogoResolver();
    await resolve(cle(U));
    await resolve(cle(U));
    await resolve(cle(V));
    expect(getObjectBytes).toHaveBeenCalledTimes(2);
  });
});

describe('M0.8-49b — logoKeyToDataUri ne lit que les logos du bucket applicatif (revue sécurité 2026-09-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('R2_BUCKET_NAME', B);
    getObjectBytes.mockResolvedValue(Buffer.from([1]));
  });
  afterEach(() => vi.unstubAllEnvs());

  // logo_url est écrit par le client (PostgREST) puis inliné dans SON PDF : toute
  // clé hors logos/ du bucket applicatif doit retomber sur l'en-tête Savr SANS
  // aucune lecture R2 (sinon exfiltration de bordereaux/attestations/photos).
  it.each([
    ['un autre préfixe du bucket (bordereau)', `${B}/bordereaux/${U}.pdf`],
    ['un autre bucket', `autre-bucket/logos/${U}.png`],
    ['une traversée sous logos/', `${B}/logos/../bordereaux/${U}.png`],
    ['un logos/ imbriqué', `${B}/bordereaux/logos/${U}.png`],
    ['un nom hors uuid', `${B}/logos/abc.png`],
    ['une extension hors png/jpg', `${B}/logos/${U}.pdf`],
    ['une URL externe', `https://cdn.test/logos/${U}.png`],
  ])('refuse %s — null, aucune lecture R2', async (_libelle, cleHostile) => {
    expect(await logoKeyToDataUri(cleHostile)).toBeNull();
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it('lit exactement la clé du logo validé', async () => {
    await logoKeyToDataUri(cle());
    expect(getObjectBytes).toHaveBeenCalledWith(cle());
  });

  it('makeLogoResolver hérite de la garde (batchs PDF)', async () => {
    const resolve = makeLogoResolver();
    expect(await resolve(`${B}/bordereaux/${U}.pdf`)).toBeNull();
    expect(getObjectBytes).not.toHaveBeenCalled();
  });
});
