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
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

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

// fetch router : types-evenements + liste traiteurs + lieux du traiteur choisi.
// Toute autre URL → 200 [] par défaut (dégradation gracieuse).
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
    if (url.includes('/programmation/lieux')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 'lieu-1',
              nom: 'Musée des Arts Forains',
              adresse_acces: '53 avenue des Terroirs de France',
              code_postal: '75012',
              ville: 'Paris',
              controle_acces_requis_default: false,
            },
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

// Information de l'écran 1, sous le nombre de collectes Anti-Gaspi (refonte du
// formulaire, lot B2) ; chaque carte Anti-Gaspi de l'écran 2 porte la sienne.
const INFO_ECRAN_1 =
  "Pas de pack Anti-Gaspi actif : les collectes Anti-Gaspi seront facturées à l'unité.";
const INFO_CARTE =
  "Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité.";

/** Nombre de collectes Anti-Gaspi demandées (écran 1). */
const nombreAg = () => document.getElementById('nombre-ag') as HTMLInputElement;
const demanderUneAg = () =>
  fireEvent.change(nombreAg(), { target: { value: '1' } });

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
  // l'admin lisait « aucun pack » à tort et la case se décochait). Refonte du
  // formulaire (lot B2) : la case est devenue le nombre de collectes Anti-Gaspi
  // (écran 1), l'information est sous ce nombre puis sur chaque carte AG.
  it(
    "admin : le nombre de collectes AG reste saisi ; l'information « facturée à l'unité » attend le traiteur choisi",
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

      demanderUneAg();
      expect(nombreAg()).toHaveValue(1);
      expect(
        screen.queryByText(/facturées? à l.unité/i),
      ).not.toBeInTheDocument();
      const lecturesPack = () =>
        fetchMock.mock.calls
          .map(([u]) => String(u))
          .filter((u) => u.includes('/programmation/pack-ag'));
      expect(lecturesPack()).toEqual([]);

      const selecteur = screen.getByRole('combobox', {
        name: /Traiteur \(pour le compte de\)/,
      });
      fireEvent.click(selecteur);
      fireEvent.click(
        await screen.findByRole('option', { name: 'Kaspia' }, ATTENTE_UI),
      );
      // Radix rend le focus au sélecteur une tâche plus tard : s'il arrivait
      // pendant que la liste des lieux est ouverte, il la refermerait.
      await waitFor(() => expect(selecteur).toHaveFocus(), ATTENTE_UI);

      expect(
        await screen.findByText(INFO_ECRAN_1, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(nombreAg()).toHaveValue(1);
      expect(lecturesPack()).toEqual([
        '/api/v1/programmation/pack-ag?organisation_id=org-kaspia',
      ]);

      // Écran 2 : la carte Anti-Gaspi porte la même information, sans relire
      // le pack. Les lieux proposés sont ceux du traiteur choisi.
      fireEvent.change(screen.getByLabelText(/^Nom de l'événement/), {
        target: { value: 'Gala' },
      });
      const declencheurLieu = screen
        .getByText('Rechercher un lieu…')
        .closest('button')!;
      fireEvent.click(declencheurLieu);
      fireEvent.click(
        await screen.findByRole(
          'option',
          { name: /Musée des Arts Forains/ },
          ATTENTE_UI,
        ),
      );
      await waitFor(() => expect(declencheurLieu).toHaveFocus(), ATTENTE_UI);
      expect(
        fetchMock.mock.calls
          .map(([u]) => String(u))
          .filter((u) => u.includes('/programmation/lieux'))
          .every((u) => u.includes('organisation_id=org-kaspia')),
      ).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
      const carteAg = await screen.findByTestId(
        'carte-ag-1',
        undefined,
        ATTENTE_UI,
      );
      expect(within(carteAg).getByText(INFO_CARTE)).toBeInTheDocument();
      expect(lecturesPack()).toHaveLength(1);
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
      // Organisations dont la réponse pack a été lue par le formulaire.
      const packsLus: string[] = [];
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
          return Promise.resolve({
            ok: true,
            json: () => {
              packsLus.push(org ?? '');
              return Promise.resolve(PACKS[org ?? ''] ?? { pack_actif: false });
            },
          } as Response);
        }
        return routeur(input);
      });
      const INFO = INFO_ECRAN_1;
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
      demanderUneAg();

      // Sans pack : l'information exacte.
      await choisir('Kaspia');
      expect(
        await screen.findByText(INFO, undefined, ATTENTE_UI),
      ).toBeInTheDocument();

      // Pack actif avec crédits : relu au changement de traiteur, rien à dire.
      // L'état est remis à zéro dès le changement : on attend que la réponse de
      // Potel soit lue PUIS appliquée (une tâche plus loin), sinon l'absence du
      // message serait prouvée avant même d'avoir lu son pack.
      await choisir('Potel');
      await waitFor(() => expect(packsLus).toContain('org-potel'), ATTENTE_UI);
      await act(() => new Promise((fin) => setTimeout(fin, 0)));
      expect(screen.queryByText(INFO)).not.toBeInTheDocument();
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
      expect(nombreAg()).toHaveValue(1);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'admin : une réponse arrivée après coup (traiteur précédent) ou en erreur n’affiche rien',
    async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: { access_token: makeToken({ user_role: 'admin_savr' }) },
        },
      });
      // La réponse de Kaspia (sans pack) est retenue jusqu'à ce qu'on la libère ;
      // celle de Potel (pack avec crédits) part tout de suite ; Dalloyau répond 500.
      let libererKaspia: () => void = () => undefined;
      const lus: string[] = [];
      const fetchMock = installFetch();
      const routeur = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/programmation/organisations/traiteurs')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                { id: 'org-kaspia', nom: 'Kaspia', siret: null },
                { id: 'org-potel', nom: 'Potel', siret: null },
                { id: 'org-dalloyau', nom: 'Dalloyau', siret: null },
              ]),
          } as Response);
        }
        if (url.includes('organisation_id=org-kaspia')) {
          return new Promise<Response>((fin) => {
            libererKaspia = () => {
              lus.push('org-kaspia');
              fin({
                ok: true,
                json: () => Promise.resolve({ pack_actif: false }),
              } as Response);
            };
          });
        }
        if (url.includes('organisation_id=org-potel')) {
          lus.push('org-potel');
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                pack_actif: true,
                credits_initiaux: 10,
                credits_restants: 3,
              }),
          } as Response);
        }
        if (url.includes('organisation_id=org-dalloyau')) {
          lus.push('org-dalloyau');
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'Erreur interne' }),
          } as Response);
        }
        return routeur(input);
      });
      // Toute information « facturée(s) à l'unité », de l'écran 1 comme d'une
      // carte : son absence est prouvée quel que soit le libellé.
      const INFO = /facturées? à l.unité/i;
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
      const laisserPasser = () =>
        act(() => new Promise((fin) => setTimeout(fin, 0)));

      render(<NouveauProgrammationPage />);
      await screen.findByText(
        'Traiteur (pour le compte de)',
        undefined,
        ATTENTE_UI,
      );
      demanderUneAg();

      await choisir('Kaspia');
      await choisir('Potel');
      await waitFor(() => expect(lus).toContain('org-potel'), ATTENTE_UI);
      await laisserPasser();
      // La réponse « sans pack » de Kaspia arrive maintenant : elle est ignorée.
      libererKaspia();
      await laisserPasser();
      expect(lus).toContain('org-kaspia');
      expect(screen.queryByText(INFO)).not.toBeInTheDocument();

      // Réponse en erreur : le pack est inconnu, rien n'est affiché.
      await choisir('Dalloyau');
      await waitFor(() => expect(lus).toContain('org-dalloyau'), ATTENTE_UI);
      await laisserPasser();
      expect(screen.queryByText(INFO)).not.toBeInTheDocument();
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
      const fetchMock = installFetch();

      render(<NouveauProgrammationPage />);

      // Attendre que le rôle soit lu : avec une collecte Anti-Gaspi demandée, le
      // formulaire lit alors le pack de l'appelant (sans organisation cible).
      await screen.findByRole(
        'heading',
        { level: 2, name: "Informations sur l'événement" },
        ATTENTE_UI,
      );
      demanderUneAg();
      await waitFor(
        () =>
          expect(fetchMock.mock.calls.map(([u]) => String(u))).toContain(
            '/api/v1/programmation/pack-ag',
          ),
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
