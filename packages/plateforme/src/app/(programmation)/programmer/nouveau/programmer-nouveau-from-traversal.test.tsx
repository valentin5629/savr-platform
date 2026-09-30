/**
 * M1.2 — Formulaire de programmation : le paramètre d'URL `?from=` (pré-remplissage
 * « Dupliquer ») ne doit jamais pouvoir SORTIR du chemin `/api/v1/traiteur/collectes/`.
 *
 * Régression fermée (relevé du reviewer rls-securite pendant la revue de #285) :
 * `fetch(`/api/v1/traiteur/collectes/${from}`)` interpolait le paramètre brut.
 * Le préfixe `/api/...` empêche la sortie d'origine, mais `from=../../x` remonte
 * l'arborescence et adresse un AUTRE endpoint same-origin avec la session de
 * l'utilisateur lui-même. `encodeURIComponent(from)` rend le segment inerte.
 *
 * Même garde côté agence : la liste agence propose aussi « Dupliquer » (§06.11 =
 * §06.04), la collecte source est alors lue sous `/api/v1/agence/collectes/`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const mockGetSession = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession: mockGetSession } }),
}));

import NouveauProgrammationPage from './page';

const PREFIXE = '/api/v1/traiteur/collectes/';
const PREFIXE_AGENCE = '/api/v1/agence/collectes/';

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
async function rendreAvecFrom(valeurBrute: string, role = 'traiteur_manager') {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeToken({ user_role: role }) } },
  });
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
  // Le pré-remplissage attend le rôle (lu dans la session, asynchrone) pour
  // choisir sa route source : on attend l'appel de la collecte source.
  await waitFor(
    () =>
      expect(
        urlsAppelees(fetchMock).some(
          (u) => u.startsWith(PREFIXE) || u.startsWith(PREFIXE_AGENCE),
        ),
      ).toBe(true),
    ATTENTE_UI,
  );
  return fetchMock;
}

beforeEach(() => {
  mockGetSession.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('M1.2 — `?from=` ne s’échappe pas du chemin collectes', () => {
  it(
    'un `from` en ../ reste UN segment sous /api/v1/traiteur/collectes/',
    async () => {
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
    },
    ATTENTE_CAS_MS,
  );

  it(
    'un `from` nominal (UUID) donne l’URL attendue, inchangée',
    async () => {
      const uuid = '3f1c8a2e-0000-4aaa-9bbb-1234567890ab';
      const fetchMock = await rendreAvecFrom(uuid);

      expect(urlsAppelees(fetchMock)).toContain(`${PREFIXE}${uuid}`);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'agence : un `from` en ../ reste UN segment sous /api/v1/agence/collectes/',
    async () => {
      const traversee = await rendreAvecFrom(
        '..%2F..%2Fautre-endpoint',
        'agence',
      );
      const cible = urlsAppelees(traversee).find((u) =>
        u.startsWith(PREFIXE_AGENCE),
      );
      const { pathname } = new URL(cible!, 'https://app.gosavr.io');
      expect(pathname).toBe(`${PREFIXE_AGENCE}..%2F..%2Fautre-endpoint`);
      // Contrôle négatif : aucun appel n'atteint l'endpoint visé par la remontée.
      for (const u of urlsAppelees(traversee)) {
        expect(new URL(u, 'https://app.gosavr.io').pathname).not.toBe(
          '/api/v1/autre-endpoint',
        );
      }
    },
    ATTENTE_CAS_MS,
  );
});
