/**
 * M0.6 — CollecteDetailModal : wrapper pop-up centré (DS Modal) de la fiche
 * collecte. Vérifie la garde Escape imbriquée : la modale externe ET la sous-modale
 * écoutent toutes deux Escape au niveau `document` → sans garde, Escape fermerait
 * les deux. Quand une sous-modale (forçage statut / nb camions / annuler crédit)
 * est ouverte, Escape ne doit PAS fermer la fiche (onClose non appelé) ; c'est la
 * sous-modale qui se ferme. Sans sous-modale, Escape ferme la fiche (onClose appelé).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// next/link (utilisé par le panneau) peut requérir useRouter sous jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { CollecteDetailModal } from './collecte-detail-modal';

// Collecte AG programmée (non terminale) → l'en-tête affiche « Forcer le statut ».
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
  infos_acces_email_envoye_at: null,
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  packs_antgaspi: null,
  attributions_antgaspi: null,
  prestataire_logistique_id: null,
  evenements: {
    nom_evenement: 'Cocktail AG',
    pax: 80,
    organisations: { raison_sociale: 'Traiteur Beta' },
    lieux: { nom: 'Pavillon', ville: 'Paris', adresse_acces: '1 rue X' },
    types_evenements: { libelle: 'Cocktail' },
  },
  collecte_flux: [],
  collecte_tournees: [],
  factures_collectes: [],
};

function mockFetch() {
  const f = vi.fn((url: string) => {
    if (url.startsWith('/api/v1/admin/transporteurs')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    }
    if (url.includes('/recommandation')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) });
    }
    if (url.endsWith('/documents')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          rapport: null,
          bordereau: null,
          attestation: null,
          photos: [],
        }),
      });
    }
    if (url.endsWith('/audit')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [], recredit_at: null }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => collecteAg });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('M0.6 — CollecteDetailModal pop-up + garde Escape (BL-P1-BOA-06)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — collecteId null → panneau non rendu', () => {
    mockFetch();
    render(<CollecteDetailModal collecteId={null} onClose={vi.fn()} />);
    expect(screen.queryByText('Prestataire & Dispatch')).toBeNull();
  });

  it('M0.6 — Escape ferme le panneau quand aucune sous-modale n’est ouverte', async () => {
    mockFetch();
    const onClose = vi.fn();
    render(<CollecteDetailModal collecteId="c1" onClose={onClose} />);
    await screen.findByText('Prestataire & Dispatch');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('M0.6 — Escape NE ferme PAS le panneau si une sous-modale (forçage statut) est ouverte', async () => {
    mockFetch();
    const onClose = vi.fn();
    render(<CollecteDetailModal collecteId="c1" onClose={onClose} />);
    await screen.findByText('Prestataire & Dispatch');

    // Ouvre la sous-modale « Forcer le statut »
    fireEvent.click(screen.getByRole('button', { name: /Forcer le statut/ }));
    await screen.findByText('Forcer le statut de la collecte');

    // Escape : la sous-modale gère sa propre fermeture, le panneau reste ouvert.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Prestataire & Dispatch')).toBeInTheDocument();
  });
});
