/**
 * Cloisonnement du stockage R2 entre environnements (décision Val 2026-10-07).
 *
 * Constat du 2026-10-07 : les PDF partaient dans deux buckets codés en dur
 * (`bordereaux`, `rapports`), les photos du transporteur dans un troisième
 * (`collectes`, absent du compte Cloudflare), tous communs à dev et prod ; et un
 * `R2_BUCKET_NAME` absent retombait sur `savr-dev`, production comprise.
 *
 * Ce fichier verrouille deux choses, et pas davantage :
 *   1. le COMPORTEMENT des fonctions partagées — `uploadObject` et `getObject`
 *      visent le bucket de l'environnement, et rien ne part si la variable manque ;
 *   2. un PÉRIMÈTRE — dans les dossiers scannés (RACINES_CODE), le SDK S3 n'est
 *      importé que par deux fichiers, un seul nomme `PutObjectCommand`, aucun ne
 *      supprime ni ne copie, et le nom `R2_BUCKET_NAME` n'apparaît dans aucun code
 *      (hors commentaires) ailleurs que dans `bucket.ts`.
 *
 * Ce que le point 2 ne prouve PAS, à savoir avant de s'y fier :
 *   - il ne regarde pas d'où vient l'argument `Bucket` d'une commande. Une fonction
 *     ajoutée à upload.ts ou à r2-client.ts avec un bucket en paramètre le
 *     laisserait vert : ces deux fichiers se relisent à la main ;
 *   - il ne voit pas un envoi fait sans le SDK (requête signée à la main, autre
 *     bibliothèque), ni un nom de variable ou de module assemblé par concaténation ;
 *   - il ne lit que du code TS/JS : ni scripts shell, ni workflows.
 * Et rien ici ne rend dev incapable d'atteindre le stockage de prod : cela tient
 * à la clé d'API R2 de chaque environnement, à restreindre chez Cloudflare.
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
// Dossiers scannés, en entier (fichiers de configuration à la racine des
// packages compris : next.config.ts, sentry.*.config.ts). Les tests sont hors
// scan : ils simulent le SDK et posent la variable, c'est leur rôle.
const RACINES_CODE = [
  'packages/shared',
  'packages/plateforme',
  'packages/adapters',
  'packages/tms',
  'apps/pdf-renderer',
  'scripts',
  'e2e',
];
const HORS_SCAN = new Set(['node_modules', '.next', 'dist', '.turbo']);
const EST_CODE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const EST_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function fichiersDeCode(): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string): void => {
    for (const nom of readdirSync(dossier)) {
      if (HORS_SCAN.has(nom)) continue;
      const chemin = join(dossier, nom);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else if (EST_CODE.test(nom) && !EST_TEST.test(nom)) trouves.push(chemin);
    }
  };
  for (const racine of RACINES_CODE) parcourir(join(RACINE, racine));
  return trouves;
}

// Retire les commentaires `/* … */` et `// …`. Un `//` n'est un commentaire que
// précédé d'un blanc ou en début de ligne : celui d'une adresse (`https://…`)
// est laissé, pour ne pas effacer le code qui suit sur la même ligne.
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function fichiersContenant(
  motif: RegExp,
  lire: (source: string) => string = (source) => source,
): string[] {
  return fichiersDeCode()
    .filter((f) => motif.test(lire(readFileSync(f, 'utf8'))))
    .map((f) => relative(RACINE, f).split(sep).join('/'))
    .sort();
}

describe('stockage R2 — périmètre des accès (cliquet de structure)', () => {
  it('le scan voit bien du code (garde contre un cliquet vide)', () => {
    expect(fichiersDeCode().length).toBeGreaterThan(500);
  });

  it('sansCommentaires garde le code, y compris après une adresse', () => {
    const source = [
      '// sans R2_BUCKET_NAME l’upload lève',
      '/* R2_BUCKET_NAME */ const a = 1;',
      "const u = 'https://exemple.test'; const b = env.R2_BUCKET_NAME;",
      'const c = process.env?.R2_BUCKET_NAME; // repli',
    ].join('\n');
    const code = sansCommentaires(source);
    expect(code).not.toContain('upload lève');
    expect(code).not.toContain('repli');
    expect(code).toContain('const a = 1;');
    expect(code).toContain('env.R2_BUCKET_NAME');
    expect(code).toContain('process.env?.R2_BUCKET_NAME');
  });

  // Le NOM de la variable, quelle que soit la façon de la lire (accès direct ou
  // optionnel, alias de process.env, déstructuration, constante, schéma de
  // validation) : toutes ces formes l'écrivent en toutes lettres.
  it('le nom R2_BUCKET_NAME n’apparaît dans aucun code hors de bucket.ts', () => {
    expect(fichiersContenant(/R2_BUCKET_NAME/, sansCommentaires)).toEqual([
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
