// Client du service PDF : quand `fetch` échoue, l'erreur levée ne porte rien de
// ce que le moteur recopie dans la sienne — le secret du service en tête.
//
// Avant : l'erreur de `fetch` remontait telle quelle, et le worker PDF écrivait
// `String(err)` dans jobs_pdf.last_error. Mesuré le 2026-10-13 (Node 22.23.2 et
// 25.9.0) : pour un secret portant un saut de ligne en son milieu, ce texte
// contient le secret entier.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { generatePdf } from '@/lib/pdf/railway-client.js';

// Jamais un vrai secret : deux moitiés reconnaissables, dont aucune ne doit sortir.
const DEBUT = 'FAUX-SECRET-DE-TEST';
const FIN = 'SUITE-DU-FAUX-SECRET';

function sansLeSecret(texte: string): void {
  expect(texte).not.toContain(DEBUT);
  expect(texte).not.toContain(FIN);
}

async function rejetDe(appel: () => Promise<unknown>): Promise<Error> {
  try {
    await appel();
  } catch (err) {
    return err as Error;
  }
  throw new Error("l'appel aurait dû échouer");
}

describe('Client du service PDF — un appel sans réponse ne cite jamais le secret', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('M0.9/erreur_reseau_pdf_vrai_moteur — secret mal formé, vrai `fetch` : l’erreur levée ne porte pas le secret', async () => {
    // Adresse jamais contactée : le port 9 est de ceux que `fetch` refuse d'appeler.
    vi.stubEnv('RAILWAY_PDF_URL', 'http://127.0.0.1:9');
    vi.stubEnv('RAILWAY_PDF_SECRET', `${DEBUT}\n${FIN}`);

    const err = await rejetDe(() => generatePdf('bordereau-zd', {}));

    expect(err.message).toBe(
      'Railway PDF : en-tête de requête refusé (clé ou jeton mal formé)',
    );
    // Ce que le worker PDF écrit dans jobs_pdf.last_error.
    sansLeSecret(String(err));
    sansLeSecret(String(err.stack));
    expect(err.cause).toBeUndefined();
  });

  it('M0.9/erreur_reseau_pdf_message_fabrique — `fetch` rejette avec un message qui cite le secret : il ne ressort pas de l’erreur levée', async () => {
    vi.stubEnv('RAILWAY_PDF_URL', 'http://127.0.0.1:9');
    vi.stubEnv('RAILWAY_PDF_SECRET', 'secret-de-test-bien-forme');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          new TypeError(
            `Headers.append: "${DEBUT}${FIN}" is an invalid header value.`,
          ),
        ),
      ),
    );

    const err = await rejetDe(() => generatePdf('bordereau-zd', {}));

    sansLeSecret(String(err));
    sansLeSecret(String(err.stack));
  });

  it('M0.9/erreur_reseau_pdf_delai — délai dépassé : libellé écrit ici', async () => {
    vi.stubEnv('RAILWAY_PDF_URL', 'http://127.0.0.1:9');
    vi.stubEnv('RAILWAY_PDF_SECRET', 'secret-de-test-bien-forme');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          Object.assign(new Error('The operation was aborted due to timeout'), {
            name: 'TimeoutError',
          }),
        ),
      ),
    );

    const err = await rejetDe(() => generatePdf('bordereau-zd', {}));

    expect(err.message).toBe('Railway PDF : délai dépassé');
  });

  it('M0.9/erreur_reseau_pdf_charge_illisible — charge utile non sérialisable : l’erreur de sérialisation remonte telle quelle, aucun appel', async () => {
    vi.stubEnv('RAILWAY_PDF_URL', 'http://127.0.0.1:9');
    vi.stubEnv('RAILWAY_PDF_SECRET', 'secret-de-test-bien-forme');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const boucle: Record<string, unknown> = {};
    boucle['soi'] = boucle;

    const err = await rejetDe(() => generatePdf('bordereau-zd', boucle));

    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).not.toContain('Railway PDF');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('M0.9/erreur_reseau_pdf_reponse_en_erreur — réponse en erreur du service : inchangé, le statut et le corps restent dans le message', async () => {
    vi.stubEnv('RAILWAY_PDF_URL', 'http://127.0.0.1:9');
    vi.stubEnv('RAILWAY_PDF_SECRET', 'secret-de-test-bien-forme');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('{"ref":"x"}', { status: 500 })),
      ),
    );

    const err = await rejetDe(() => generatePdf('bordereau-zd', {}));

    expect(err.message).toBe('Railway PDF 500: {"ref":"x"}');
  });
});
