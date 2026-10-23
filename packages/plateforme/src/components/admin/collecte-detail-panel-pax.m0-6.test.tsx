/**
 * Fiche collecte Admin, onglet Informations : modification du nombre de pax de
 * la collecte par l'équipe Savr, avec motif (décision Val 2026-10-21 ; §06.06
 * « Actions Admin/Ops », §05 R_pax_collecte).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { CollecteDetailPanel } from './collecte-detail-panel';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

const collecte = (surcharge: Record<string, unknown> = {}) => ({
  id: 'c1',
  type: 'zero_dechet',
  statut: 'programmee',
  statut_tms: 'non_envoye',
  statut_tms_at: null,
  dirty_tms: false,
  date_collecte: '2026-11-10',
  heure_collecte: '22:00:00',
  nb_camions_demande: 1,
  tms_reference: null,
  volume_estime_repas: null,
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
  pax: 80,
  evenements: {
    nom_evenement: 'Gala',
    pax: 80,
    nom_client_organisateur: null,
    organisations: { raison_sociale: 'Traiteur Beta' },
    client_organisateur: null,
    lieux: { nom: 'Pavillon', ville: 'Paris', adresse_acces: '1 rue X' },
    types_evenements: { libelle: 'Cocktail apéritif' },
  },
  collecte_flux: [],
  collecte_tournees: [],
  factures_collectes: [],
  rattachement_pack: null,
  ...surcharge,
});

interface Scenario {
  /** Fiches servies par les GET successifs (la dernière est répétée). */
  fiches: Array<Record<string, unknown>>;
  modification?: { ok: boolean; status: number; corps: unknown };
}

function mockFetch(scenario: Scenario) {
  let lectures = 0;
  const fetchMock = vi.fn(
    (url: string, opts?: { method?: string; body?: string }) => {
      const method = opts?.method ?? 'GET';
      const json = (corps: unknown, ok = true, status = 200) =>
        Promise.resolve({ ok, status, json: async () => corps });
      if (url === '/api/v1/admin/collectes/c1' && method === 'PATCH') {
        const m = scenario.modification ?? { ok: true, status: 200, corps: {} };
        return json(m.corps, m.ok, m.status);
      }
      if (url.startsWith('/api/v1/admin/transporteurs'))
        return json({ data: [] });
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
      if (url.includes('/benchmark')) return json({ data: null });
      const fiche =
        scenario.fiches[Math.min(lectures, scenario.fiches.length - 1)];
      lectures += 1;
      return json(fiche);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const MOTIF = 'Le traiteur a confirmé 650 convives';

async function ouvrirModale(): Promise<HTMLElement> {
  fireEvent.click(
    await screen.findByRole(
      'button',
      { name: 'Modifier le nombre de pax' },
      ATTENTE_UI,
    ),
  );
  return screen.findByRole(
    'dialog',
    { name: 'Modifier le nombre de pax' },
    ATTENTE_UI,
  );
}

describe('M0.6-pax-collecte-modification-admin — fiche collecte Admin : « Modifier » le nombre de pax', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it(
    'pré-remplie avec le pax de la collecte ; « Enregistrer » attend un motif de 10 caractères ; envoie { pax, motif } puis recharge la fiche',
    async () => {
      const fetchMock = mockFetch({
        fiches: [collecte(), collecte({ pax: 650 })],
      });
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);

      const modale = await ouvrirModale();
      const champ = within(modale).getByLabelText(/Nombre de pax/);
      expect(champ).toHaveValue(80);
      // Texte d'aide (décision Val 2026-10-22) : rien n'est envoyé au
      // prestataire pour une collecte terminée ou annulée.
      expect(
        within(modale).getByText(
          /la modification lui est envoyée, sauf pour une collecte réalisée, clôturée ou annulée\./,
        ),
      ).toBeInTheDocument();
      const enregistrer = within(modale).getByRole('button', {
        name: 'Enregistrer',
      });

      fireEvent.change(champ, { target: { value: '650' } });
      fireEvent.change(within(modale).getByLabelText(/Motif/), {
        target: { value: '123456789' },
      });
      expect(enregistrer).toBeDisabled();
      fireEvent.change(within(modale).getByLabelText(/Motif/), {
        target: { value: MOTIF },
      });
      expect(enregistrer).toBeEnabled();
      fireEvent.click(enregistrer);

      await vi.waitFor(
        () =>
          expect(
            screen.queryByRole('dialog', { name: 'Modifier le nombre de pax' }),
          ).toBeNull(),
        ATTENTE_UI,
      );
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/collectes/c1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pax: 650, motif: MOTIF }),
      });
      // Fiche rechargée : en-tête et onglet Informations disent 650.
      expect(
        await screen.findAllByText(/jusqu.à 650/, {}, ATTENTE_UI),
      ).not.toHaveLength(0);
      expect(screen.queryAllByText(/jusqu.à 80/)).toHaveLength(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'pax hors bornes : « Enregistrer » reste désactivé',
    async () => {
      mockFetch({ fiches: [collecte()] });
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      const modale = await ouvrirModale();
      fireEvent.change(within(modale).getByLabelText(/Motif/), {
        target: { value: MOTIF },
      });
      const enregistrer = within(modale).getByRole('button', {
        name: 'Enregistrer',
      });
      for (const valeur of ['0', '100001', '12.5', '']) {
        fireEvent.change(within(modale).getByLabelText(/Nombre de pax/), {
          target: { value: valeur },
        });
        expect(enregistrer, valeur).toBeDisabled();
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'pax inconnu (0, reprise Bubble) : le champ s’ouvre vide',
    async () => {
      mockFetch({ fiches: [collecte({ pax: 0 })] });
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      const modale = await ouvrirModale();
      expect(within(modale).getByLabelText(/Nombre de pax/)).toHaveValue(null);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'refus du serveur : le message s’affiche dans la fenêtre, qui reste ouverte',
    async () => {
      mockFetch({
        fiches: [collecte()],
        modification: {
          ok: false,
          status: 422,
          corps: {
            error:
              'Un motif d’au moins 10 caractères est requis pour modifier le nombre de convives',
          },
        },
      });
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      const modale = await ouvrirModale();
      fireEvent.change(within(modale).getByLabelText(/Nombre de pax/), {
        target: { value: '650' },
      });
      fireEvent.change(within(modale).getByLabelText(/Motif/), {
        target: { value: MOTIF },
      });
      fireEvent.click(
        within(modale).getByRole('button', { name: 'Enregistrer' }),
      );
      expect(
        await within(modale).findByText(
          'Un motif d’au moins 10 caractères est requis pour modifier le nombre de convives',
          {},
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
