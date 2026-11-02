/**
 * Écran « Mon pack Anti-Gaspi » (Val 2026-11-02), commun aux 5 rôles clients :
 *  - solde du pack courant, historique des packs (actif, épuisés, annulés) et
 *    collectes rattachées, avec le pack de chacune ;
 *  - une annulation tardive qui a consommé un crédit porte la mention
 *    « Annulée tardivement », sans nombre de repas (§06.05, Val 2026-10-07) ;
 *  - « Demander un renouvellement » pour tout rôle dont l'organisation a un
 *    pack, ouvert à 10 % du pack ou moins (§06.04 Bloc 4 AG) ;
 *  - un chargement en échec affiche une erreur avec « Réessayer », jamais
 *    « aucun pack » (Design System §7, état Error).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  within,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MonPackAg } from '@/components/pack-ag/mon-pack-ag.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

function pack(
  id: string,
  statut: string,
  restants: number,
  date_achat = '2026-01-15',
) {
  return {
    id,
    type_pack: 'pack_10',
    statut,
    credits_initiaux: 10,
    credits_consommes: 10 - restants,
    credits_restants: restants,
    date_achat,
    date_expiration: null,
  };
}

const ACTIF = pack('p-actif', 'actif', 7);

function ligne(id: string, annuleeTardivement: boolean, repas: number) {
  return {
    collecte_id: id,
    pack_id: 'p-actif',
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
  const f = vi.fn(() => reponseOk(data));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Écran Mon pack Anti-Gaspi', () => {
  it(
    'M3.2/pack_ag_ecran_mention_annulee_tardivement — la ligne d’une annulation tardive porte la mention, sans repas ; chaque ligne nomme son pack',
    async () => {
      servir({
        pack_courant: ACTIF,
        packs: [ACTIF],
        collectes: [ligne('realisee', false, 42), ligne('annulee', true, 0)],
      });
      render(<MonPackAg />);

      await screen.findByText(
        'Collectes rattachées au pack',
        undefined,
        ATTENTE_UI,
      );
      // Deuxième tableau de la page : les collectes (le premier liste les packs).
      const table = screen.getAllByRole('table')[1]!;
      const annulee = within(table).getByText('Gala annulee').closest('tr')!;
      expect(within(annulee).getByText('Annulée tardivement')).toBeTruthy();
      expect(within(annulee).queryByText('0')).toBeNull();

      const realisee = within(table).getByText('Gala realisee').closest('tr')!;
      expect(within(realisee).queryByText('Annulée tardivement')).toBeNull();
      expect(within(realisee).getByText('42')).toBeTruthy();
      expect(within(realisee).getByText('Pack 10 du 15/01/2026')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_pack_ag_ecran_historique_packs — solde du pack courant et tous les packs, statut en clair',
    async () => {
      servir({
        pack_courant: ACTIF,
        packs: [
          ACTIF,
          pack('p-epuise', 'epuise', 0, '2025-06-01'),
          pack('p-annule', 'annule', 4, '2025-01-01'),
        ],
        collectes: [],
      });
      render(<MonPackAg />);

      await screen.findByText('Historique des packs', undefined, ATTENTE_UI);
      expect(screen.getByText('crédits restants')).toBeTruthy();
      const historique = screen
        .getByText('Historique des packs')
        .closest('[class*="rounded"]')!;
      const tableau = within(historique as HTMLElement).getByRole('table');
      for (const libelle of ['Actif', 'Épuisé', 'Annulé'])
        expect(within(tableau).getByText(libelle)).toBeTruthy();
      expect(within(tableau).getByText('3 / 10')).toBeTruthy();
      expect(within(tableau).getByText('01/06/2025')).toBeTruthy();
      expect(within(tableau).queryByText('pack_10')).toBeNull();
      expect(
        screen.getByText("Aucune collecte n'a encore utilisé de crédit."),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/pack_ag_ecran_aucun_pack — sans aucun pack : message, ni historique ni bouton',
    async () => {
      servir({ pack_courant: null, packs: [], collectes: [] });
      render(<MonPackAg />);

      expect(
        await screen.findByText(
          "Votre organisation n'a pas de pack Anti-Gaspi.",
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText('Historique des packs')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Demander un renouvellement' }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_pack_ag_ecran_renouvellement_seuil — bouton fermé au-dessus de 10 %, ouvert à 10 % ou moins',
    async () => {
      servir({ pack_courant: ACTIF, packs: [ACTIF], collectes: [] });
      render(<MonPackAg />);
      const ferme = await screen.findByRole(
        'button',
        { name: 'Demander un renouvellement' },
        ATTENTE_UI,
      );
      expect((ferme as HTMLButtonElement).disabled).toBe(true);
      cleanup();

      const bas = pack('p-bas', 'actif', 1);
      const f = servir({ pack_courant: bas, packs: [bas], collectes: [] });
      render(<MonPackAg />);
      const ouvert = await screen.findByRole(
        'button',
        { name: 'Demander un renouvellement' },
        ATTENTE_UI,
      );
      expect((ouvert as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(ouvert);
      await waitFor(
        () =>
          expect(f).toHaveBeenCalledWith(
            '/api/v1/traiteur/pack-ag/renouvellement',
            expect.objectContaining({ method: 'POST' }),
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_pack_ag_ecran_dernier_annule — dernier pack annulé : « aucun pack actif », renouvellement ouvert',
    async () => {
      const annule = pack('p-annule', 'annule', 4);
      servir({ pack_courant: null, packs: [annule], collectes: [] });
      render(<MonPackAg />);

      expect(
        await screen.findByText(
          'Aucun pack Anti-Gaspi actif.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      const bouton = screen.getByRole('button', {
        name: 'Demander un renouvellement',
      }) as HTMLButtonElement;
      expect(bouton.disabled).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/pack_ag_ecran_erreur_chargement — une réponse 500 affiche une erreur et « Réessayer », pas « aucun pack »',
    async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Erreur serveur' }),
        } as Response)
        .mockImplementation(() =>
          reponseOk({ pack_courant: ACTIF, packs: [ACTIF], collectes: [] }),
        );
      vi.stubGlobal('fetch', fetchMock);
      render(<MonPackAg />);

      const alerte = await screen.findByRole('alert', undefined, ATTENTE_UI);
      expect(alerte.textContent).toContain(
        'Impossible de charger votre pack Anti-Gaspi',
      );
      expect(screen.queryByText(/pas de pack Anti-Gaspi/)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(
        await screen.findByText('Historique des packs', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
    ATTENTE_CAS_MS,
  );
});
