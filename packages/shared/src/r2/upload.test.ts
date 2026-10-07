/**
 * Cloisonnement du stockage R2 entre environnements (décision Val 2026-10-07).
 *
 * Constat du 2026-10-07 : les PDF partaient dans deux buckets codés en dur
 * (`bordereaux`, `rapports`), les photos du transporteur dans un troisième
 * (`collectes`, absent du compte Cloudflare), tous communs à dev et prod ; et un
 * `R2_BUCKET_NAME` absent retombait sur `savr-dev`, production comprise.
 *
 * Ce fichier verrouille les deux choses qui rendent ce retour impossible :
 *   1. le COMPORTEMENT — tout envoi et toute lecture visent le bucket de
 *      l'environnement, et rien ne part si la variable manque ;
 *   2. la STRUCTURE — un seul fichier lit `R2_BUCKET_NAME`, un seul construit un
 *      envoi S3. Sans ce second point, le premier ne prouverait rien sur un appel
 *      écrit demain à côté de `uploadObject`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

// Le SDK est remplacé : on observe la commande envoyée, sans appel réseau.
vi.mock('@aws-sdk/client-s3', () => {
  class Commande {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      send = send;
    },
    PutObjectCommand: class extends Commande {},
    GetObjectCommand: class extends Commande {},
  };
});

import { bucketEnvironnement } from './bucket.js';
import { getObject, uploadObject } from './upload.js';

function entreeEnvoyee(): Record<string, unknown> {
  return (send.mock.calls[0]![0] as { input: Record<string, unknown> }).input;
}

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({});
  vi.stubEnv('R2_ACCOUNT_ID', 'compte');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'cle');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
});
afterEach(() => vi.unstubAllEnvs());

describe("stockage R2 — le bucket est celui de l'environnement", () => {
  it.each(['savr-dev', 'savr-prod'])(
    'uploadObject écrit dans %s quand R2_BUCKET_NAME le désigne',
    async (bucket) => {
      vi.stubEnv('R2_BUCKET_NAME', bucket);
      const objet = await uploadObject(
        'bordereaux/b1/doc.pdf',
        Buffer.from('PDF'),
        'application/pdf',
      );

      expect(send).toHaveBeenCalledTimes(1);
      expect(entreeEnvoyee()).toMatchObject({
        Bucket: bucket,
        Key: 'bordereaux/b1/doc.pdf',
        ContentType: 'application/pdf',
      });
      // Ce que l'appelant persiste désigne exactement l'objet écrit.
      expect(objet).toEqual({
        bucket,
        key: 'bordereaux/b1/doc.pdf',
        storageKey: `${bucket}/bordereaux/b1/doc.pdf`,
      });
    },
  );

  it('le premier dossier de la clé ne devient jamais le bucket', async () => {
    vi.stubEnv('R2_BUCKET_NAME', 'savr-dev');
    // Anciens noms de bucket, désormais simples dossiers.
    for (const dossier of ['bordereaux', 'rapports', 'collectes']) {
      send.mockClear();
      await uploadObject(`${dossier}/x.pdf`, Buffer.from('x'), 'text/plain');
      expect(entreeEnvoyee()['Bucket']).toBe('savr-dev');
    }
  });

  it("getObject lit dans le bucket de l'environnement", async () => {
    vi.stubEnv('R2_BUCKET_NAME', 'savr-prod');
    send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2]) },
      ContentType: 'image/png',
    });
    await getObject('logos/a.png');
    expect(entreeEnvoyee()).toEqual({
      Bucket: 'savr-prod',
      Key: 'logos/a.png',
    });
  });
});

describe('stockage R2 — R2_BUCKET_NAME absent : échec explicite, aucun repli', () => {
  it.each([undefined, ''])('valeur %j → bucketEnvironnement lève', (valeur) => {
    if (valeur === undefined) vi.stubEnv('R2_BUCKET_NAME', undefined);
    else vi.stubEnv('R2_BUCKET_NAME', valeur);
    expect(() => bucketEnvironnement()).toThrow('R2_BUCKET_NAME');
  });

  it('uploadObject lève et rien ne part (avant : écriture dans savr-dev)', async () => {
    vi.stubEnv('R2_BUCKET_NAME', '');
    await expect(
      uploadObject('logos/a.png', Buffer.from('x'), 'image/png'),
    ).rejects.toThrow('R2_BUCKET_NAME');
    expect(send).not.toHaveBeenCalled();
  });

  it('getObject lève et rien ne part', async () => {
    vi.stubEnv('R2_BUCKET_NAME', '');
    await expect(getObject('logos/a.png')).rejects.toThrow('R2_BUCKET_NAME');
    expect(send).not.toHaveBeenCalled();
  });
});

// ── Structure ───────────────────────────────────────────────────────────────

const RACINE = resolve(__dirname, '../../../..');
// Tout le code que Next ou Railway exécute. Les tests sont hors scan : ils
// simulent le SDK et posent la variable, c'est leur rôle.
const RACINES_CODE = [
  'packages/shared/src',
  'packages/plateforme/src',
  'packages/adapters/src',
  'packages/tms',
  'apps/pdf-renderer/src',
  'scripts',
];
const EST_CODE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const EST_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function fichiersDeCode(): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string): void => {
    for (const nom of readdirSync(dossier)) {
      if (nom === 'node_modules' || nom === '.next' || nom === 'dist') continue;
      const chemin = join(dossier, nom);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else if (EST_CODE.test(nom) && !EST_TEST.test(nom)) trouves.push(chemin);
    }
  };
  for (const racine of RACINES_CODE) parcourir(join(RACINE, racine));
  return trouves;
}

function fichiersContenant(motif: RegExp): string[] {
  return fichiersDeCode()
    .filter((f) => motif.test(readFileSync(f, 'utf8')))
    .map((f) => relative(RACINE, f).split(sep).join('/'))
    .sort();
}

describe('stockage R2 — un seul point de passage (cliquet de structure)', () => {
  it('le scan voit bien du code (garde contre un cliquet vide)', () => {
    expect(fichiersDeCode().length).toBeGreaterThan(200);
  });

  // Une LECTURE de la variable (accès direct, indexé ou par déstructuration) — pas
  // une simple mention : des commentaires la citent ailleurs, à juste titre.
  const LECTURE_BUCKET =
    /process\.env\s*(?:\.\s*R2_BUCKET_NAME|\[\s*['"`]R2_BUCKET_NAME)|\{[^}]*\bR2_BUCKET_NAME\b[^}]*\}\s*=\s*process\.env/;

  it('le motif reconnaît les trois façons de lire la variable', () => {
    for (const lecture of [
      "process.env['R2_BUCKET_NAME'] || 'savr-dev'",
      'process.env.R2_BUCKET_NAME ?? "savr-dev"',
      'const { R2_BUCKET_NAME } = process.env;',
    ]) {
      expect(lecture).toMatch(LECTURE_BUCKET);
    }
    expect('// sans R2_BUCKET_NAME l’upload lève').not.toMatch(LECTURE_BUCKET);
  });

  it('R2_BUCKET_NAME n’est lue que par bucket.ts — aucun autre lecteur, donc aucun repli', () => {
    expect(fichiersContenant(LECTURE_BUCKET)).toEqual([
      'packages/shared/src/r2/bucket.ts',
    ]);
  });

  it('le SDK S3 n’est importé que par les deux modules de stockage', () => {
    expect(fichiersContenant(/@aws-sdk\//)).toEqual([
      'packages/plateforme/src/lib/pdf/r2-client.ts',
      'packages/shared/src/r2/upload.ts',
    ]);
  });

  it('un seul fichier construit un envoi, et aucun ne supprime ni ne copie', () => {
    expect(fichiersContenant(/PutObjectCommand/)).toEqual([
      'packages/shared/src/r2/upload.ts',
    ]);
    expect(
      fichiersContenant(
        /(?:DeleteObjects?|CopyObject|CreateMultipartUpload)Command|lib-storage/,
      ),
    ).toEqual([]);
  });
});
