/**
 * Liste Événements commune à tous les rôles (décision Val 2026-10-29) : une
 * seule implémentation, montée par la page Événements de chaque espace. Ici,
 * seuls les réglages par espace : le reste de la liste est couvert par
 * tests/ui/evenements-gestionnaire.m3-2.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/traiteur/evenements',
}));

import AdminEvenementsPage from '@/app/(admin)/admin/evenements/page.js';
import AgenceEvenementsPage from '@/app/(agence)/agence/evenements/page.js';
import OrganisateurEvenementsPage from '@/app/(client-organisateur)/organisateur/evenements/page.js';
import TraiteurEvenementsPage from '@/app/(traiteur)/traiteur/evenements/page.js';
import GestionnaireEvenementsPage from '@/app/(gestionnaire)/gestionnaire/evenements/page.js';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';

const LIGNE = {
  id: '44444444-4444-4444-8444-444444444444',
  nom_evenement: 'Gala de printemps',
  date_evenement: '2026-11-02',
  pax: 300,
  client_nom: 'Maison X',
  lieu_nom: 'Pavillon',
  lieu_adresse: null,
  traiteur_nom: 'Potel',
  nb_collectes_zd: 1,
  nb_collectes_ag: 0,
  nb_realisees: 0,
  nb_sans_excedent: 0,
  tonnage_zd_kg: null,
  taux_recyclage: null,
  repas_donnes: null,
  co2_evite_kg: null,
  dechets_labo_kg: null,
  statut_consolide: 'À venir',
};

let appels: string[] = [];
beforeEach(() => {
  appels = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      appels.push(url);
      const body = url.includes('/evenements/filtres')
        ? {
            data: {
              lieux: [],
              traiteurs: [],
              clients: [{ id: 'o1', nom: 'Potel' }],
              types: [],
            },
          }
        : { data: [LIGNE], total: 1 };
      // Fiche d'un événement : introuvable ici (seule l'ouverture est testée).
      const fiche = /\/api\/v1\/evenements\/[0-9a-f-]{36}$/.test(url);
      return Promise.resolve({
        ok: !fiche,
        status: fiche ? 404 : 200,
        json: () => Promise.resolve(body),
      } as Response);
    }),
  );
});

async function tableau() {
  return screen.findByTestId('evenements-table', undefined, ATTENTE_UI);
}

afterEach(() => cleanup());

describe('Liste Événements — réglages par espace', () => {
  it(
    'M3.2/liste_evenements_route_commune — chaque espace lit la même route',
    async () => {
      render(<AgenceEvenementsPage />);
      await tableau();
      expect(appels.some((u) => u.startsWith('/api/v1/evenements?'))).toBe(
        true,
      );
      expect(appels).toContain('/api/v1/evenements/filtres');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/liste_evenements_traiteur_sans_colonne_ni_filtre_traiteur',
    async () => {
      render(<TraiteurEvenementsPage />);
      const table = await tableau();
      expect(
        within(table).queryByRole('columnheader', { name: /traiteur/i }),
      ).toBeNull();
      expect(screen.queryByTestId('filtre-traiteur')).toBeNull();
      expect(screen.queryByTestId('filtre-client')).toBeNull();
      // Gestionnaire seul (§05 R_dechets_labo_estimes).
      expect(
        within(table).queryByRole('columnheader', { name: /déchets labo/i }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/liste_evenements_export_csv — « Exporter CSV » à gauche de « Colonnes », pour tous les rôles, sur la période de la vue (Val 2026-10-30)',
    async () => {
      const ouvrir = vi.fn();
      vi.stubGlobal('open', ouvrir);
      for (const Page of [
        TraiteurEvenementsPage,
        AgenceEvenementsPage,
        AdminEvenementsPage,
        OrganisateurEvenementsPage,
        GestionnaireEvenementsPage,
      ]) {
        ouvrir.mockClear();
        render(<Page />);
        await tableau();
        const bouton = screen.getByRole('button', { name: 'Exporter CSV' });
        expect(bouton.nextElementSibling).toBe(
          screen.getByRole('button', { name: /Colonnes/ }),
        );
        fireEvent.click(bouton);
        const cible = String(ouvrir.mock.calls[0]?.[0] ?? '');
        expect(cible.startsWith('/api/v1/exports/evenements?')).toBe(true);
        // Vue « à venir » par défaut : à partir d'aujourd'hui.
        expect(new URLSearchParams(cible.split('?')[1]).get('from')).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        );
        cleanup();
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/liste_evenements_admin_filtre_client',
    async () => {
      render(<AdminEvenementsPage />);
      await tableau();
      expect(screen.getByTestId('filtre-client')).toBeInTheDocument();
      expect(screen.getByTestId('filtre-traiteur')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/liste_evenements_fiche_traiteur_agence — la ligne ouvre la fiche événement, pour tous les rôles (Val 2026-10-29)',
    async () => {
      for (const Page of [
        TraiteurEvenementsPage,
        AgenceEvenementsPage,
        AdminEvenementsPage,
        OrganisateurEvenementsPage,
      ]) {
        const { unmount } = render(<Page />);
        const table = await tableau();
        fireEvent.click(
          within(table).getByRole('row', {
            name: "Ouvrir l'événement Gala de printemps",
          }),
        );
        expect(
          await screen.findByRole('dialog', undefined, ATTENTE_UI),
        ).toBeInTheDocument();
        expect(
          appels.some((u) =>
            u.startsWith(
              '/api/v1/evenements/44444444-4444-4444-8444-444444444444',
            ),
          ),
        ).toBe(true);
        unmount();
        appels = [];
      }
    },
    ATTENTE_CAS_MS,
  );
});
