/**
 * M1.6 — lecture R2 bornée au bucket de l'environnement (décision Val 2026-10-07).
 *
 * L'écriture ne peut plus viser un autre bucket (uploadObject n'en prend pas,
 * cf. @savr/shared/src/r2/upload.test.ts). La lecture, elle, part d'une clé
 * "bucket/key" relue en base (`shared.fichiers`, `pdf_url`, `pdf_url_savr`) : sans
 * garde, une ligne héritée ou une base recopiée d'un autre environnement ferait
 * signer une URL vers le stockage de cet environnement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send, getSignedUrl, uploadObject } = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
  uploadObject: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }));
vi.mock('@savr/shared/src/r2/upload.js', () => ({
  getS3Client: () => ({ send }),
  uploadObject,
}));

import { getObjectBytes, getPresignedUrl, uploadPdf } from './r2-client.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('R2_BUCKET_NAME', 'savr-dev');
  getSignedUrl.mockResolvedValue('https://r2.example/signee');
  send.mockResolvedValue({
    Body: { transformToByteArray: async () => new Uint8Array([7, 8]) },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("M1.6 / r2-client — lecture bornée au bucket de l'environnement", () => {
  it("getPresignedUrl signe une clé du bucket de l'environnement", async () => {
    const url = await getPresignedUrl('savr-dev/bordereaux/b1/doc.pdf', 900);
    expect(url).toBe('https://r2.example/signee');
    const commande = getSignedUrl.mock.calls[0]![1] as {
      input: Record<string, unknown>;
    };
    expect(commande.input).toEqual({
      Bucket: 'savr-dev',
      Key: 'bordereaux/b1/doc.pdf',
    });
    expect(getSignedUrl.mock.calls[0]![2]).toEqual({ expiresIn: 900 });
  });

  it("getObjectBytes lit une clé du bucket de l'environnement", async () => {
    const octets = await getObjectBytes('savr-dev/logos/a.png');
    expect([...octets]).toEqual([7, 8]);
    expect(
      (send.mock.calls[0]![0] as { input: Record<string, unknown> }).input,
    ).toEqual({ Bucket: 'savr-dev', Key: 'logos/a.png' });
  });

  // Les trois premiers sont les buckets communs d'avant le cloisonnement ; le
  // dernier, le bucket d'un autre environnement.
  it.each([
    'bordereaux/b1/bordereau-zd-v1-1.pdf',
    'rapports/r1/rapport-recyclage-zd-v1-1.pdf',
    'collectes/photos/c1/p.jpg',
    'savr-prod/bordereaux/b1/doc.pdf',
  ])('%s → refusée : ni URL signée, ni lecture', async (cle) => {
    await expect(getPresignedUrl(cle)).rejects.toThrow(/hors du bucket/);
    await expect(getObjectBytes(cle)).rejects.toThrow(/hors du bucket/);
    expect(getSignedUrl).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  // Une URL signée sur la racine du bucket est une demande de listage : le
  // bucket contient tous les fichiers de l'environnement (revue sécurité
  // 2026-10-07). Seul le service écrit ces clés ; aucune n'a cette forme.
  it.each([
    'savr-dev',
    'savr-dev/',
    'savr-dev//bordereaux/b1.pdf',
    'savr-dev/bordereaux/',
    'savr-dev/logos/../bordereaux/b1.pdf',
    'savr-dev/./bordereaux/b1.pdf',
  ])(
    '%s → refusée : pas d’objet désigné, rien de signé ni de lu',
    async (cle) => {
      await expect(getPresignedUrl(cle)).rejects.toThrow(/sans objet désigné/);
      await expect(getObjectBytes(cle)).rejects.toThrow(/sans objet désigné/);
      expect(getSignedUrl).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('R2_BUCKET_NAME absent → lève, aucune URL signée (pas de repli)', async () => {
    vi.stubEnv('R2_BUCKET_NAME', '');
    await expect(
      getPresignedUrl('savr-dev/bordereaux/b1/doc.pdf'),
    ).rejects.toThrow('R2_BUCKET_NAME');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});

describe('M1.6 / r2-client — uploadPdf', () => {
  it('délègue à uploadObject sans bucket, en application/pdf', async () => {
    const objet = {
      bucket: 'savr-dev',
      key: 'rapports/r1/doc.pdf',
      storageKey: 'savr-dev/rapports/r1/doc.pdf',
    };
    uploadObject.mockResolvedValue(objet);
    const pdf = Buffer.from('%PDF');
    await expect(uploadPdf('rapports/r1/doc.pdf', pdf)).resolves.toBe(objet);
    expect(uploadObject).toHaveBeenCalledWith(
      'rapports/r1/doc.pdf',
      pdf,
      'application/pdf',
    );
  });
});
