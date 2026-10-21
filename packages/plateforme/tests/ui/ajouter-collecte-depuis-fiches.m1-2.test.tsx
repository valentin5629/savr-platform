/**
 * M1.2 — « Ajouter une collecte » à un événement existant depuis les fiches
 * (§06.01 « Ajouter une collecte à un événement existant », décisions Val
 * 2026-10-21) : fiche événement du gestionnaire de lieux, fiche collecte des
 * espaces qui programment (traiteur, agence, gestionnaire) et fiche collecte
 * de l'Admin. Toutes mènent à la même page d'ajout.
 *
 * Sondes de RENDU : le droit est calculé par le serveur (tests d'API) ; on
 * vérifie ici que l'écran le suit, bouton visible ou absent, lien exact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal.js';
import { FicheEvenementModal } from '@/components/gestionnaire/fiche-evenement-modal';
import { CollecteDetailPanel } from '@/components/admin/collecte-detail-panel';
import type { EspaceClient } from '@/lib/collectes/fiche-client-types';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import {
  ficheClient,
  stubFetchFiche,
} from '@/test-utils/fiche-collecte-client';

const LIBELLE_FICHE_COLLECTE = 'Ajouter une collecte à cet événement';

function reponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Fiche collecte des espaces clients ──────────────────────────────────────

const ficheCollecte = (espace: EspaceClient) => (
  <FicheCollecteClientModal
    espace={espace}
    collecteId="c1"
    onClose={() => {}}
  />
);

describe('M1.2 — ajouter une collecte depuis la fiche collecte (espaces clients)', () => {
  it.each(['traiteur', 'agence', 'gestionnaire'] as const)(
    'M1.2/ajout_collecte_fiche_collecte_lien — %s : lien vers la page d’ajout de l’événement',
    async (espace) => {
      stubFetchFiche(
        ficheClient({
          actions: {
            modifier: 'actif',
            annuler: 'actif',
            annulation: 'demande',
            ajouter_collecte: true,
          },
        }),
      );
      render(ficheCollecte(espace));
      const lien = await screen.findByRole(
        'link',
        { name: LIBELLE_FICHE_COLLECTE },
        ATTENTE_UI,
      );
      expect(lien).toHaveAttribute('href', '/programmer/e1/ajouter-collecte');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/ajout_collecte_fiche_collecte_terminee — collecte clôturée, sans autre action : le pied ne garde que l’ajout',
    async () => {
      stubFetchFiche(
        ficheClient({
          statut: 'cloturee',
          actions: {
            modifier: 'absent',
            annuler: 'absent',
            annulation: null,
            ajouter_collecte: true,
          },
        }),
      );
      render(ficheCollecte('traiteur'));
      expect(
        await screen.findByTestId('action-ajouter-collecte', {}, ATTENTE_UI),
      ).toHaveAttribute('href', '/programmer/e1/ajouter-collecte');
      expect(screen.queryByTestId('action-modifier')).toBeNull();
      expect(screen.queryByTestId('action-annuler')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/ajout_collecte_fiche_collecte_sans_droit — événement d’une autre organisation : aucun lien',
    async () => {
      stubFetchFiche(
        ficheClient({
          actions: {
            modifier: 'absent',
            annuler: 'absent',
            annulation: null,
            ajouter_collecte: false,
          },
        }),
      );
      render(ficheCollecte('gestionnaire'));
      await screen.findByTestId('fiche-sous-ligne', {}, ATTENTE_UI);
      expect(screen.queryByTestId('action-ajouter-collecte')).toBeNull();
      expect(screen.queryByText(LIBELLE_FICHE_COLLECTE)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

// ── Fiche événement du gestionnaire de lieux ────────────────────────────────

const EVT_ID = '22222222-2222-4222-8222-222222222222';

function evenement(ajouterCollecte: boolean) {
  return {
    id: EVT_ID,
    nom_evenement: 'OVH',
    date_evenement: '2026-10-22',
    pax: 600,
    taille_bracket: 'M',
    type_evenement: null,
    client_nom: null,
    lieu_nom: 'CNIT Forest',
    lieu_adresse: null,
    traiteur: { id: 'T1', nom: 'Fleurdemets', a_logo: false },
    dechets_labo_kg: null,
    ajouter_collecte: ajouterCollecte,
    bilan: {
      nb_collectes_zd: 1,
      nb_collectes_ag: 0,
      nb_realisees_zd: 1,
      nb_realisees_ag: 0,
      nb_sans_excedent: 0,
      tonnage_zd_kg: 100,
      flux_kg: {
        biodechet: 100,
        emballage: 0,
        carton: 0,
        verre: 0,
        dechet_residuel: 0,
      },
      taux_recyclage: 80,
      co2_evite_zd_kg: 10,
      repas_donnes: null,
      co2_evite_ag_kg: null,
      associations: [],
      premiere_collecte: '2026-10-22',
      derniere_collecte: '2026-10-22',
      statut_consolide: 'Terminé',
    },
    collectes: [
      {
        id: 'c1',
        type: 'zero_dechet',
        statut: 'cloturee',
        date_collecte: '2026-10-22',
        heure_collecte: '23:00:00',
        poids_total_kg: 100,
        taux_recyclage: 80,
        co2_evite_kg: 10,
        nb_repas_donnes: null,
      },
    ],
  };
}

const ficheEvenement = () => (
  <FicheEvenementModal evenementId={EVT_ID} onClose={() => {}} />
);

describe('M1.2 — ajouter une collecte depuis la fiche événement du gestionnaire', () => {
  it(
    'M1.2/ajout_collecte_fiche_evenement_lien — événement programmé par le gestionnaire, collectes terminées : lien vers la page d’ajout',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse({ data: evenement(true) }))),
      );
      render(ficheEvenement());
      const lien = await screen.findByRole(
        'link',
        { name: 'Ajouter une collecte' },
        ATTENTE_UI,
      );
      expect(lien).toHaveAttribute(
        'href',
        `/programmer/${EVT_ID}/ajouter-collecte`,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/ajout_collecte_fiche_evenement_traiteur_tiers — événement d’un traiteur tiers sur ses lieux : aucun lien',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse({ data: evenement(false) }))),
      );
      render(ficheEvenement());
      await screen.findByTestId('bilan-consolide', {}, ATTENTE_UI);
      expect(screen.queryByTestId('action-ajouter-collecte')).toBeNull();
      expect(
        screen.queryByRole('link', { name: 'Ajouter une collecte' }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

// ── Fiche collecte de l'Admin (programmation de support) ────────────────────

const COLLECTE_ADMIN = {
  id: 'c9',
  evenement_id: 'evt-admin',
  type: 'zero_dechet',
  statut: 'cloturee',
  statut_tms: 'termine',
  statut_tms_at: null,
  dirty_tms: false,
  date_collecte: '2026-09-10',
  heure_collecte: '22:00:00',
  nb_camions_demande: 1,
  tms_reference: null,
  volume_estime_repas: null,
  controle_acces_requis: false,
  infos_acces_email_envoye_at: null,
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  packs_antgaspi: null,
  prestataire_logistique_id: null,
  attributions_antgaspi: null,
  evenements: {
    nom_evenement: 'Gala',
    pax: 200,
    nom_client_organisateur: null,
    organisations: { raison_sociale: 'Traiteur Beta' },
    client_organisateur: null,
    lieux: { nom: 'Pavillon', ville: 'Paris', adresse_acces: '1 rue X' },
    types_evenements: null,
  },
  collecte_flux: [],
  collecte_tournees: [],
  factures_collectes: [],
};

function stubFetchAdmin(collecte: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/documents'))
        return Promise.resolve(
          reponse({
            rapport: null,
            bordereau: null,
            attestation: null,
            photos: [],
          }),
        );
      if (url.endsWith('/audit'))
        return Promise.resolve(reponse({ data: [], recredit_at: null }));
      if (url === `/api/v1/admin/collectes/${String(collecte.id)}`)
        return Promise.resolve(reponse(collecte));
      return Promise.resolve(reponse({ data: [] }));
    }),
  );
}

describe('M1.2 — ajouter une collecte depuis la fiche collecte de l’Admin', () => {
  it(
    'M1.2/ajout_collecte_fiche_admin_brouillon — collecte en brouillon : pas de lien, l’événement n’est pas confirmé',
    async () => {
      stubFetchAdmin({ ...COLLECTE_ADMIN, statut: 'brouillon' });
      render(<CollecteDetailPanel collecteId="c9" />);
      // Le pied est rendu (« Forcer le statut ») : seule l'action d'ajout manque.
      await screen.findByRole(
        'button',
        { name: /Forcer le statut/ },
        ATTENTE_UI,
      );
      expect(screen.queryByTestId('action-ajouter-collecte')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/ajout_collecte_fiche_admin_lien — collecte clôturée : lien vers la page d’ajout de son événement',
    async () => {
      stubFetchAdmin(COLLECTE_ADMIN);
      render(<CollecteDetailPanel collecteId="c9" />);
      const lien = await screen.findByRole(
        'link',
        { name: LIBELLE_FICHE_COLLECTE },
        ATTENTE_UI,
      );
      expect(lien).toHaveAttribute(
        'href',
        '/programmer/evt-admin/ajouter-collecte',
      );
    },
    ATTENTE_CAS_MS,
  );
});
