/**
 * Fiche collecte Admin, onglet Documents, bloc Facture : « Rattacher au pack »
 * (décision Val 2026-10-16). Une collecte AG programmée sans pack, réalisée ou
 * annulée tardivement, se rattache au pack pris plus tard par le client ; si la
 * facture unitaire est déjà partie chez Pennylane, l'Admin est prévenu qu'il
 * faut émettre un avoir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { CollecteDetailPanel } from './collecte-detail-panel';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

const PACK = {
  id: 'pack-1',
  type_pack: 'pack_10',
  credits_initiaux: 10,
  credits_restants: 3,
};

const collecte = (surcharge: Record<string, unknown> = {}) => ({
  id: 'c1',
  type: 'anti_gaspi',
  statut: 'realisee',
  statut_tms: 'envoye',
  statut_tms_at: null,
  dirty_tms: false,
  date_collecte: '2026-10-10',
  heure_collecte: '19:00:00',
  nb_camions_demande: 1,
  tms_reference: null,
  volume_estime_repas: 12,
  controle_acces_requis: false,
  infos_acces_email_envoye_at: null,
  infos_acces_email: null,
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  packs_antgaspi: null,
  prestataire_logistique_id: null,
  attributions_antgaspi: null,
  evenements: {
    nom_evenement: 'Cocktail AG',
    pax: 80,
    nom_client_organisateur: 'Client Fallback',
    organisations: { raison_sociale: 'Traiteur Beta' },
    client_organisateur: { raison_sociale: 'Org Cliente SA' },
    lieux: { nom: 'Pavillon', ville: 'Paris', adresse_acces: '1 rue X' },
    types_evenements: { libelle: 'Cocktail apéritif' },
  },
  collecte_flux: [],
  collecte_tournees: [],
  factures_collectes: [],
  rattachement_pack: { pack_actif: PACK },
  ...surcharge,
});

interface Scenario {
  /** Fiches servies par les GET successifs (la dernière est répétée). */
  fiches: Array<Record<string, unknown>>;
  rattachement?: { ok: boolean; status?: number; corps: unknown };
}

function mockFetch(scenario: Scenario) {
  let lectures = 0;
  const fetchMock = vi.fn(
    (url: string, opts?: { method?: string; body?: string }) => {
      const method = opts?.method ?? 'GET';
      const json = (corps: unknown, ok = true, status = 200) =>
        Promise.resolve({ ok, status, json: async () => corps });
      if (url.endsWith('/rattacher-pack') && method === 'POST') {
        const r = scenario.rattachement ?? {
          ok: true,
          corps: { ok: true, facture_envoyee: false },
        };
        return json(r.corps, r.ok, r.status ?? (r.ok ? 200 : 409));
      }
      if (url.startsWith('/api/v1/admin/transporteurs')) {
        return json({ data: [] });
      }
      if (url.includes('/recommandation')) {
        return json({
          data: {
            associations: [],
            assoc_count: 0,
            transporteur: null,
            transporteurs: [],
            branche: 'ag_marathon_nuit',
            is_idf: true,
            no_asso: true,
            no_prestataire: true,
            delai_minutes: 600,
            nb_pax: 80,
          },
        });
      }
      if (url.includes('/associations')) return json({ data: [] });
      if (url.endsWith('/documents')) {
        return json({
          rapport: null,
          bordereau: null,
          attestation: null,
          photos: [],
        });
      }
      if (url.endsWith('/audit')) return json({ data: [], recredit_at: null });
      const fiche =
        scenario.fiches[Math.min(lectures, scenario.fiches.length - 1)];
      lectures += 1;
      return json(fiche);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function ouvrirDocuments(): Promise<void> {
  // Radix active un onglet au mousedown (bouton gauche), pas au click.
  fireEvent.mouseDown(
    await screen.findByRole('tab', { name: 'Documents' }, ATTENTE_UI),
    { button: 0 },
  );
}

const boutonRattacher = () =>
  screen.queryByRole('button', { name: 'Rattacher au pack' });

describe('M2.1 / rattacher-pack — fiche collecte Admin : bouton « Rattacher au pack »', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it(
    'rattachable avec pack actif : la modale nomme le pack, la confirmation appelle la route puis recharge la fiche',
    async () => {
      const rattachee = collecte({
        pack_antgaspi_id: 'pack-1',
        packs_antgaspi: {
          id: 'pack-1',
          type_pack: 'pack_10',
          credits_restants: 2,
          statut: 'actif',
        },
        rattachement_pack: null,
      });
      const fetchMock = mockFetch({ fiches: [collecte(), rattachee] });
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirDocuments();

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Rattacher au pack' },
          ATTENTE_UI,
        ),
      );
      const modale = await screen.findByRole('dialog', {}, ATTENTE_UI);
      expect(modale).toHaveTextContent('Pack 10');
      expect(modale).toHaveTextContent('3 crédits restants');
      fireEvent.click(
        within(modale).getByRole('button', { name: 'Rattacher' }),
      );

      // La fiche rechargée n'est plus rattachable : le bouton disparaît.
      await vi.waitFor(() => expect(boutonRattacher()).toBeNull(), ATTENTE_UI);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/collectes/c1/rattacher-pack',
        { method: 'POST' },
      );
      expect(screen.queryByText(/émettez un avoir/i)).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'facture unitaire déjà partie chez Pennylane : avertissement « émettez un avoir »',
    async () => {
      mockFetch({
        fiches: [collecte(), collecte({ rattachement_pack: null })],
        rattachement: {
          ok: true,
          corps: { ok: true, brouillons_retires: 0, facture_envoyee: true },
        },
      });
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirDocuments();

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Rattacher au pack' },
          ATTENTE_UI,
        ),
      );
      const modale = await screen.findByRole('dialog', {}, ATTENTE_UI);
      fireEvent.click(
        within(modale).getByRole('button', { name: 'Rattacher' }),
      );

      expect(
        await screen.findByText(
          'La facture unitaire de cette collecte est déjà partie chez Pennylane : émettez un avoir.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'refus de la route : le message reste dans la modale',
    async () => {
      mockFetch({
        fiches: [collecte()],
        rattachement: {
          ok: false,
          status: 409,
          corps: {
            error: 'Aucun pack Anti-Gaspi actif pour cette organisation',
          },
        },
      });
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirDocuments();

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Rattacher au pack' },
          ATTENTE_UI,
        ),
      );
      const modale = await screen.findByRole('dialog', {}, ATTENTE_UI);
      fireEvent.click(
        within(modale).getByRole('button', { name: 'Rattacher' }),
      );

      expect(
        await within(modale).findByText(
          'Aucun pack Anti-Gaspi actif pour cette organisation',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'rattachable sans pack actif : bouton désactivé et explication',
    async () => {
      mockFetch({
        fiches: [collecte({ rattachement_pack: { pack_actif: null } })],
      });
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirDocuments();

      expect(
        await screen.findByRole(
          'button',
          { name: 'Rattacher au pack' },
          ATTENTE_UI,
        ),
      ).toBeDisabled();
      expect(
        screen.getByText(
          "Aucun pack Anti-Gaspi actif pour ce client : la collecte reste facturée à l'unité.",
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'non rattachable (rattachement_pack null) : aucun bouton',
    async () => {
      mockFetch({ fiches: [collecte({ rattachement_pack: null })] });
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirDocuments();

      await screen.findByText('Aucune facture générée.', undefined, ATTENTE_UI);
      expect(boutonRattacher()).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
