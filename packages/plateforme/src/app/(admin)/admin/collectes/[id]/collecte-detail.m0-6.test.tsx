/**
 * M0.6 — Fiche collecte Admin : Bloc 0 dispatch (BL-P1-BOA-06) + modale forçage
 * statut (BL-P1-RM-08). Sélecteur prestataire, fork bouton par type_tms, champ
 * motif override conditionnel, PATCH statut avec motif ≥ 10.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import CollecteDetailPage from './page';

const collecteAg = {
  id: 'c1',
  type: 'anti_gaspi',
  statut: 'programmee',
  statut_tms: 'non_envoye',
  statut_tms_at: null,
  dirty_tms: false,
  date_collecte: '2026-05-10',
  heure_collecte: '19:00:00',
  nb_camions_demande: 1,
  tms_reference: null,
  volume_estime_repas: 12,
  controle_acces_requis: false,
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  packs_antgaspi: null,
  prestataire_logistique_id: 'presta-mts1',
  evenements: {
    nom_evenement: 'Cocktail AG',
    pax: 80,
    organisations: { raison_sociale: 'Traiteur Beta' },
    lieux: { nom: 'Pavillon', ville: 'Paris', adresse_acces: '1 rue X' },
    types_evenements: { libelle: 'Cocktail apéritif' },
  },
  collecte_flux: [],
  // Colonnes DB réelles (BL-P0 fiche corrigée) : tournees.statut (pas statut_tms),
  // factures_collectes → factures.statut (le statut vit sur la facture parente).
  collecte_tournees: [
    {
      rang: 1,
      tournees: {
        id: 'tour-1',
        statut: 'planifiee',
        tms_reference: 'TMS-42',
        external_ref_commande: 'CMD-42',
      },
    },
  ],
  factures_collectes: [
    { id: 'fc-1', montant_ht: 120, factures: { statut: 'emise' } },
  ],
};

const transporteurs = [
  {
    id: 't-mts1',
    nom: 'Strike',
    type_tms: 'mts1',
    prestataire_logistique_id: 'presta-mts1',
    actif: true,
  },
  {
    id: 't-atoutes',
    nom: 'A Toutes!',
    type_tms: 'a_toutes',
    prestataire_logistique_id: 'presta-atoutes',
    actif: true,
  },
];

function mockFetch() {
  const fetchMock = vi.fn(
    (url: string, opts?: { method?: string; body?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.startsWith('/api/v1/admin/transporteurs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: transporteurs }),
        });
      }
      if (url === '/api/v1/admin/collectes/c1' && method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => collecteAg });
      }
      if (url.includes('/dispatch')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, event_type: 'collecte.creee' }),
        });
      }
      // GET collecte
      return Promise.resolve({ ok: true, json: async () => collecteAg });
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('M0.6 — fiche collecte Bloc 0 dispatch + RM-08 (BL-P1-BOA-06 / RM-08)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — Bloc 0 affiche le prestataire actuel + bouton forké MTS-1', async () => {
    mockFetch();
    render(<CollecteDetailPage />);

    expect(await screen.findByText('Prestataire actuel')).toBeInTheDocument();
    // Prestataire résolu via le pont transporteurs.prestataire_logistique_id
    expect(screen.getByText('Strike')).toBeInTheDocument();
    // Fork type_tms=mts1, jamais envoyée (tms_reference null) → « Envoyer à MTS-1 »
    expect(
      screen.getByRole('button', { name: /Envoyer à MTS-1/ }),
    ).toBeInTheDocument();
  });

  it('M0.6 — sélection A Toutes! → bouton forké A Toutes! + motif override obligatoire', async () => {
    mockFetch();
    render(<CollecteDetailPage />);
    await screen.findByText('Prestataire actuel');

    // Sélecteur AG (§06.06 §3) — choisir un prestataire différent
    fireEvent.change(screen.getByLabelText('Prestataire à attribuer'), {
      target: { value: 't-atoutes' },
    });

    // Bouton forké A Toutes!
    expect(
      screen.getByRole('button', { name: /Envoyer à A Toutes!/ }),
    ).toBeInTheDocument();
    // Champ motif override conditionnel apparu
    const motif = screen.getByLabelText(/Motif override/);
    expect(motif).toBeInTheDocument();

    // Bouton d'envoi désactivé tant que le motif override < 5 caractères
    const bouton = screen.getByRole('button', { name: /Envoyer à A Toutes!/ });
    expect(bouton).toBeDisabled();
    fireEvent.change(motif, { target: { value: 'Zone vélo cargo IDF' } });
    expect(bouton).not.toBeDisabled();
  });

  it('M0.6 — modale forçage statut : PATCH exige un motif ≥ 10 caractères', async () => {
    const fetchMock = mockFetch();
    render(<CollecteDetailPage />);
    await screen.findByText('Prestataire actuel');

    // Ouvre la modale (déclencheur d'en-tête)
    fireEvent.click(screen.getByRole('button', { name: /Forcer le statut/ }));

    const dialog = screen
      .getByText('Forcer le statut de la collecte')
      .closest('div') as HTMLElement;
    const confirmer = within(dialog).getByRole('button', {
      name: /Confirmer le forçage/,
    });
    // Motif vide → soumission désactivée
    expect(confirmer).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Nouveau statut'), {
      target: { value: 'validee' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Motif \(obligatoire/), {
      target: { value: 'Validation manuelle après échange traiteur' },
    });
    expect(confirmer).not.toBeDisabled();

    fireEvent.click(confirmer);

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) =>
          c[0] === '/api/v1/admin/collectes/c1' &&
          (c[1] as { method?: string } | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as { body: string }).body) as {
        statut: string;
        motif: string;
      };
      expect(body.statut).toBe('validee');
      expect(body.motif.length).toBeGreaterThanOrEqual(10);
    });
  });

  // Régression BL-P0 : le GET fiche référençait des colonnes DB inexistantes
  // (types_evenements.nom, tournees.statut_tms, factures_collectes.statut) → 400
  // → crash blanc. Ce test rend la fiche avec les shapes DB corrigées.
  it('M0.6 — rend type d’événement (libelle), tournée (statut) et facture (factures.statut)', async () => {
    mockFetch();
    render(<CollecteDetailPage />);
    await screen.findByText('Prestataire actuel');

    // types_evenements.libelle (Bloc 1)
    expect(screen.getByText('Cocktail apéritif')).toBeInTheDocument();
    // tournees.statut (Bloc 0 — liste multi-camions)
    expect(screen.getByText('planifiee')).toBeInTheDocument();
    // factures_collectes → factures.statut (Bloc 6)
    expect(screen.getByText('emise')).toBeInTheDocument();
  });
});
