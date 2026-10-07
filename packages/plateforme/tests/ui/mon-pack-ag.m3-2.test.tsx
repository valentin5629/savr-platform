/**
 * M3.2 — écran « Mon pack AG » du gestionnaire de lieux (§06.05 l.75, arbitrage
 * Val 2026-10-07) :
 *  - une annulation tardive qui a consommé un crédit est listée avec la mention
 *    « Annulée tardivement », sans nombre de repas ;
 *  - pas de bloc « Historique packs » (« pas d'historique multi-packs ») ;
 *  - un chargement en échec affiche une erreur avec « Réessayer », jamais
 *    « Aucun pack Anti-Gaspi actif » (Design System §7, état Error).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  within,
  fireEvent,
} from '@testing-library/react';
import MonPackAgPage from '@/app/(gestionnaire)/gestionnaire/mon-pack-ag/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const PACK = {
  id: 'pack-1',
  reference: 'pack_10',
  nb_collectes_total: 10,
  nb_collectes_restantes: 7,
  date_debut: '2026-01-15',
  date_fin: null,
  statut: 'actif',
};

function ligne(id: string, annuleeTardivement: boolean, repas: number) {
  return {
    collecte_id: id,
    date_collecte: '2026-06-10',
    annulee_tardivement: annuleeTardivement,
    evenement: `Gala ${id}`,
    lieu: 'Palais des Congrès',
    repas_donnes: repas,
    associations: [],
  };
}

function reponseOk(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data }),
  } as Response);
}

function servir(data: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => reponseOk(data)),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('M3.2 / écran Mon pack AG', () => {
  it(
    'M3.2/pack_ag_ecran_mention_annulee_tardivement — la ligne d’une annulation tardive porte la mention, sans nombre de repas',
    async () => {
      servir({
        pack_actif: PACK,
        historique_consommation: [
          ligne('realisee', false, 42),
          ligne('annulee', true, 0),
        ],
      });
      render(<MonPackAgPage />);

      const table = await screen.findByRole('table', undefined, ATTENTE_UI);
      const annulee = within(table).getByText('Gala annulee').closest('tr')!;
      expect(within(annulee).getByText('Annulée tardivement')).toBeTruthy();
      expect(within(annulee).queryByText('0')).toBeNull();

      const realisee = within(table).getByText('Gala realisee').closest('tr')!;
      expect(within(realisee).queryByText('Annulée tardivement')).toBeNull();
      expect(within(realisee).getByText('42')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/pack_ag_ecran_sans_bloc_historique_packs — aucun historique des packs, même si la réponse en portait un',
    async () => {
      servir({
        pack_actif: PACK,
        // Ancienne forme de la réponse : l'écran ne doit plus rien en faire.
        historique_packs: [PACK, { ...PACK, id: 'pack-0', statut: 'epuise' }],
        historique_consommation: [ligne('realisee', false, 42)],
      });
      render(<MonPackAgPage />);

      await screen.findByRole('table', undefined, ATTENTE_UI);
      expect(screen.getByText('Pack actif')).toBeTruthy();
      expect(screen.queryByText('Historique packs')).toBeNull();
      expect(screen.getAllByRole('table')).toHaveLength(1);
      // Type et dates du pack en clair, plus la valeur technique ni la date ISO.
      expect(screen.getByText('Pack 10')).toBeTruthy();
      expect(screen.queryByText('pack_10')).toBeNull();
      expect(screen.getByText('15/01/2026')).toBeTruthy();
      expect(screen.queryByText('2026-01-15')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/pack_ag_ecran_erreur_chargement — une réponse 500 affiche une erreur et « Réessayer », pas « Aucun pack »',
    async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Erreur serveur' }),
        } as Response)
        .mockImplementation(() =>
          reponseOk({ pack_actif: PACK, historique_consommation: [] }),
        );
      vi.stubGlobal('fetch', fetchMock);
      render(<MonPackAgPage />);

      const alerte = await screen.findByRole('alert', undefined, ATTENTE_UI);
      expect(alerte.textContent).toContain(
        'Impossible de charger votre pack Anti-Gaspi',
      );
      expect(screen.queryByText(/Aucun pack Anti-Gaspi actif/)).toBeNull();

      // « Réessayer » relance le chargement et rend l'écran normal.
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(
        await screen.findByText('Pack actif', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/pack_ag_ecran_aucun_pack — une réponse normale sans pack garde le message « Aucun pack Anti-Gaspi actif »',
    async () => {
      servir({ pack_actif: null, historique_consommation: [] });
      render(<MonPackAgPage />);

      expect(
        await screen.findByText(
          /Aucun pack Anti-Gaspi actif/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
