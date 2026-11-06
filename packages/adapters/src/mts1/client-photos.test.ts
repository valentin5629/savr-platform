import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import { Mts1Client } from './client.js';
import { _setMts1Handlers } from './mock.js';
import { JPEG_DE_TEST } from './mock-tour.js';

// Tests « wire » du téléchargement d'une photo : chemin réel (fetch, handlers à
// null), dans la forme mesurée sur le compte de démonstration le 2026-10-13, sur
// ses 7 photos. Sans clé : 401. Avec : 200, « text/html », et un corps qui n'est
// pas le fichier mais le JPEG écrit en base64. Photo inconnue : 200, corps vide.
// L'ancien client n'envoyait pas la clé et rangeait le corps tel quel.
// La forme est celle du fil ; les valeurs sont inventées (dépôt public).

const ADRESSE =
  'https://mts1.test/v3/tours/photo/65a1b2c3d4e5f60718293a4c/ArretInventeAbCdEfGhIj/PhotoInventeeKlMnOpQrSt';

const journal: Array<Record<string, unknown>> = [];
const fakeSupabase = {
  from: () => ({
    insert: async (ligne: Record<string, unknown>) => {
      journal.push(ligne);
      return { error: null };
    },
  }),
} as never;

type Init = {
  method: string;
  headers: Record<string, string>;
  redirect: string;
};

// Une vraie réponse HTTP : le corps se lit en flux, par le même chemin que sur
// le fil (le plafond et l'échéance s'y appliquent).
function stubFetch(corps: Buffer | string, status = 200) {
  const fetchMock = vi.fn(
    async (_url: string, _init: Init) =>
      new Response(typeof corps === 'string' ? corps : new Uint8Array(corps), {
        status,
      }),
  );
  vi.stubGlobal('fetch', fetchMock as never);
  return fetchMock;
}

describe('M1.5b / MTS-1 client — téléchargement d’une photo (wire)', () => {
  beforeEach(() => {
    journal.length = 0;
    _setMts1Handlers(null); // force le chemin réel (fetch)
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'cle-de-test');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _setMts1Handlers(null);
  });

  it('M1.5b/photo_fil_cle_et_base64 — GET sur l’adresse, avec la clé, et le corps base64 est décodé en JPEG', async () => {
    const fetchMock = stubFetch(JPEG_DE_TEST.toString('base64'));

    const photo = await new Mts1Client(fakeSupabase).downloadPhoto(ADRESSE);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ADRESSE);
    expect(init.method).toBe('GET');
    // Sans cet en-tête, MTS-1 répond 401 BAD_CREDENTIALS.
    expect(init.headers['Authorization']).toBe('Bearer cle-de-test');
    // Une redirection emmènerait la clé ailleurs : refusée, pas suivie.
    expect(init.redirect).toBe('error');

    // Le fichier rendu est le JPEG, pas son écriture en base64.
    expect(photo!.equals(JPEG_DE_TEST)).toBe(true);
    expect(photo!.subarray(0, 3).toString('hex')).toBe('ffd8ff');

    // L'appel est journalisé sans les identifiants de l'adresse.
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      integration: 'mts1',
      direction: 'entrant',
      methode: 'GET',
      endpoint: '/v3/tours/photo',
      statut_http: 200,
    });
  });

  it('M1.5b/photo_fil_binaire — un corps déjà en JPEG est rendu tel quel', async () => {
    stubFetch(JPEG_DE_TEST);
    const photo = await new Mts1Client(fakeSupabase).downloadPhoto(ADRESSE);
    expect(photo!.equals(JPEG_DE_TEST)).toBe(true);
  });

  it('M1.5b/photo_fil_absente — corps vide (photo inconnue de MTS-1) ou 404 → null', async () => {
    stubFetch('');
    await expect(
      new Mts1Client(fakeSupabase).downloadPhoto(ADRESSE),
    ).resolves.toBeNull();

    stubFetch('{"reasons":["NOT_FOUND"]}', 404);
    await expect(
      new Mts1Client(fakeSupabase).downloadPhoto(ADRESSE),
    ).resolves.toBeNull();
  });

  it('M1.5b/photo_fil_illisible — un corps qui n’est pas un JPEG lève : rien d’illisible n’est stocké', async () => {
    // Une page d'erreur servie en 200, ou du base64 d'autre chose.
    for (const corps of [
      '<html><body>erreur</body></html>',
      Buffer.from('pas une image').toString('base64'),
    ]) {
      stubFetch(corps);
      await expect(
        new Mts1Client(fakeSupabase).downloadPhoto(ADRESSE),
      ).rejects.toBeInstanceOf(LogistiqueTransientError);
    }
  });

  it('M1.5b/photo_fil_corps_lent — l’échéance de 30 s court jusqu’à la fin du corps, pas seulement jusqu’aux en-têtes', async () => {
    vi.useFakeTimers();
    try {
      // En-têtes tout de suite, corps qui n'arrive jamais : seule l'échéance
      // l'interrompt (le flux d'un vrai `fetch` passe en erreur sur l'abandon).
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async (_url: string, init: { signal: AbortSignal }) =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controleur) {
                  init.signal.addEventListener('abort', () =>
                    controleur.error(
                      Object.assign(new Error('aborted'), {
                        name: 'AbortError',
                      }),
                    ),
                  );
                },
              }),
              { status: 200 },
            ),
        ) as never,
      );

      const attente = new Mts1Client(fakeSupabase)
        .downloadPhoto(ADRESSE)
        .catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(await attente).toBeInstanceOf(LogistiqueAmbiguousError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('M1.5b/photo_fil_plafond — un corps de plus de 15 Mo est abandonné, rien n’est rendu', async () => {
    const MO = 1024 * 1024;
    let envoyes = 0;
    const flux = new ReadableStream<Uint8Array>({
      pull(controleur) {
        envoyes += 1;
        controleur.enqueue(new Uint8Array(MO).fill(0x41));
        if (envoyes === 20) controleur.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(flux, { status: 200 })) as never,
    );

    await expect(
      new Mts1Client(fakeSupabase).downloadPhoto(ADRESSE),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
    // Lecture arrêtée au seizième méga-octet, pas au bout des vingt.
    expect(envoyes).toBeLessThan(20);
  });

  it('M1.5b/photo_fil_refus — 401 (clé refusée) et 5xx lèvent, sans rien rendre', async () => {
    stubFetch('{"reasons":["BAD_CREDENTIALS"]}', 401);
    await expect(
      new Mts1Client(fakeSupabase).downloadPhoto(ADRESSE),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);

    stubFetch('', 503);
    await expect(
      new Mts1Client(fakeSupabase).downloadPhoto(ADRESSE),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
  });

  it('M1.5b/photo_fil_hors_connecteur — une adresse d’un autre hôte n’est jamais appelée : la clé ne part que vers le connecteur', async () => {
    const fetchMock = stubFetch(JPEG_DE_TEST.toString('base64'));

    for (const adresse of [
      'https://ailleurs.example.test/v3/tours/photo/a/b/c',
      // même nom d'hôte, autre port ou autre protocole : une autre origine
      'https://mts1.test:8443/v3/tours/photo/a/b/c',
      'http://mts1.test/v3/tours/photo/a/b/c',
      'pas une adresse',
    ]) {
      await expect(
        new Mts1Client(fakeSupabase).downloadPhoto(adresse),
        adresse,
      ).rejects.toBeInstanceOf(LogistiquePermanentError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('M1.5b/photo_fil_erreur_sans_cle — l’erreur réseau levée ne recopie pas le texte de l’erreur de fetch', async () => {
    // `fetch` recopie dans son message la valeur d'en-tête qu'il refuse, donc la
    // clé entière : le libellé levé ne doit pas le reprendre.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError(
          'Headers.append: "Bearer cle-de-test" is an invalid header value.',
        );
      }) as never,
    );

    const erreur = await new Mts1Client(fakeSupabase)
      .downloadPhoto(ADRESSE)
      .catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(LogistiqueTransientError);
    expect(String(erreur)).not.toContain('cle-de-test');
  });
});
