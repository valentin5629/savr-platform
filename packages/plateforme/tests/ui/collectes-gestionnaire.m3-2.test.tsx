/**
 * M3.2 — Liste Collectes gestionnaire de lieux (§06.05 nav 4, liste plate).
 *
 * Revue d'écran E2E 2026-09-22 : l'écran rendait un `<table>` écrit à la main,
 * « Chargement… » en texte et « Aucune collecte sur vos lieux » en `<p>` — et
 * SURTOUT aucun état d'erreur. La réponse était lue sans regarder le code HTTP
 * (`j.data ?? []`), donc une route en 500 affichait le message de liste vide :
 * une panne serveur se lisait comme un parc sans collecte.
 *
 * La sonde `erreur_perimee` couvre une régression trouvée par reviewer-principal
 * sur ce lot : l'échec d'une requête PÉRIMÉE épinglait l'écran sur l'erreur alors
 * que la requête fraîche avait réussi (la branche `erreur` l'emporte sur le
 * contenu). Elle couvre du même coup la course de réponses préexistante.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from '@testing-library/react';

const { push, urlParams } = vi.hoisted(() => ({
  push: vi.fn(),
  urlParams: { current: '' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(urlParams.current),
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
  },
  {
    id: 'c2',
    type: 'anti_gaspi',
    statut: 'programmee',
    date_collecte: '2026-11-10',
    evenement_nom: 'Fleurdemets — 2026-11-10',
    lieu_nom: 'Palais des Congrès de Paris',
  },
  // La route rend `nom_evenement` et le nom du lieu embarqué nullables, et
  // `date_collecte` l'est aussi : les 3 cellules doivent tomber sur « — ».
  {
    id: 'c3',
    type: 'zero_dechet',
    statut: 'cloturee',
    date_collecte: null,
    evenement_nom: null,
    lieu_nom: null,
  },
];

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  cleanup();
  push.mockClear();
  urlParams.current = '';
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
      expect(
        await screen.findByRole(
          'heading',
          { level: 1, name: 'Collectes' },
          ATTENTE_UI,
        ),
      ).toBeTruthy();

      // DataTable (§10 §6) : role="grid", en-têtes, lignes rendues.
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

      // Ligne aux champs nuls : date, lieu et événement tombent sur « — »
      // (3 cellules ; DataTable rend chaque ligne en tableau ET en card).
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_ligne_ouvre_la_fiche',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: LIGNES }))),
      );
      render(<CollectesPage />);

      // §06.05 l.70 : « liste des collectes … → détail collecte ». Le câblage est
      // délégué à DataTable depuis ce lot : sans cette sonde, un onRowClick perdu
      // ne se verrait plus.
      const cellule = (
        await screen.findAllByText(
          'Paris Expo Porte de Versailles',
          {},
          ATTENTE_UI,
        )
      )[0];
      fireEvent.click(cellule!);
      expect(push).toHaveBeenCalledWith('/gestionnaire/collectes/c1');
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
    'M3.2/collectes_erreur_perimee_ninvalide_pas_la_reponse_fraiche',
    async () => {
      // Scénario réel : une requête filtrée est en vol, l'utilisateur retire le
      // filtre (✕ du chip) → 2e requête. La 1re, PÉRIMÉE, échoue APRÈS que la 2e
      // a réussi. Sans garde de péremption, son `setErreur` écrase le succès et
      // épingle l'écran sur l'erreur, données fraîches invisibles.
      let echouerLaPerimee: (() => void) | null = null;
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((_, rej) => {
              echouerLaPerimee = () => rej(new Error('réseau'));
            }),
        )
        .mockResolvedValue(reponse(200, { data: LIGNES }));
      vi.stubGlobal('fetch', fetchMock);

      urlParams.current = 'lieu=L1';
      const { rerender } = render(<CollectesPage />);
      await screen.findByTestId('collectes-skeleton', {}, ATTENTE_UI);

      // Le filtre tombe → 2e requête, qui aboutit.
      urlParams.current = '';
      rerender(<CollectesPage />);
      expect(
        (
          await screen.findAllByText(
            'Palais des Congrès de Paris',
            {},
            ATTENTE_UI,
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Seulement MAINTENANT, la requête périmée échoue.
      await act(async () => {
        echouerLaPerimee?.();
      });

      expect(screen.queryByTestId('collectes-erreur')).toBeNull();
      expect(
        screen.queryByText('Le chargement des collectes a échoué.'),
      ).toBeNull();
      expect(screen.getByRole('grid')).toBeTruthy();
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
      // Liste vide ≠ panne : pas de message d'erreur.
      expect(screen.queryByTestId('collectes-erreur')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
