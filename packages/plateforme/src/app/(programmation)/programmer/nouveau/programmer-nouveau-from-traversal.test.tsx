/**
 * M1.2 — Formulaire de programmation : le paramètre d'URL `?from=` (pré-remplissage
 * « Dupliquer ») ne doit jamais pouvoir SORTIR du chemin `/api/v1/traiteur/collectes/`.
 *
 * Régression fermée (relevé du reviewer rls-securite pendant la revue de #285) :
 * `fetch(`/api/v1/traiteur/collectes/${from}`)` interpolait le paramètre brut.
 * Le préfixe `/api/...` empêche la sortie d'origine, mais `from=../../x` remonte
 * l'arborescence et adresse un AUTRE endpoint same-origin avec la session de
 * l'utilisateur lui-même. `encodeURIComponent(from)` rend le segment inerte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const mockGetSession = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession: mockGetSession } }),
}));

import NouveauProgrammationPage from './page';

const PREFIXE = '/api/v1/traiteur/collectes/';

function makeToken(claims: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;
}

/** Toutes les URL appelées par la page (1er argument de fetch). */
function urlsAppelees(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) =>
    typeof input === 'string' ? input : String(input),
  );
}

/** Rend la page avec `?from=<valeur>` dans l'URL et renvoie le mock fetch. */
async function rendreAvecFrom(valeurBrute: string) {
  window.history.replaceState(
    {},
    '',
    `/programmer/nouveau?from=${valeurBrute}`,
  );
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<NouveauProgrammationPage />);
  // Les effets de montage (types d'événements + pré-remplissage) sont synchrones
  // à l'émission du fetch ; on laisse tourner une micro-tâche par sécurité.
  await Promise.resolve();
  return fetchMock;
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({
    data: {
      session: { access_token: makeToken({ user_role: 'traiteur_manager' }) },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('M1.2 — `?from=` ne s’échappe pas du chemin collectes', () => {
  it('un `from` en ../ reste UN segment sous /api/v1/traiteur/collectes/', async () => {
    // Encodé dans la query (sinon le navigateur normalise `..` avant nous) :
    // la valeur décodée vue par la page est bien « ../../autre-endpoint ».
    const fetchMock = await rendreAvecFrom('..%2F..%2Fautre-endpoint');

    const appels = urlsAppelees(fetchMock);
    const cible = appels.find((u) => u.startsWith(PREFIXE));
    expect(cible).toBeDefined();

    // Oracle : après résolution par le navigateur, le chemin reste sous le
    // préfixe ET ne contient plus qu'un seul segment (pas de remontée).
    const { pathname } = new URL(cible!, 'https://app.gosavr.io');
    expect(pathname.startsWith(PREFIXE)).toBe(true);
    expect(pathname.slice(PREFIXE.length)).not.toContain('/');
    expect(pathname).toBe(`${PREFIXE}..%2F..%2Fautre-endpoint`);

    // Contrôle négatif : aucun appel n'atteint l'endpoint visé par la remontée.
    for (const u of appels) {
      expect(new URL(u, 'https://app.gosavr.io').pathname).not.toBe(
        '/api/v1/autre-endpoint',
      );
    }
  });

  it('un `from` nominal (UUID) donne l’URL attendue, inchangée', async () => {
    const uuid = '3f1c8a2e-0000-4aaa-9bbb-1234567890ab';
    const fetchMock = await rendreAvecFrom(uuid);

    expect(urlsAppelees(fetchMock)).toContain(`${PREFIXE}${uuid}`);
  });
});
