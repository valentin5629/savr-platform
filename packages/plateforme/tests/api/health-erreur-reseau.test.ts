// Sonde de santé publique GET /api/health : quand `fetch` échoue, la ligne de
// journal `health.db_ko` ne porte rien de ce que le moteur recopie dans son
// erreur — la clé de service Supabase en tête.
//
// Avant : `error: err.message`. Le logger masque par NOM de champ (token,
// secret, authorization…), pas par valeur : sous `error`, la clé passait.
// Mesuré le 2026-10-13 (Node 22.23.2 et 25.9.0) : pour une clé portant un saut de
// ligne en son milieu, ce message contient la clé entière.

import { afterEach, describe, expect, it, vi } from 'vitest';

// Jamais une vraie clé : deux moitiés reconnaissables, dont aucune ne doit sortir.
const DEBUT = 'FAUSSE-CLE-DE-TEST';
const FIN = 'SUITE-DE-LA-FAUSSE-CLE';

function sansLaCle(texte: string): void {
  expect(texte).not.toContain(DEBUT);
  expect(texte).not.toContain(FIN);
}

/** La route garde son dernier état en mémoire : un module neuf par test. */
async function appelerLaSonde(): Promise<Response> {
  vi.resetModules();
  const { GET } = await import('@/app/api/health/route.js');
  return GET(new Request('http://localhost/api/health'));
}

describe('Sonde de santé — une base injoignable ne livre jamais la clé de service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('M0.9/erreur_reseau_sante_vrai_moteur — clé de service mal formée, vrai `fetch` : 503 « ko », et la ligne health.db_ko ne porte pas la clé', async () => {
    // Adresse jamais contactée : le port 9 est de ceux que `fetch` refuse d'appeler.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', `${DEBUT}\n${FIN}`);
    const journaux = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = await appelerLaSonde();

    expect(res.status).toBe(503);
    const corps = await res.text();
    expect(JSON.parse(corps)).toEqual({ status: 'ko' });
    sansLaCle(corps);

    const ecrit = journaux.mock.calls.map((c) => String(c[0]));
    const ligne = ecrit.find((l) => l.includes('health.db_ko'));
    expect(ligne).toBeDefined();
    expect(JSON.parse(ligne!).payload).toEqual({
      error: 'en-tête de requête refusé (clé ou jeton mal formé)',
    });
    sansLaCle(ecrit.join('\n'));
  });

  it('M0.9/erreur_reseau_sante_message_fabrique — `fetch` rejette avec un message qui cite la clé : elle ne ressort ni du journal ni de la réponse', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'cle-de-test-bien-formee');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          new TypeError(
            `Headers.append: "Bearer ${DEBUT}${FIN}" is an invalid header value.`,
          ),
        ),
      ),
    );
    const journaux = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = await appelerLaSonde();

    expect(res.status).toBe(503);
    sansLaCle(await res.text());
    const ecrit = journaux.mock.calls.map((c) => String(c[0])).join('\n');
    expect(ecrit).toContain('health.db_ko');
    sansLaCle(ecrit);
  });
});
