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

// Le panel reçoit l'id par prop (collecteId) → il n'appelle plus useParams.
// On garde useRouter : next/link (utilisé dans le panel) peut le requérir sous jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { CollecteDetailPanel } from './collecte-detail-panel';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

// Fiche en 4 onglets (Informations / Logistique / Documents / Historique) : seul
// l'onglet actif est monté. Radix active un onglet au mousedown (bouton gauche).
async function ouvrirOnglet(nom: string): Promise<void> {
  fireEvent.mouseDown(
    await screen.findByRole('tab', { name: nom }, ATTENTE_UI),
    { button: 0 },
  );
}

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
  // Collecte AG non encore attribuée (comme sur le preview réel).
  prestataire_logistique_id: null,
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
      // Recommandation algo (top-1 = Strike / t-mts1) — Bloc 0 pré-sélectionne le
      // top-1 et n'exige un motif override que si le choix ≠ top-1.
      if (url.includes('/recommandation')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              associations: [{ id: 'a1', nom: 'Les Restos du Cœur' }],
              transporteur: { id: 't-mts1', nom: 'Strike', type_tms: 'mts1' },
              no_asso: false,
              no_prestataire: false,
            },
          }),
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
      // Bloc 3 Documents / Bloc 7 Audit (BOA-07) — shapes vides pour ces tests Bloc 0.
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

  it(
    'M0.6 — Bloc 0 affiche la reco algo (prestataire + association) + pré-sélectionne le top-1',
    async () => {
      mockFetch();
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      // Recommandation algo (§06.09) : association top-1 en carte « Recommandé ».
      expect(
        (
          await screen.findAllByText(
            'Les Restos du Cœur',
            undefined,
            ATTENTE_UI,
          )
        ).length,
      ).toBeGreaterThan(0);
      // Prestataire top-1 = carte cochée et marquée « Recommandé » (décision Val C3).
      const carteStrike = await screen.findByRole(
        'radio',
        { name: /Strike/ },
        ATTENTE_UI,
      );
      expect(carteStrike).toHaveAttribute('aria-checked', 'true');
      expect(within(carteStrike).getByText('Recommandé')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /A Toutes!/ })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      // Collecte non attribuée
      expect(
        screen.getByText('Aucun prestataire attribué'),
      ).toBeInTheDocument();

      // Pré-sélection du top-1 recommandé → bouton « Envoyer à MTS-1 », et AUCUN
      // motif override requis (on valide la reco).
      expect(
        await screen.findByRole(
          'button',
          { name: /Envoyer à MTS-1/ },
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/Motif override/)).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — choix ≠ top-1 algo → bouton A Toutes! + motif override obligatoire (≥ 5)',
    async () => {
      mockFetch();
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      // Attendre la pré-sélection du top-1 (bouton MTS-1)
      await screen.findByRole(
        'button',
        { name: /Envoyer à MTS-1/ },
        ATTENTE_UI,
      );

      // Choisir A Toutes! (≠ top-1 Strike) → override → motif obligatoire.
      fireEvent.click(screen.getByRole('radio', { name: /A Toutes!/ }));

      const bouton = screen.getByRole('button', {
        name: /Envoyer à A Toutes!/,
      });
      const motif = screen.getByLabelText(/Motif override/);
      expect(motif).toBeInTheDocument();
      expect(bouton).toBeDisabled();
      fireEvent.change(motif, { target: { value: 'Zone vélo cargo IDF' } });
      expect(bouton).not.toBeDisabled();

      // Re-sélection du top-1 recommandé → plus de motif requis (validation reco)
      fireEvent.click(screen.getByRole('radio', { name: /Strike/ }));
      expect(screen.queryByLabelText(/Motif override/)).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte non attribuée : un transporteur sans pont prestataire (NULL) n’est pas pris pour l’« actuel »',
    async () => {
      // Régression E2E 2026-09-29 : NULL === NULL faisait afficher « Presta sans
      // code » comme prestataire actuel d'une collecte jamais attribuée.
      const fetchMock = mockFetch() as unknown as ReturnType<typeof vi.fn>;
      const base = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(
        (url: string, opts?: { method?: string; body?: string }) => {
          if (url.startsWith('/api/v1/admin/transporteurs')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: [
                  ...transporteurs,
                  {
                    id: 't-sans-pont',
                    nom: 'Presta sans code',
                    type_tms: 'mts1',
                    prestataire_logistique_id: null,
                    actif: true,
                  },
                ],
              }),
            });
          }
          return base(url, opts);
        },
      );
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      expect(
        await screen.findByText(
          'Aucun prestataire attribué',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole(
          'radio',
          { name: /Presta sans code/ },
          ATTENTE_UI,
        ),
      ).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryByText('Actuel')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Prestataire actuel (§06.06 §3 Bloc 0 : « depuis collectes.prestataire_logistique_id »).
  // La fiche le cherchait dans la liste des transporteurs ACTIFS, chargée à part :
  // transporteur désactivé depuis, liste absente ou en échec → « non attribué »
  // sur une collecte attribuée, de quoi pousser un Ops à la ré-attribuer.
  // ──────────────────────────────────────────────────────────────────────────

  // Remplace la collecte servie et, au besoin, la réponse de la liste des transporteurs.
  function mockFetchPrestataire(
    collecte: Record<string, unknown>,
    listeTransporteurs?: { ok: boolean; data?: unknown[] },
  ) {
    const fetchMock = mockFetch() as unknown as ReturnType<typeof vi.fn>;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(
      (url: string, opts?: { method?: string; body?: string }) => {
        if (
          listeTransporteurs &&
          url.startsWith('/api/v1/admin/transporteurs')
        ) {
          return Promise.resolve({
            ok: listeTransporteurs.ok,
            json: async () => ({ data: listeTransporteurs.data ?? [] }),
          });
        }
        if (url === '/api/v1/admin/collectes/c1' && !opts?.method) {
          return Promise.resolve({ ok: true, json: async () => collecte });
        }
        return base(url, opts);
      },
    );
    return fetchMock;
  }

  // « non attribué » (en-tête) sans attraper un éventuel « non attribuée ».
  const NON_ATTRIBUE = /non attribué(?!e)/i;

  it(
    'collecte attribuée à un transporteur désactivé depuis (absent de la liste des actifs) : son nom reste affiché, jamais « non attribué »',
    async () => {
      mockFetchPrestataire({
        ...collecteAg,
        prestataire_logistique_id: 'presta-marathon',
        prestataire_actuel: {
          transporteur_id: 't-marathon',
          nom: 'Marathon',
          type_tms: 'mts1',
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);

      expect(
        (await screen.findAllByText('Marathon', undefined, ATTENTE_UI)).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(NON_ATTRIBUE)).toBeNull();

      await ouvrirOnglet('Logistique');
      const ligne = (
        await screen.findByText('Prestataire actuel', undefined, ATTENTE_UI)
      ).parentElement!;
      expect(within(ligne).getByText('Marathon')).toBeInTheDocument();
      expect(screen.queryByText('Aucun prestataire attribué')).toBeNull();
      // Désactivé = plus proposé à l'attribution : pas de carte, donc pas de
      // badge « Actuel » — c'est la ligne « Prestataire actuel » qui le nomme.
      await screen.findByRole('radio', { name: /Strike/ }, ATTENTE_UI);
      expect(screen.queryByRole('radio', { name: /Marathon/ })).toBeNull();
      expect(screen.queryByText('Actuel')).toBeNull();
      // Le bouton d'envoi suit le mode d'envoi du prestataire en place.
      expect(
        screen.getByRole('button', { name: 'Envoyer à MTS-1' }),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'liste des transporteurs en échec : le prestataire actuel reste nommé et son mode d’envoi connu',
    async () => {
      mockFetchPrestataire(
        {
          ...collecteAg,
          prestataire_logistique_id: 'presta-atoutes',
          prestataire_actuel: {
            transporteur_id: 't-atoutes',
            nom: 'A Toutes!',
            type_tms: 'a_toutes',
          },
          collecte_tournees: [],
        },
        { ok: false },
      );
      render(<CollecteDetailPanel collecteId="c1" />);

      expect(
        (await screen.findAllByText('A Toutes!', undefined, ATTENTE_UI)).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(NON_ATTRIBUE)).toBeNull();

      await ouvrirOnglet('Logistique');
      // `type_tms` lu sur le prestataire actuel, sans la liste : l'acceptation
      // manuelle (réservée à A Toutes!) reste offerte.
      expect(
        await screen.findByRole(
          'button',
          { name: 'Acceptation manuelle' },
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('Aucun prestataire attribué')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte attribuée dont le nom du prestataire manque dans la réponse : « Attribué — nom indisponible », jamais « non attribué »',
    async () => {
      mockFetchPrestataire({
        ...collecteAg,
        prestataire_logistique_id: 'presta-inconnu',
      });
      render(<CollecteDetailPanel collecteId="c1" />);

      expect(
        (
          await screen.findAllByText(
            'Attribué — nom indisponible',
            undefined,
            ATTENTE_UI,
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(NON_ATTRIBUE)).toBeNull();

      await ouvrirOnglet('Logistique');
      const ligne = (
        await screen.findByText('Prestataire actuel', undefined, ATTENTE_UI)
      ).parentElement!;
      expect(
        within(ligne).getByText('Attribué — nom indisponible'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Aucun prestataire attribué')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte attribuée à un transporteur actif : sa carte porte « Actuel » et reste cochée',
    async () => {
      mockFetchPrestataire({
        ...collecteAg,
        prestataire_logistique_id: 'presta-atoutes',
        prestataire_actuel: {
          transporteur_id: 't-atoutes',
          nom: 'A Toutes!',
          type_tms: 'a_toutes',
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const carte = await screen.findByRole(
        'radio',
        { name: /A Toutes!/ },
        ATTENTE_UI,
      );
      expect(carte).toHaveAttribute('aria-checked', 'true');
      expect(within(carte).getByText('Actuel')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Strike/ })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — modale forçage statut : PATCH exige un motif ≥ 10 caractères',
    async () => {
      const fetchMock = mockFetch();
      render(<CollecteDetailPanel collecteId="c1" />);

      // Ouvre la modale (déclencheur d'en-tête, visible quel que soit l'onglet)
      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: /Forcer le statut/ },
          ATTENTE_UI,
        ),
      );

      const dialog = screen
        .getByText('Forcer le statut de la collecte')
        .closest('div') as HTMLElement;
      const confirmer = within(dialog).getByRole('button', {
        name: /Confirmer le forçage/,
      });
      // Motif vide → soumission désactivée
      expect(confirmer).toBeDisabled();

      // Combobox : options portées dans un portail (screen, pas within).
      fireEvent.click(
        within(dialog).getByRole('combobox', { name: 'Nouveau statut' }),
      );
      fireEvent.click(
        screen
          .getAllByRole('option')
          .find((o) => o.getAttribute('data-value') === 'validee')!,
      );
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
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  // Régression BL-P0 : le GET fiche référençait des colonnes DB inexistantes
  // (types_evenements.nom, tournees.statut_tms, factures_collectes.statut) → 400
  // → crash blanc. Ce test rend la fiche avec les shapes DB corrigées.
  it(
    'M0.6 — rend type d’événement (libelle), tournée (statut) et facture (factures.statut)',
    async () => {
      mockFetch();
      render(<CollecteDetailPanel collecteId="c1" />);

      // types_evenements.libelle (onglet Informations, ouvert par défaut)
      expect(
        await screen.findByText('Cocktail apéritif', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      // tournees.statut (onglet Logistique — liste multi-camions)
      await ouvrirOnglet('Logistique');
      expect(
        await screen.findByText('planifiee', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      // factures_collectes → factures.statut (onglet Documents)
      await ouvrirOnglet('Documents');
      expect(
        await screen.findByText('emise', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — modale N camions : PATCH nb_camions_demande (RM-02)',
    async () => {
      const fetchMock = mockFetch();
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      await screen.findByText('Prestataire actuel', undefined, ATTENTE_UI);

      // Bouton « Modifier » à côté de Nb camions (statut programmee = éditable).
      fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
      const dialog = screen
        .getByText('Modifier le nombre de camions')
        .closest('div') as HTMLElement;
      fireEvent.change(within(dialog).getByLabelText('Nombre de camions'), {
        target: { value: '3' },
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Enregistrer' }),
      );

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          (c) =>
            c[0] === '/api/v1/admin/collectes/c1' &&
            (c[1] as { method?: string } | undefined)?.method === 'PATCH',
        );
        expect(patch).toBeTruthy();
        const body = JSON.parse((patch![1] as { body: string }).body) as {
          nb_camions_demande: number;
        };
        expect(body.nb_camions_demande).toBe(3);
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );
});

// ============================================================================
// BL-P1-BOA-07 — Blocs Documents / Pack AG / Attribution AG / Timeline (§06.06
// l.246-270). Remplace le stub « algo V2 » du Bloc 5, câble régénération PDF +
// import photo + audit.
// ============================================================================

const baseAg = {
  id: 'c1',
  type: 'anti_gaspi' as const,
  statut: 'realisee',
  statut_tms: 'acceptee',
  statut_tms_at: null,
  dirty_tms: false,
  date_collecte: '2026-05-10',
  heure_collecte: '19:00:00',
  nb_camions_demande: 1,
  tms_reference: 'TMS-9',
  volume_estime_repas: 50,
  controle_acces_requis: false,
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: 'p1',
  packs_antgaspi: {
    id: 'p1',
    type_pack: 'Pack 10 collectes',
    credits_restants: 7,
    statut: 'actif',
  },
  attributions_antgaspi: {
    id: 'attr1',
    mode_validation: 'manuel',
    valide_at: '2026-05-01T10:00:00Z',
    volume_repas_realise: 42,
    associations: { nom: 'Les Restos du Cœur' },
    transporteurs: { nom: 'A Toutes!' },
  },
  prestataire_logistique_id: null,
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
};

const documentsAg = {
  rapport: {
    id: 'r1',
    version: 2,
    disponible_a: '2026-05-11T06:00:00Z',
    genere_at: '2026-05-11T06:05:00Z',
    regenere_at: '2026-05-12T09:00:00Z',
    consulte_par_user_at: null,
    pdf_url: 'rapports/r1.pdf',
  },
  bordereau: null,
  attestation: {
    id: 'a1',
    statut: 'emise',
    numero: 'ATT-DON-2026-00001',
    genere_at: '2026-05-11T06:05:00Z',
    pdf_url: 'rapports/a1.pdf',
    version: 1,
  },
  photos: [],
};

const auditAg = {
  data: [
    {
      id: 'au1',
      created_at: '2026-05-10T20:00:00Z',
      role: 'admin_savr',
      action: 'collecte_statut_force',
      old_values: { statut: 'validee' },
      new_values: { statut: 'realisee' },
      motif: 'Confirmation réalisation terrain',
      impersonator_id: null,
    },
  ],
  recredit_at: null,
};

// Fixtures ZD (Bloc 3 bordereau, pas d'attestation ni pack/attribution AG).
const baseZd = {
  ...baseAg,
  type: 'zero_dechet' as const,
  packs_antgaspi: null,
  attributions_antgaspi: null,
};

const documentsZd = {
  rapport: documentsAg.rapport,
  bordereau: {
    id: 'b1',
    statut: 'emis',
    numero: 'BSAV-2026-00001',
    genere_at: '2026-05-11T06:05:00Z',
    pdf_fichier_id: 'fich-1',
  },
  attestation: null,
  photos: [],
};

const recoAg = {
  data: {
    // Scores détaillés (distance, capacité) — §06.06 l.253, exposés par l'algo.
    associations: [
      {
        id: 'a1',
        nom: 'Les Restos du Cœur',
        distance_km: 3.2,
        capacite_max_beneficiaires: 200,
      },
      { id: 'a2', nom: 'Banque Alimentaire' },
      { id: 'a3', nom: 'Secours Populaire' },
    ],
    transporteur: { id: 't-mts1', nom: 'Strike', type_tms: 'mts1' },
    no_asso: false,
    no_prestataire: false,
  },
};

function installMock(opts: {
  collecte?: Record<string, unknown>;
  documents?: unknown;
  audit?: unknown;
}) {
  const collecte = opts.collecte ?? baseAg;
  const documents = opts.documents ?? documentsAg;
  const audit = opts.audit ?? auditAg;
  const fetchMock = vi.fn(
    (url: string, init?: { method?: string; body?: unknown }) => {
      const method = init?.method ?? 'GET';
      const ok = (json: unknown, status = 200) =>
        Promise.resolve({ ok: status < 400, status, json: async () => json });

      // Régénération PDF (POST /documents/<type>/regenerate)
      if (url.includes('/documents/') && method === 'POST') {
        return ok({ job_id: 'job-1', type: 'x' }, 202);
      }
      if (url.endsWith('/documents')) return ok(documents);
      if (url.endsWith('/audit')) return ok(audit);
      if (url.includes('/photos') && method === 'POST') {
        return ok({ fichier: { id: 'f1' } }, 201);
      }
      if (url.includes('/download')) return ok({ url: 'https://r2/signed' });
      if (url.startsWith('/api/v1/admin/transporteurs'))
        return ok({ data: [] });
      if (url.includes('/recommandation')) return ok(recoAg);
      if (url.includes('/dispatch')) return ok({ ok: true });
      return ok(collecte);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('M0.6 — fiche collecte Documents/Pack/Attribution/Timeline (BL-P1-BOA-07)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it(
    'M0.6 — Bloc 3 Documents : rapport RSE + attestation AG affichés ; le bouton Régénérer appelle l’endpoint de régénération',
    async () => {
      const fetchMock = installMock({});
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');

      // Bloc Documents rendu + rapport + attestation (AG).
      expect(
        await screen.findByText('Rapport RSE', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText('Attestation de don')).toBeInTheDocument();
      expect(screen.getByText('ATT-DON-2026-00001')).toBeInTheDocument();

      // Régénérer le rapport → POST /documents/rapport-recyclage-zd/regenerate.
      const regenBtns = screen.getAllByRole('button', { name: /Régénérer/ });
      fireEvent.click(regenBtns[0]!);
      await waitFor(() => {
        const call = fetchMock.mock.calls.find(
          (c) =>
            typeof c[0] === 'string' &&
            (c[0] as string).includes(
              '/documents/rapport-recyclage-zd/regenerate',
            ) &&
            (c[1] as { method?: string } | undefined)?.method === 'POST',
        );
        expect(call).toBeTruthy();
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : picto « régénéré » affiché quand version ≠ initiale',
    async () => {
      installMock({});
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      // rapport.version = 2 + regenere_at → picto ⟳ avec title « Rapport régénéré ».
      expect(
        await screen.findByTitle(/Rapport régénéré/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  // (Bloc « Pack AG » retiré de la fiche — décision Val ; ex-tests Bloc 4 supprimés.)

  it(
    'M0.6 — Bloc 5 Attribution AG : association + transporteur retenus + lien vers l’écran complet (plus de stub « algo V2 »)',
    async () => {
      installMock({});
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      expect(
        await screen.findByText('Attribution AG', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      // Association + transporteur retenus (embed attributions_antgaspi).
      expect(screen.getAllByText('Les Restos du Cœur').length).toBeGreaterThan(
        0,
      );
      expect(screen.getByText('A Toutes!')).toBeInTheDocument();
      // Lien vers l'écran d'attribution complète (§06.09).
      const lien = screen.getByRole('link', { name: /attribution compl/i });
      expect(lien).toHaveAttribute('href', '/admin/attributions-ag/c1');
      // Le stub V2 a disparu.
      expect(
        screen.queryByText(/algo V2.*Non disponible en V1/),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 7 Timeline : les entrées d’audit sont rendues (action + transition de statut)',
    async () => {
      installMock({});
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Historique');
      expect(
        await screen.findByText('Historique & audit', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText('collecte_statut_force')).toBeInTheDocument();
      // Transition old → new statut.
      expect(screen.getByText(/validee → realisee/)).toBeInTheDocument();
      expect(
        screen.getByText(/Confirmation réalisation terrain/),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : « Importer des photos » envoie un POST multipart /photos',
    async () => {
      const fetchMock = installMock({});
      const { container } = render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      await screen.findByText('Rapport RSE', undefined, ATTENTE_UI);

      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(['x'], 'photo.png', { type: 'image/png' });
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        const call = fetchMock.mock.calls.find(
          (c) =>
            typeof c[0] === 'string' &&
            (c[0] as string).endsWith('/photos') &&
            (c[1] as { method?: string } | undefined)?.method === 'POST',
        );
        expect(call).toBeTruthy();
        expect((call![1] as { body?: unknown }).body instanceof FormData).toBe(
          true,
        );
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : bordereau ZD affiché pour une collecte ZD (numéro + statut) ; pas d’attestation AG',
    async () => {
      installMock({ collecte: baseZd, documents: documentsZd });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      expect(
        await screen.findByText('Bordereau ZD', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText('BSAV-2026-00001')).toBeInTheDocument();
      expect(screen.getByText(/Statut : emis/)).toBeInTheDocument();
      // Une collecte ZD n'a pas d'attestation de don (bloc AG masqué).
      expect(screen.queryByText('Attestation de don')).not.toBeInTheDocument();
      // Ni de Bloc 4/5 AG.
      expect(screen.queryByText('Pack AG')).not.toBeInTheDocument();
      expect(screen.queryByText('Attribution AG')).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : la galerie affiche les photos importées (shared.fichiers, URL R2)',
    async () => {
      installMock({
        documents: {
          ...documentsAg,
          photos: [
            {
              id: 'ph1',
              content_type: 'image/png',
              created_at: '2026-05-11T00:00:00Z',
              url: 'https://r2/signed-photo',
            },
          ],
        },
      });
      const { container } = render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      await screen.findByText('Rapport RSE', undefined, ATTENTE_UI);
      expect(screen.getByText('Photos (1)')).toBeInTheDocument();
      const img = container.querySelector(
        'img[alt="Photo collecte"]',
      ) as HTMLImageElement | null;
      expect(img).toBeTruthy();
      expect(img!.getAttribute('src')).toBe('https://r2/signed-photo');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 5 : top 3 affiche les scores détaillés (distance + capacité, §06.06 l.253)',
    async () => {
      // Collecte AG NON terminale → l'algo (reco) est appelé → top 3 + scores rendus.
      installMock({
        collecte: {
          ...baseAg,
          statut: 'programmee',
          attributions_antgaspi: null,
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      expect(
        await screen.findByText(/3\.2 km/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText(/capacité 200/)).toBeInTheDocument();
      // Choix en 2 temps (décision Val) : « Choisir » ouvre l'écran d'attribution
      // avec l'association présélectionnée ; la n°1 porte le badge « Recommandé ».
      const choisir = screen.getAllByRole('link', { name: 'Choisir' });
      expect(choisir).toHaveLength(3);
      expect(choisir[0]).toHaveAttribute(
        'href',
        '/admin/attributions-ag/c1?association=a1',
      );
      expect(choisir[1]).toHaveAttribute(
        'href',
        '/admin/attributions-ag/c1?association=a2',
      );
      expect(screen.getAllByText('Recommandé').length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Onglet Informations : date/heure, traiteur, pax, client final, lieu effectif, instructions d’accès et contacts',
    async () => {
      installMock({
        collecte: {
          ...baseAg,
          controle_acces_requis: false,
          informations_supplementaires: 'Sonner deux fois',
          notes_internes: 'Client exigeant',
          // Surcharge per-collecte : prime sur la référence `lieux`.
          lieu_overrides: { acces_details: 'Badge au PC sécurité' },
          evenements: {
            ...baseAg.evenements,
            contact_principal_nom: 'Alice Martin',
            contact_principal_telephone: '06 11 22 33 44',
            contact_secours_nom: null,
            contact_secours_telephone: null,
            lieux: {
              nom: 'Pavillon',
              ville: 'Paris',
              adresse_acces: '1 rue X',
              code_postal: '75017',
              acces_details: 'Code 1234',
              acces_office: 'difficile',
              stationnement: 'facile',
              type_vehicule_max: 'fourgon',
              contraintes_horaires: 'Pas avant 22h',
            },
          },
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);

      // Onglet ouvert par défaut.
      expect(
        await screen.findByRole(
          'tab',
          { name: 'Informations', selected: true },
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      const infos = screen.getByRole('tabpanel');
      // Événement : traiteur, pax, client final (client organisateur résolu).
      expect(within(infos).getByText('Traiteur Beta')).toBeInTheDocument();
      expect(within(infos).getByText(/jusqu.à 80/)).toBeInTheDocument();
      expect(within(infos).getByText('Org Cliente SA')).toBeInTheDocument();
      expect(within(infos).queryByText('Client Fallback')).toBeNull();
      expect(within(infos).getByText(/19:00/)).toBeInTheDocument();
      // Lieu : détails + badge de surcharge.
      expect(within(infos).getByText('75017 Paris')).toBeInTheDocument();
      expect(within(infos).getByText('Difficile')).toBeInTheDocument();
      expect(within(infos).getByText('Fourgon')).toBeInTheDocument();
      expect(within(infos).getByText('Pas avant 22h')).toBeInTheDocument();
      expect(
        within(infos).getByText('Modifié pour cette collecte'),
      ).toBeInTheDocument();
      // Instructions d'accès = valeur surchargée, pas la référence.
      expect(
        within(infos).getByText('Badge au PC sécurité'),
      ).toBeInTheDocument();
      expect(within(infos).queryByText('Code 1234')).toBeNull();
      expect(within(infos).getByText('Sonner deux fois')).toBeInTheDocument();
      expect(within(infos).getByText('Client exigeant')).toBeInTheDocument();
      // Contacts : principal appelable, secours absent.
      expect(within(infos).getByText('Alice Martin')).toBeInTheDocument();
      expect(
        within(infos).getByRole('link', { name: '06 11 22 33 44' }),
      ).toHaveAttribute('href', 'tel:0611223344');
      expect(within(infos).getByText('Non renseigné')).toBeInTheDocument();
      // Sans contrôle d'accès : aucune info chauffeur demandée.
      expect(
        within(infos).getByText(/aucune information chauffeur/),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Lieu effectif = ce que reçoit le transporteur : une surcharge null ou mal typée est ignorée (pas de badge)',
    async () => {
      installMock({
        collecte: {
          ...baseAg,
          // null = surcharge effacée ; objet = ligne ancienne non conforme.
          lieu_overrides: { acces_details: null, ville: { x: 1 } },
          evenements: {
            ...baseAg.evenements,
            lieux: {
              nom: 'Pavillon',
              ville: 'Paris',
              adresse_acces: '1 rue X',
              code_postal: '75017',
              acces_details: 'Code 1234',
            },
          },
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      const infos = await screen.findByRole('tabpanel', undefined, ATTENTE_UI);
      expect(
        await within(infos).findByText('Code 1234', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(within(infos).getByText('75017 Paris')).toBeInTheDocument();
      expect(
        within(infos).queryByText('Modifié pour cette collecte'),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Cartes prestataire : un seul arrêt de tabulation, les flèches déplacent la sélection',
    async () => {
      mockFetch();
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      const strike = await screen.findByRole(
        'radio',
        { name: /Strike/ },
        ATTENTE_UI,
      );
      const aToutes = screen.getByRole('radio', { name: /A Toutes!/ });
      // Strike (recommandé, coché) = seul focalisable au clavier.
      expect(strike).toHaveAttribute('tabindex', '0');
      expect(aToutes).toHaveAttribute('tabindex', '-1');

      strike.focus();
      fireEvent.keyDown(strike, { key: 'ArrowDown' });
      expect(aToutes).toHaveAttribute('aria-checked', 'true');
      expect(document.activeElement).toBe(aToutes);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Attribution AG déjà validée : plus de cartes « Choisir » (décision Val C5)',
    async () => {
      // baseAg : attribution validée ; statut non terminal → l'algo est appelé.
      const fetchMock = installMock({
        collecte: { ...baseAg, statut: 'programmee' },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      await screen.findByText('Attribution AG', undefined, ATTENTE_UI);
      await waitFor(
        () =>
          expect(
            fetchMock.mock.calls.some((c) =>
              String(c[0]).includes('/recommandation'),
            ),
          ).toBe(true),
        ATTENTE_UI,
      );
      expect(screen.queryByRole('link', { name: 'Choisir' })).toBeNull();
      expect(
        screen.getByRole('link', { name: /attribution compl/i }),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Colonne résumé visible quel que soit l’onglet (traiteur, lieu, association)',
    async () => {
      installMock({});
      render(<CollecteDetailPanel collecteId="c1" />);
      const resume = await screen.findByRole(
        'complementary',
        { name: 'Résumé de la collecte' },
        ATTENTE_UI,
      );
      await ouvrirOnglet('Historique');
      expect(within(resume).getByText('Traiteur Beta')).toBeInTheDocument();
      expect(within(resume).getByText('Pavillon')).toBeInTheDocument();
      expect(
        within(resume).getByText('Les Restos du Cœur'),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — onLoaded remonte type + titre-résumé (cadre coloré + en-tête figé « jusqu’à N pax »)',
    async () => {
      const onLoaded = vi.fn();
      installMock({ collecte: baseAg });
      render(<CollecteDetailPanel collecteId="c1" onLoaded={onLoaded} />);
      await waitFor(() => expect(onLoaded).toHaveBeenCalled(), ATTENTE_UI);
      const arg = onLoaded.mock.calls.at(-1)?.[0] as {
        type: string;
        title: string;
      };
      expect(arg.type).toBe('anti_gaspi');
      expect(arg.title).toContain('Collecte Anti-Gaspi');
      expect(arg.title).toContain("jusqu'à 80 pax");
    },
    ATTENTE_CAS_MS,
  );
});

// ============================================================================
// §06.06 §3 Bloc 0 — acceptation manuelle d'une mission Everest (A Toutes!
// indisponible, arbitrage Val 2026-09-16) : la référence de mission est
// OBLIGATOIRE dans la modale, comme dans la route.
// ============================================================================

const collecteAToutes = {
  ...collecteAg,
  prestataire_logistique_id: 'presta-atoutes',
  prestataire_actuel: {
    transporteur_id: 't-atoutes',
    nom: 'A Toutes!',
    type_tms: 'a_toutes',
  },
  collecte_tournees: [],
};

function mockFetchAcceptation(
  collecte: Record<string, unknown>,
  reponse: { ok: boolean; body: unknown } = {
    ok: true,
    body: { ok: true, reference_mission: 'EVR-TEL-001', rejeu: false },
  },
) {
  // Typage relâché : l'implémentation de base renvoie une union de réponses
  // que `mockImplementation` refuse d'élargir.
  const fetchMock = mockFetch() as unknown as ReturnType<typeof vi.fn>;
  const base = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(
    (url: string, opts?: { method?: string; body?: string }) => {
      if (url === '/api/v1/admin/everest/missions/manual-accept') {
        return Promise.resolve({
          ok: reponse.ok,
          json: async () => reponse.body,
        });
      }
      if (url === '/api/v1/admin/collectes/c1' && !opts?.method) {
        return Promise.resolve({ ok: true, json: async () => collecte });
      }
      return base(url, opts);
    },
  );
  return fetchMock;
}

describe('§06.06 Bloc 0 — acceptation manuelle Everest', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it(
    'collecte A Toutes! non transmise : la modale exige référence ET contact, puis POST la saisie',
    async () => {
      const fetchMock = mockFetchAcceptation(collecteAToutes);
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Acceptation manuelle' },
          ATTENTE_UI,
        ),
      );
      const dialog = screen.getByRole('dialog');
      const enregistrer = within(dialog).getByRole('button', {
        name: "Enregistrer l'acceptation",
      });
      const reference = within(dialog).getByLabelText(
        /Référence de mission communiquée par A Toutes!/,
      );
      const contact = within(dialog).getByLabelText(
        /Contact joint chez A Toutes!/,
      );

      // Contact seul : la référence manque → bouton désactivé.
      fireEvent.change(contact, { target: { value: 'Mathieu' } });
      expect(enregistrer).toBeDisabled();
      // Référence avec une espace (dictée) : refusée côté client aussi.
      fireEvent.change(reference, { target: { value: 'EVR 001' } });
      expect(enregistrer).toBeDisabled();

      fireEvent.change(reference, { target: { value: 'EVR-TEL-001' } });
      expect(enregistrer).toBeEnabled();
      fireEvent.click(enregistrer);

      await waitFor(() => {
        const post = fetchMock.mock.calls.find(
          (c) => c[0] === '/api/v1/admin/everest/missions/manual-accept',
        );
        expect(post).toBeTruthy();
        expect(JSON.parse((post![1] as { body: string }).body)).toEqual({
          collecte_id: 'c1',
          reference_mission: 'EVR-TEL-001',
          contact_joint: 'Mathieu',
          heure_appel: '',
          commentaire: '',
        });
      }, ATTENTE_UI);
      await waitFor(
        () => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'refus serveur (référence déjà enregistrée) : message affiché, modale conservée',
    async () => {
      mockFetchAcceptation(collecteAToutes, {
        ok: false,
        body: {
          error:
            'Cette référence de mission est déjà enregistrée sur une autre collecte. Vérifiez la saisie.',
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Acceptation manuelle' },
          ATTENTE_UI,
        ),
      );
      const dialog = screen.getByRole('dialog');
      fireEvent.change(
        within(dialog).getByLabelText(/Référence de mission communiquée/),
        { target: { value: 'EVR-TEL-001' } },
      );
      fireEvent.change(within(dialog).getByLabelText(/Contact joint/), {
        target: { value: 'Mathieu' },
      });
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: "Enregistrer l'acceptation",
        }),
      );

      expect(
        await within(dialog).findByText(
          /déjà enregistrée sur une autre collecte/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it.each([
    [
      'référence de mission déjà enregistrée',
      { ...collecteAToutes, tms_reference: 'EVR-TEL-001' },
    ],
    [
      'collecte chez un transporteur MTS-1',
      {
        ...collecteAToutes,
        prestataire_logistique_id: 'presta-mts1',
        prestataire_actuel: {
          transporteur_id: 't-mts1',
          nom: 'Strike',
          type_tms: 'mts1',
        },
      },
    ],
    ['collecte terminale', { ...collecteAToutes, statut: 'annulee' }],
  ])(
    'bouton absent : %s',
    async (_cas, collecte) => {
      mockFetchAcceptation(collecte);
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      await screen.findByText('Prestataire actuel', undefined, ATTENTE_UI);

      expect(
        screen.queryByRole('button', { name: 'Acceptation manuelle' }),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
