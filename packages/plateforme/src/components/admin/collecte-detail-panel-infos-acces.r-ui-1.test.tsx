/**
 * R-UI-1 H1 — Fiche collecte Admin : le succès de l'enregistrement des infos
 * d'accès (contrôle d'accès, saisie chauffeur par tournée) est un toast
 * `success` dont le texte dépend de `email_envoye` dans la réponse du PATCH.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { CollecteDetailPanel } from './collecte-detail-panel';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

// Fixture alignée sur collecte-detail-panel.m0-6.test.tsx, avec un lieu à
// contrôle d'accès et une tournée dispatchée (bouton « Éditer les infos »).
const collecteControleAcces = {
  id: 'c1',
  type: 'anti_gaspi',
  statut: 'programmee',
  statut_tms: 'envoye',
  statut_tms_at: null,
  dirty_tms: false,
  date_collecte: '2026-05-10',
  heure_collecte: '19:00:00',
  nb_camions_demande: 1,
  tms_reference: null,
  volume_estime_repas: 12,
  controle_acces_requis: true,
  infos_acces_email_envoye_at: null,
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  packs_antgaspi: null,
  prestataire_logistique_id: null,
  attributions_antgaspi: {
    id: 'attr-1',
    mode_validation: 'manuel_top1',
    valide_at: null,
    volume_repas_realise: null,
    associations: { nom: 'Les Restos du Cœur' },
    transporteurs: null,
  },
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
  collecte_tournees: [
    {
      rang: 1,
      tournees: {
        id: 'tour-1',
        statut: 'planifiee',
        tms_reference: 'TMS-42',
        external_ref_commande: 'CMD-42',
        plaque_immatriculation: 'AB-123-CD',
        chauffeur_nom: 'Jean Martin',
        chauffeur_telephone: '0600000000',
        accompagnant_nom: null,
        accompagnant_telephone: null,
      },
    },
  ],
  factures_collectes: [],
};

function mockFetch(emailEnvoye: boolean) {
  const fetchMock = vi.fn(
    (url: string, opts?: { method?: string; body?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.endsWith('/infos-acces') && method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ email_envoye: emailEnvoye }),
        });
      }
      if (url.startsWith('/api/v1/admin/transporteurs')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }
      if (url.includes('/recommandation')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
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
          }),
        });
      }
      if (url.includes('/associations')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
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
      // GET collecte (chargement initial + rechargement après enregistrement)
      return Promise.resolve({
        ok: true,
        json: async () => collecteControleAcces,
      });
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function enregistrerInfosAcces(): Promise<void> {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Éditer les infos' }, ATTENTE_UI),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Enregistrer' }, ATTENTE_UI),
  );
}

describe('R-UI-1 — toast de succès des infos d’accès (fiche collecte Admin)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it(
    'email envoyé → toast « Infos enregistrées — email récapitulatif envoyé au programmateur. »',
    async () => {
      const fetchMock = mockFetch(true);
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      await enregistrerInfosAcces();

      expect(
        await screen.findByText(
          'Infos enregistrées — email récapitulatif envoyé au programmateur.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('Infos enregistrées.')).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/collectes/c1/infos-acces',
        expect.objectContaining({ method: 'PATCH' }),
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'email non envoyé → toast « Infos enregistrées. »',
    async () => {
      mockFetch(false);
      renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
      await enregistrerInfosAcces();

      expect(
        await screen.findByText('Infos enregistrées.', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          'Infos enregistrées — email récapitulatif envoyé au programmateur.',
        ),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
