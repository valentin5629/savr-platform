/**
 * M3.2 — Liste Collectes gestionnaire de lieux (§06.05 nav 4, liste plate).
 *
 * Revue d'écran E2E 2026-09-22 : l'écran rendait un `<table>` écrit à la main,
 * « Chargement… » en texte et « Aucune collecte sur vos lieux » en `<p>` — et
 * SURTOUT aucun état d'erreur. La réponse était lue sans regarder le code HTTP
 * (`j.data ?? []`), donc une route en 500 affichait le message de liste vide :
 * une panne serveur se lisait comme un parc sans collecte. Ces sondes fixent
 * les trois états du §10 §7 comme distincts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire/collectes',
}));

import CollectesPage from '@/app/(gestionnaire)/gestionnaire/collectes/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const LIGNES = [
  {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'validee',
    date_collecte: '2026-11-30',
    evenement_nom: 'Kaspia — 2026-11-30',
    lieu_nom: 'Paris Expo Porte de Versailles',
    statut_consolide: null,
  },
  {
    id: 'c2',
    type: 'anti_gaspi',
    statut: 'programmee',
    date_collecte: '2026-11-10',
    evenement_nom: 'Fleurdemets — 2026-11-10',
    lieu_nom: 'Palais des Congrès de Paris',
    statut_consolide: null,
  },
];

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('M3.2 / liste Collectes gestionnaire', () => {
  it(
    'M3.2/collectes_liste_rendue_au_design_system',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: LIGNES }))),
      );
      render(<CollectesPage />);

      // PageHero (§10 §5.6 + levier #2) : le titre de l'écran est le <h1>.
      const titre = await screen.findByRole(
        'heading',
        { level: 1, name: 'Collectes' },
        ATTENTE_UI,
      );
      expect(titre).toBeTruthy();

      // DataTable (§10 §6) : role="grid", en-têtes de colonnes, lignes rendues.
      expect(screen.getByRole('grid')).toBeTruthy();
      for (const entete of ['Date', 'Lieu', 'Événement', 'Type', 'Statut']) {
        expect(
          screen.getAllByRole('columnheader', { name: entete }).length,
        ).toBeGreaterThan(0);
      }
      expect(
        screen.getAllByText('Paris Expo Porte de Versailles').length,
      ).toBeGreaterThan(0);
      expect(screen.getAllByText('ZD').length).toBeGreaterThan(0);
      expect(screen.getAllByText('AG').length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_erreur_chargement_message_et_reessayer',
    async () => {
      // 1er appel en panne, 2e (après « Réessayer ») nominal.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(reponse(500, { error: 'boom' }))
        .mockResolvedValue(reponse(200, { data: LIGNES }));
      vi.stubGlobal('fetch', fetchMock);
      render(<CollectesPage />);

      expect(
        await screen.findByTestId('collectes-erreur', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(
        screen.getByText('Le chargement des collectes a échoué.'),
      ).toBeTruthy();

      // L'oracle de la régression : une panne ne se lit JAMAIS comme une liste
      // vide. Avant ce lot, l'écran affichait « Aucune collecte sur vos lieux ».
      expect(screen.queryByText(/Aucune collecte/)).toBeNull();
      expect(screen.queryByRole('grid')).toBeNull();

      // « Réessayer » relance réellement la requête et rend les lignes.
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      // findAllBy* : DataTable rend chaque ligne DEUX fois (tableau desktop +
      // card mobile, §10 §8) — une attente au singulier échouerait sur
      // « found multiple elements », pas sur l'absence de la donnée.
      expect(
        (
          await screen.findAllByText(
            'Palais des Congrès de Paris',
            {},
            ATTENTE_UI,
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId('collectes-erreur')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_etat_chargement_skeleton',
    async () => {
      // Requête jamais résolue : l'écran reste dans son état Loading.
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => {})),
      );
      render(<CollectesPage />);

      // §10 §7 : « Skeleton screens […] jamais spinner seul ». Le texte
      // « Chargement… » que rendait l'écran d'avant ne doit plus apparaître.
      expect(
        await screen.findByTestId('collectes-skeleton', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByText('Chargement…')).toBeNull();
      expect(screen.queryByRole('grid')).toBeNull();
      expect(screen.queryByText(/Aucune collecte/)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_liste_vide_empty_state',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: [] }))),
      );
      render(<CollectesPage />);

      expect(
        await screen.findByText('Aucune collecte', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(
        screen.getByText('Aucune collecte sur vos lieux pour ce périmètre.'),
      ).toBeTruthy();
      // Liste vide ≠ panne : aucun message d'erreur, aucun tableau.
      expect(screen.queryByTestId('collectes-erreur')).toBeNull();
      expect(screen.queryByRole('grid')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
