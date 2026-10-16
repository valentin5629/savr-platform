/**
 * M1.2 — Formulaire de programmation : mode « admin support » (§06.01 l.15,
 * `admin_savr` = programmation de support, tous périmètres).
 *
 * Régression corrigée : le bouton « Programmer une collecte » du back-office
 * pointait vers /admin/collectes/nouvelle (route inexistante → capturée par
 * [id] → 500 « Erreur serveur »). Il pointe désormais vers /programmer/nouveau,
 * et ce formulaire expose enfin un sélecteur d'organisation cible pour l'admin
 * (agence/gestionnaire l'avaient déjà, l'admin non).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const mockGetSession = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession: mockGetSession } }),
}));

import NouveauProgrammationPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

function makeToken(claims: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;
}

// fetch router : types-evenements + liste traiteurs (le reste n'est pas sollicité
// à l'étape 1). Toute autre URL → 200 [] par défaut (dégradation gracieuse).
function installFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/programmation/types-evenements')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 't1', code: 'cocktail', libelle: 'Cocktail' },
          ]),
      } as Response);
    }
    if (url.includes('/programmation/organisations/traiteurs')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 'org-kaspia',
              nom: 'Kaspia',
              raison_sociale: 'Kaspia SAS',
              siret: null,
            },
          ]),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  mockGetSession.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('M1.2 — programmation formulaire : mode admin support', () => {
  it(
    "admin_savr voit le sélecteur d'organisation cible + les traiteurs",
    async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: { access_token: makeToken({ user_role: 'admin_savr' }) },
        },
      });
      installFetch();

      render(<NouveauProgrammationPage />);

      // Le libellé du sélecteur est spécifique à l'admin (programmation de support).
      expect(
        await screen.findByText(
          'Traiteur (pour le compte de)',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/la collecte sera créée au nom de ce traiteur/i),
      ).toBeInTheDocument();
      // Le traiteur chargé apparaît comme option sélectionnable (Combobox DS :
      // on ouvre la liste, options portées dans document.body).
      fireEvent.click(
        screen.getByRole('combobox', {
          name: /Traiteur \(pour le compte de\)/,
        }),
      );
      await waitFor(
        () =>
          expect(
            screen.getByRole('option', { name: 'Kaspia' }),
          ).toBeInTheDocument(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  // Décision Val 2026-10-16 : sans pack actif, la collecte AG se programme et sera
  // facturée à l'unité — une information, jamais un blocage. En support, le pack
  // est celui du traiteur choisi : tant qu'aucun ne l'est, il est inconnu (avant,
  // l'admin lisait « aucun pack » à tort et la case se décochait).
  it(
    "admin : la case AG reste cochée ; l'information « facturée à l'unité » attend le traiteur choisi",
    async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: { access_token: makeToken({ user_role: 'admin_savr' }) },
        },
      });
      const fetchMock = installFetch();
      const routeur = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/programmation/pack-ag')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ pack_actif: false }),
          } as Response);
        }
        return routeur(input);
      });

      render(<NouveauProgrammationPage />);
      await screen.findByText(
        'Traiteur (pour le compte de)',
        undefined,
        ATTENTE_UI,
      );

      const caseAg = screen.getByRole('checkbox', { name: /Anti-Gaspi/i });
      fireEvent.click(caseAg);
      expect(caseAg).toBeChecked();
      expect(screen.queryByText(/facturée à l.unité/i)).not.toBeInTheDocument();
      const lecturesPack = () =>
        fetchMock.mock.calls
          .map(([u]) => String(u))
          .filter((u) => u.includes('/programmation/pack-ag'));
      expect(lecturesPack()).toEqual([]);

      fireEvent.click(
        screen.getByRole('combobox', {
          name: /Traiteur \(pour le compte de\)/,
        }),
      );
      fireEvent.click(
        await screen.findByRole('option', { name: 'Kaspia' }, ATTENTE_UI),
      );

      expect(
        await screen.findByText(
          "Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité.",
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(caseAg).toBeChecked();
      expect(lecturesPack()).toEqual([
        '/api/v1/programmation/pack-ag?organisation_id=org-kaspia',
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    "admin : l'information suit le pack du traiteur choisi — sans pack, avec crédits, sans crédit",
    async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: { access_token: makeToken({ user_role: 'admin_savr' }) },
        },
      });
      const PACKS: Record<string, object> = {
        'org-kaspia': { pack_actif: false },
        'org-potel': {
          pack_actif: true,
          credits_initiaux: 10,
          credits_restants: 3,
        },
        'org-dalloyau': {
          pack_actif: true,
          credits_initiaux: 10,
          credits_restants: 0,
        },
      };
      const fetchMock = installFetch();
      const routeur = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const json = (corps: unknown) =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve(corps),
          } as Response);
        if (url.includes('/programmation/organisations/traiteurs')) {
          return json([
            { id: 'org-kaspia', nom: 'Kaspia', siret: null },
            { id: 'org-potel', nom: 'Potel', siret: null },
            { id: 'org-dalloyau', nom: 'Dalloyau', siret: null },
          ]);
        }
        if (url.includes('/programmation/pack-ag')) {
          const org = new URL(url, 'http://localhost').searchParams.get(
            'organisation_id',
          );
          return json(PACKS[org ?? ''] ?? { pack_actif: false });
        }
        return routeur(input);
      });
      const INFO =
        "Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité.";
      const choisir = async (nom: string) => {
        fireEvent.click(
          screen.getByRole('combobox', {
            name: /Traiteur \(pour le compte de\)/,
          }),
        );
        fireEvent.click(
          await screen.findByRole('option', { name: nom }, ATTENTE_UI),
        );
      };

      render(<NouveauProgrammationPage />);
      await screen.findByText(
        'Traiteur (pour le compte de)',
        undefined,
        ATTENTE_UI,
      );
      const caseAg = screen.getByRole('checkbox', { name: /Anti-Gaspi/i });
      fireEvent.click(caseAg);

      // Sans pack : l'information exacte.
      await choisir('Kaspia');
      expect(
        await screen.findByText(INFO, undefined, ATTENTE_UI),
      ).toBeInTheDocument();

      // Pack actif avec crédits : relu au changement de traiteur, rien à dire.
      await choisir('Potel');
      await waitFor(
        () => expect(screen.queryByText(INFO)).not.toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(
        fetchMock.mock.calls
          .map(([u]) => String(u))
          .filter((u) => u.includes('/programmation/pack-ag')),
      ).toEqual([
        '/api/v1/programmation/pack-ag?organisation_id=org-kaspia',
        '/api/v1/programmation/pack-ag?organisation_id=org-potel',
      ]);

      // Pack actif sans crédit restant : facturée à l'unité, comme sans pack.
      await choisir('Dalloyau');
      expect(
        await screen.findByText(INFO, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(caseAg).toBeChecked();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'un traiteur (rôle non-programmateur-tiers) ne voit PAS le sélecteur',
    async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            access_token: makeToken({ user_role: 'traiteur_manager' }),
          },
        },
      });
      installFetch();

      render(<NouveauProgrammationPage />);

      // Attendre que le rôle soit lu (le type d'événement est chargé dans tous les cas).
      await screen.findByText(
        "Informations sur l'événement",
        undefined,
        ATTENTE_UI,
      );
      expect(
        screen.queryByText('Traiteur (pour le compte de)'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Traiteur opérant')).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
