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
  // Collecte AG non encore attribuée à un prestataire (comme sur le preview réel),
  // mais dont l'association est déjà choisie : l'envoi au prestataire n'est
  // possible qu'après (décision Val 2026-10-01 — son adresse est le point B).
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

function mockFetch(collecteFixture: object | (() => object) = collecteAg) {
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
              associations: [
                {
                  id: 'a1',
                  nom: 'Les Restos du Cœur',
                  distance_km: 2.4,
                  capacite_max_beneficiaires: 300,
                  contact_email: 'contact@restos.test',
                },
              ],
              assoc_count: 1,
              transporteur: { id: 't-mts1', nom: 'Strike', type_tms: 'mts1' },
              transporteurs: [
                { id: 't-mts1', nom: 'Strike', type_tms: 'mts1' },
              ],
              branche: 'ag_marathon_nuit',
              is_idf: true,
              no_asso: false,
              no_prestataire: false,
              delai_minutes: 600,
              nb_pax: 80,
            },
          }),
        });
      }
      if (url.includes('/associations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'a1',
                nom: 'Les Restos du Cœur',
                ville: 'Paris',
                capacite_max_beneficiaires: 300,
                habilitee_attestation_fiscale: true,
                distance_km: 2.4,
              },
            ],
          }),
        });
      }
      if (url.includes('/valider') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { attribution_id: 'att-1' } }),
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
      return Promise.resolve({
        ok: true,
        json: async () =>
          typeof collecteFixture === 'function'
            ? collecteFixture()
            : collecteFixture,
      });
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
    'M0.6 — Logistique AG : le bloc « Attribution AG » précède « Prestataire & Dispatch »',
    async () => {
      mockFetch();
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const attribution = await screen.findByText(
        'Attribution AG',
        undefined,
        ATTENTE_UI,
      );
      const dispatch = screen.getByText('Prestataire & Dispatch');
      // L'association est choisie AVANT le prestataire (décision Val 2026-10-01).
      expect(
        attribution.compareDocumentPosition(dispatch) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — AG sans attribution : le formulaire d’attribution intégré remplace le dispatch',
    async () => {
      const fetchMock = mockFetch({
        ...collecteAg,
        attributions_antgaspi: null,
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      // Association d'abord (son adresse est le point de livraison), puis le
      // besoin véhicule et le prestataire — dans le popup, sans page dédiée.
      expect(
        await screen.findByText(
          'Attribution & dispatch',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      // L'en-tête est rendu par le panneau ; les champs attendent la fin du
      // chargement du formulaire (LoadingState) — attente explicite.
      expect(
        await screen.findByLabelText(
          'Type de véhicule souhaité',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Nombre de véhicules')).toHaveValue('1');
      expect(
        await screen.findByRole(
          'combobox',
          { name: 'Association' },
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      // Plus de bouton d'envoi direct : l'unique geste est « Valider et envoyer ».
      expect(
        screen.queryByRole('button', { name: /^Envoyer à/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Prestataire & Dispatch'),
      ).not.toBeInTheDocument();

      // Nombre de véhicules → 2 ; validation = POST /valider avec le besoin véhicule.
      fireEvent.click(
        screen.getByRole('button', { name: 'Ajouter un véhicule' }),
      );
      expect(screen.getByLabelText('Nombre de véhicules')).toHaveValue('2');
      const valider = await screen.findByRole(
        'button',
        { name: /^Valider et envoyer à MTS-1/ },
        ATTENTE_UI,
      );
      await waitFor(() => expect(valider).not.toBeDisabled(), ATTENTE_UI);
      fireEvent.click(valider);
      await waitFor(() => {
        const post = fetchMock.mock.calls.find(
          ([u, o]) =>
            String(u).includes('/valider') &&
            (o as { method?: string } | undefined)?.method === 'POST',
        );
        expect(post).toBeTruthy();
        const body = JSON.parse(
          String((post![1] as { body: string }).body),
        ) as Record<string, unknown>;
        expect(body.association_id).toBe('a1');
        expect(body.transporteur_id).toBe('t-mts1');
        expect(body.nb_camions_demande).toBe(2);
        expect(body.type_vehicule_souhaite).toBeNull();
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — attribution validée sur un autre transporteur : le bloc dispatch coche l’actuel, jamais le recommandé',
    async () => {
      // Avant : AG sans attribution. Après validation : attribuée à A Toutes!
      // (≠ reco Strike). Le bloc dispatch qui prend la relève ne doit pas
      // présélectionner Strike — un clic renverrait la collecte au mauvais
      // prestataire, sans motif.
      let fixture: object = { ...collecteAg, attributions_antgaspi: null };
      const fetchMock = mockFetch(() => fixture);
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const selectTransp = await screen.findByRole(
        'combobox',
        { name: 'Transporteur' },
        ATTENTE_UI,
      );
      fireEvent.click(selectTransp);
      fireEvent.click(
        await screen.findByRole('option', { name: 'A Toutes!' }, ATTENTE_UI),
      );
      fireEvent.click(screen.getByRole('combobox', { name: 'Motif' }));
      fireEvent.click(
        screen.getByRole('option', { name: 'Transporteur top 1 indisponible' }),
      );
      const valider = await screen.findByRole(
        'button',
        { name: /^Valider et envoyer à A Toutes!/ },
        ATTENTE_UI,
      );
      await waitFor(() => expect(valider).not.toBeDisabled(), ATTENTE_UI);
      fixture = {
        ...collecteAg,
        prestataire_logistique_id: 'presta-atoutes',
        prestataire_actuel: {
          transporteur_id: 't-atoutes',
          nom: 'A Toutes!',
          type_tms: 'a_toutes',
        },
        attributions_antgaspi: {
          id: 'attr-1',
          mode_validation: 'manuel_override',
          valide_at: '2026-10-01T10:00:00Z',
          volume_repas_realise: null,
          associations: { nom: 'Les Restos du Cœur' },
          transporteurs: {
            id: 't-atoutes',
            nom: 'A Toutes!',
            type_tms: 'a_toutes',
          },
        },
      };
      fireEvent.click(valider);

      // Après refetch : l'ordre est en file d'envoi → la fiche dit la collecte
      // envoyée à A Toutes!, sans carte ni bouton d'envoi (décision Val
      // 2026-10-02, C1). « Changer de prestataire » rouvre les cartes : « Actuel »
      // = A Toutes! cochée, bouton forké sur A Toutes!, rien vers le recommandé.
      expect(
        await screen.findByText(
          /Collecte envoyée à A Toutes!/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: /Strike/ })).toBeNull();
      expect(
        screen.queryByRole('button', { name: /^(Envoyer|Renvoyer) à/ }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole('button', { name: 'Changer de prestataire' }),
      );
      const carteAToutes = await screen.findByRole(
        'radio',
        { name: /A Toutes!/ },
        ATTENTE_UI,
      );
      await waitFor(
        () => expect(carteAToutes).toHaveAttribute('aria-checked', 'true'),
        ATTENTE_UI,
      );
      expect(screen.getByRole('radio', { name: /Strike/ })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      // Même prestataire, ordre déjà en file : c'est un renvoi, pas un envoi.
      expect(
        screen.getByRole('button', { name: /Renvoyer à A Toutes!/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /MTS-1/ }),
      ).not.toBeInTheDocument();
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) =>
            String(u).includes('/valider') &&
            (o as { method?: string } | undefined)?.method === 'POST',
        ),
      ).toBe(true);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — AG sans attribution hors « programmee » : consigne, ni formulaire ni bouton d’envoi',
    async () => {
      mockFetch({
        ...collecteAg,
        statut: 'brouillon',
        attributions_antgaspi: null,
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      expect(
        await screen.findByText(
          // Une AG sans attribution s'affiche « Créée » (Val 2026-10-07).
          /possible qu.au statut « Créée » — statut actuel : « Brouillon »/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText('Type de véhicule souhaité'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Envoyer à/ }),
      ).not.toBeInTheDocument();
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
      // Ordre en file d'envoi : la fiche le dit envoyé à Marathon ; les cartes
      // ne reviennent que sur « Changer de prestataire ».
      expect(
        screen.getByText(/Collecte envoyée à Marathon/),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: 'Changer de prestataire' }),
      );
      // Désactivé = plus proposé à l'attribution : pas de carte, donc pas de
      // badge « Actuel » — c'est la ligne « Prestataire actuel » qui le nomme.
      await screen.findByRole('radio', { name: /Strike/ }, ATTENTE_UI);
      expect(screen.queryByRole('radio', { name: /Marathon/ })).toBeNull();
      expect(screen.queryByText('Actuel')).toBeNull();
      // Le bouton d'envoi suit le mode d'envoi du prestataire en place, et dit
      // « Renvoyer » : l'ordre est déjà en file chez lui.
      expect(
        screen.getByRole('button', { name: 'Renvoyer à MTS-1' }),
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

      // Ordre en file d'envoi : les cartes ne reviennent que sur demande.
      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Changer de prestataire' },
          ATTENTE_UI,
        ),
      );
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

  // ──────────────────────────────────────────────────────────────────────────
  // Ordre en file d'envoi (décision Val 2026-10-02, C1). Entre « Valider et
  // envoyer » et le passage du worker outbox (15 min), `tms_reference` est vide
  // et `statut_tms` encore `non_envoye` (§06.09 §3 pt 3) : la fiche réaffichait
  // « Prestataire à attribuer » + « Envoyer à MTS-1 », comme si rien n'était
  // parti. Elle doit dire la collecte envoyée et ne rouvrir le choix que sur
  // demande.
  // ──────────────────────────────────────────────────────────────────────────

  const collecteEnFileMts1 = {
    ...collecteAg,
    prestataire_logistique_id: 'presta-mts1',
    prestataire_actuel: {
      transporteur_id: 't-mts1',
      nom: 'Strike',
      type_tms: 'mts1',
    },
    collecte_tournees: [],
  };

  it(
    'AG en file d’envoi : « Envoyée » en en-tête et au bloc, collecte dite envoyée au prestataire, ni carte ni bouton d’envoi',
    async () => {
      mockFetchPrestataire(collecteEnFileMts1);
      render(<CollecteDetailPanel collecteId="c1" />);

      // En-tête : plus de « Non envoyé » à côté du prestataire.
      const sousLigne = await screen.findByTestId(
        'fiche-admin-sous-ligne',
        undefined,
        ATTENTE_UI,
      );
      expect(within(sousLigne).getByText('Envoyée')).toBeInTheDocument();
      expect(within(sousLigne).queryByText('Non envoyé')).toBeNull();

      await ouvrirOnglet('Logistique');
      expect(
        await screen.findByText(
          /Collecte envoyée à Strike/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(/vers MTS-1/)).toBeInTheDocument();
      const ligne = screen.getByText('Statut TMS').parentElement!;
      expect(within(ligne).getByText('Envoyée')).toBeInTheDocument();
      expect(screen.queryByText('Non envoyé')).toBeNull();
      // Ni choix du prestataire ni bouton d'envoi tant qu'on ne le demande pas.
      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(screen.queryByText('Prestataire à attribuer')).toBeNull();
      expect(
        screen.queryByRole('button', { name: /^(Envoyer|Renvoyer) à/ }),
      ).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Changer de prestataire' }),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  // Statut affiché Admin (décision Val 2026-10-07) : « Créée » tant que la
  // demande n'est pas partie, « Programmée » dès que l'Admin l'a envoyée — sans
  // attendre le passage du worker (badge « Envoyée » ci-dessus).
  function etapeCourante(): string | null {
    return (
      within(screen.getByRole('list', { name: 'Avancement de la collecte' }))
        .getAllByRole('listitem')
        .find((li) => li.getAttribute('aria-current') === 'step')
        ?.textContent ?? null
    );
  }

  it(
    'M0.6/statut_admin_programmee_apres_envoi — AG en file d’envoi : frise à l’étape « Programmée »',
    async () => {
      mockFetchPrestataire(collecteEnFileMts1);
      render(<CollecteDetailPanel collecteId="c1" />);
      await screen.findByTestId(
        'fiche-admin-sous-ligne',
        undefined,
        ATTENTE_UI,
      );
      expect(etapeCourante()).toContain('Programmée');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6/statut_admin_creee_avant_envoi — collecte validée par le traiteur, rien d’envoyé : frise à l’étape « Créée »',
    async () => {
      mockFetchPrestataire({
        ...collecteAg,
        prestataire_logistique_id: null,
        attributions_antgaspi: null,
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await screen.findByTestId(
        'fiche-admin-sous-ligne',
        undefined,
        ATTENTE_UI,
      );
      expect(etapeCourante()).toContain('Créée');
      expect(
        within(
          screen.getByRole('list', { name: 'Avancement de la collecte' }),
        ).getAllByRole('listitem'),
      ).toHaveLength(6);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'AG en file d’envoi : « Changer de prestataire » rouvre les cartes (titre « Changer de prestataire », actuel coché), « Garder le prestataire actuel » referme sans rien envoyer',
    async () => {
      const fetchMock = mockFetchPrestataire(collecteEnFileMts1);
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Changer de prestataire' },
          ATTENTE_UI,
        ),
      );
      expect(screen.getByText('Changer de prestataire')).toBeInTheDocument();
      const carteStrike = await screen.findByRole(
        'radio',
        { name: /Strike/ },
        ATTENTE_UI,
      );
      expect(carteStrike).toHaveAttribute('aria-checked', 'true');
      expect(within(carteStrike).getByText('Actuel')).toBeInTheDocument();
      // Le bouton cliqué a disparu : le focus est passé sur la carte cochée.
      expect(carteStrike).toHaveFocus();
      // Même prestataire → renvoi ; un autre prestataire → envoi chez lui.
      expect(
        screen.getByRole('button', { name: 'Renvoyer à MTS-1' }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: /A Toutes!/ }));
      expect(
        screen.getByRole('button', { name: 'Envoyer à A Toutes!' }),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: 'Garder le prestataire actuel' }),
      );
      expect(screen.queryByRole('radiogroup')).toBeNull();
      // « Garder » a disparu à son tour : le focus revient sur « Changer ».
      expect(
        screen.getByRole('button', { name: 'Changer de prestataire' }),
      ).toHaveFocus();
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes('/dispatch')),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'AG en file d’envoi : envoyer chez un autre prestataire (motif override) POST le dispatch, puis le mode « changer » se referme',
    async () => {
      const fetchMock = mockFetchPrestataire(collecteEnFileMts1);
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Changer de prestataire' },
          ATTENTE_UI,
        ),
      );
      // A Toutes! ≠ reco Strike → motif obligatoire, puis envoi chez A Toutes!.
      fireEvent.click(
        await screen.findByRole('radio', { name: /A Toutes!/ }, ATTENTE_UI),
      );
      const bouton = screen.getByRole('button', {
        name: 'Envoyer à A Toutes!',
      });
      expect(bouton).toBeDisabled();
      fireEvent.change(screen.getByLabelText(/Motif override/), {
        target: { value: 'Zone vélo cargo IDF' },
      });
      expect(bouton).toBeEnabled();
      fireEvent.click(bouton);

      await waitFor(() => {
        const post = fetchMock.mock.calls.find(
          (c) =>
            String(c[0]).includes('/dispatch') &&
            (c[1] as { method?: string } | undefined)?.method === 'POST',
        );
        expect(post).toBeTruthy();
        expect(JSON.parse((post![1] as { body: string }).body)).toEqual({
          prestataire_logistique_id: 'presta-atoutes',
          motif_override_prestataire: 'Zone vélo cargo IDF',
        });
      }, ATTENTE_UI);
      // Après le refetch, le bloc revient en lecture : plus de cartes, le
      // bouton « Changer de prestataire » est de retour et reprend le focus
      // (le bouton d'envoi cliqué a disparu).
      await waitFor(
        () => expect(screen.queryByRole('radiogroup')).toBeNull(),
        ATTENTE_UI,
      );
      expect(
        screen.getByRole('button', { name: 'Changer de prestataire' }),
      ).toHaveFocus();
    },
    ATTENTE_CAS_MS,
  );

  // ZD (décision Val 2026-10-07, C1) : l'Admin choisit le prestataire sur la
  // fiche, comme pour l'AG, puis envoie. Avant, la fiche n'offrait aucun choix
  // en ZD et « Envoyer » émettait un ordre sans prestataire, que personne ne
  // recevait.
  const collecteZdSansPrestataire = {
    ...collecteAg,
    type: 'zero_dechet',
    attributions_antgaspi: null,
    prestataire_logistique_id: null,
    prestataire_actuel: null,
    collecte_tournees: [],
  };
  const transporteursZd = [
    ...transporteurs,
    {
      id: 't-marathon',
      nom: 'Marathon',
      type_tms: 'mts1',
      prestataire_logistique_id: 'presta-marathon',
      actif: true,
      types_collecte: ['zero_dechet', 'anti_gaspi'],
    },
    // Sans prestataire relié : rien à poser sur la collecte.
    {
      id: 't-sans-pont',
      nom: 'Presta sans code',
      type_tms: 'mts1',
      prestataire_logistique_id: null,
      actif: true,
    },
    // Référentiel renseigné, ZD non prise en charge.
    {
      id: 't-ag-seul',
      nom: 'Camion AG seul',
      type_tms: 'mts1',
      prestataire_logistique_id: 'presta-ag-seul',
      actif: true,
      types_collecte: ['anti_gaspi'],
    },
  ];
  const postDispatch = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes('/dispatch') &&
        (c[1] as { method?: string } | undefined)?.method === 'POST',
    );

  it(
    'M0.6/dispatch_zd_choix_prestataire — ZD sans prestataire : cartes de choix sans « Recommandé », envoi impossible tant qu’aucune n’est cochée, puis POST avec le prestataire choisi et sans motif',
    async () => {
      const fetchMock = mockFetchPrestataire(collecteZdSansPrestataire, {
        ok: true,
        data: transporteursZd,
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const cartes = await screen.findByRole(
        'radiogroup',
        undefined,
        ATTENTE_UI,
      );
      expect(
        within(cartes)
          .getAllByRole('radio')
          .map((r) => r.textContent),
      ).toEqual([
        expect.stringContaining('Strike'),
        expect.stringContaining('Marathon'),
      ]);
      // A Toutes! n'est jamais proposée sur une ZD : son envoi exige
      // l'association destinataire d'une AG (l'ordre finirait en échec
      // définitif et bloquerait les envois suivants de la collecte).
      expect(
        within(cartes).queryByRole('radio', { name: /A Toutes!/ }),
      ).toBeNull();
      // Pas d'algorithme en ZD : aucune carte recommandée ni présélectionnée.
      expect(within(cartes).queryByText('Recommandé')).toBeNull();
      expect(
        within(cartes)
          .getAllByRole('radio')
          .every((r) => r.getAttribute('aria-checked') === 'false'),
      ).toBe(true);
      // Rien à envoyer tant qu'aucun prestataire n'est choisi : bouton neutre
      // et inactif, avec la consigne.
      expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
      expect(
        screen.getByText(/Choisissez le prestataire qui réalisera la collecte/),
      ).toBeInTheDocument();

      fireEvent.click(within(cartes).getByRole('radio', { name: /Marathon/ }));
      const bouton = screen.getByRole('button', { name: 'Envoyer à MTS-1' });
      expect(bouton).toBeEnabled();
      // Premier choix : pas de motif demandé.
      expect(screen.queryByLabelText(/Motif/)).toBeNull();
      fireEvent.click(bouton);

      await waitFor(() => {
        const post = postDispatch(fetchMock);
        expect(post).toBeTruthy();
        expect(JSON.parse((post![1] as { body: string }).body)).toEqual({
          prestataire_logistique_id: 'presta-marathon',
        });
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6/dispatch_zd_prestataire_unique_preselectionne — un seul transporteur prend les ZD : sa carte est cochée d’office, un clic suffit pour envoyer',
    async () => {
      // Référentiel renseigné : seul Strike prend les ZD.
      const fetchMock = mockFetchPrestataire(collecteZdSansPrestataire, {
        ok: true,
        data: [
          { ...transporteurs[0], types_collecte: ['zero_dechet'] },
          {
            id: 't-marathon',
            nom: 'Marathon',
            type_tms: 'mts1',
            prestataire_logistique_id: 'presta-marathon',
            actif: true,
            types_collecte: ['anti_gaspi'],
          },
          transporteurs[1],
        ],
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const carte = await screen.findByRole(
        'radio',
        { name: /Strike/ },
        ATTENTE_UI,
      );
      await waitFor(
        () => expect(carte).toHaveAttribute('aria-checked', 'true'),
        ATTENTE_UI,
      );
      expect(screen.getAllByRole('radio')).toHaveLength(1);
      const bouton = screen.getByRole('button', { name: 'Envoyer à MTS-1' });
      expect(bouton).toBeEnabled();
      fireEvent.click(bouton);

      await waitFor(() => {
        const post = postDispatch(fetchMock);
        expect(post).toBeTruthy();
        expect(JSON.parse((post![1] as { body: string }).body)).toEqual({
          prestataire_logistique_id: 'presta-mts1',
        });
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6/dispatch_zd_envoyee_programmee — ZD dont le prestataire vient d’être choisi : « Envoyée », bloc en lecture, frise à « Programmée »',
    async () => {
      mockFetchPrestataire({
        ...collecteEnFileMts1,
        type: 'zero_dechet',
        attributions_antgaspi: null,
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      const sousLigne = await screen.findByTestId(
        'fiche-admin-sous-ligne',
        undefined,
        ATTENTE_UI,
      );
      expect(within(sousLigne).getByText('Envoyée')).toBeInTheDocument();
      expect(etapeCourante()).toContain('Programmée');

      await ouvrirOnglet('Logistique');
      expect(
        await screen.findByText(
          /Collecte envoyée à Strike/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(
        screen.queryByRole('button', { name: /^(Envoyer|Renvoyer) à/ }),
      ).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Changer de prestataire' }),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6/dispatch_zd_commande_en_cours — ZD déjà commandée (référence reçue) : pas de choix de prestataire, « Renvoyer à MTS-1 » reste possible et part sans prestataire',
    async () => {
      const fetchMock = mockFetchPrestataire(
        {
          ...collecteEnFileMts1,
          type: 'zero_dechet',
          attributions_antgaspi: null,
          statut_tms: 'attribuee_en_attente_acceptation',
          tms_reference: 'TOUR-77',
        },
        { ok: true, data: transporteursZd },
      );
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const bouton = await screen.findByRole(
        'button',
        { name: 'Renvoyer à MTS-1' },
        ATTENTE_UI,
      );
      expect(bouton).toBeEnabled();
      // Changer de prestataire ne ferait que modifier la commande chez
      // l'actuel : ni cartes ni bouton de changement.
      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Changer de prestataire' }),
      ).toBeNull();
      fireEvent.click(bouton);

      await waitFor(() => {
        const post = postDispatch(fetchMock);
        expect(post).toBeTruthy();
        expect(JSON.parse((post![1] as { body: string }).body)).toEqual({});
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'ZD en demande d’annulation, sans prestataire : aucun choix proposé, envoi inactif',
    async () => {
      mockFetchPrestataire(
        { ...collecteZdSansPrestataire, statut: 'annulation_demandee' },
        { ok: true, data: transporteursZd },
      );
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      expect(
        await screen.findByRole('button', { name: 'Envoyer' }, ATTENTE_UI),
      ).toBeDisabled();
      expect(screen.queryByRole('radiogroup')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6/dispatch_zd_changement_motif — ZD : changer un prestataire déjà posé exige un motif (≥ 5 car.), transmis au dispatch',
    async () => {
      const fetchMock = mockFetchPrestataire(
        {
          ...collecteEnFileMts1,
          type: 'zero_dechet',
          attributions_antgaspi: null,
        },
        { ok: true, data: transporteursZd },
      );
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Changer de prestataire' },
          ATTENTE_UI,
        ),
      );
      fireEvent.click(
        await screen.findByRole('radio', { name: /Marathon/ }, ATTENTE_UI),
      );
      const bouton = screen.getByRole('button', { name: 'Envoyer à MTS-1' });
      expect(bouton).toBeDisabled();
      fireEvent.change(
        screen.getByLabelText(/Motif du changement de prestataire/),
        { target: { value: 'Strike indisponible ce soir' } },
      );
      expect(bouton).toBeEnabled();
      fireEvent.click(bouton);

      await waitFor(() => {
        const post = postDispatch(fetchMock);
        expect(post).toBeTruthy();
        expect(JSON.parse((post![1] as { body: string }).body)).toEqual({
          prestataire_logistique_id: 'presta-marathon',
          motif_override_prestataire: 'Strike indisponible ce soir',
        });
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it.each([
    [
      'statut TMS autre que « non envoyé » (rejet prestataire, référence vide)',
      { ...collecteEnFileMts1, statut_tms: 'rejetee_par_prestataire' },
    ],
    [
      'prestataire servi par le repli attribution, sans pont (prestataire_logistique_id NULL)',
      { ...collecteEnFileMts1, prestataire_logistique_id: null },
    ],
    ['collecte terminale', { ...collecteEnFileMts1, statut: 'annulee' }],
    [
      'transporteur manuel (par mail) avec prestataire de rattachement posé : rien ne part automatiquement',
      {
        ...collecteEnFileMts1,
        prestataire_logistique_id: 'presta-province',
        prestataire_actuel: {
          transporteur_id: 't-province',
          nom: 'Transports Dupont',
          type_tms: 'par_mail',
        },
      },
    ],
  ])(
    'pas d’état « en file d’envoi » : %s',
    async (_cas, collecte) => {
      mockFetchPrestataire(collecte);
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      await screen.findByText('Prestataire actuel', undefined, ATTENTE_UI);

      expect(screen.queryByText(/Collecte envoyée/)).toBeNull();
      expect(screen.queryByText('Envoyée')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Changer de prestataire' }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'AG attribuée à un transporteur sans pont prestataire (par mail) : il est le prestataire actuel, sa carte reste cochée malgré la reco',
    async () => {
      // `prestataire_logistique_id` reste NULL pour ces transporteurs : la route
      // sert le transporteur de l'attribution validée (arbitrage Val 2026-10-01).
      mockFetchPrestataire(
        {
          ...collecteAg,
          prestataire_logistique_id: null,
          prestataire_actuel: {
            transporteur_id: 't-province',
            nom: 'Transports Dupont',
            type_tms: 'par_mail',
          },
        },
        {
          ok: true,
          data: [
            ...transporteurs,
            {
              id: 't-province',
              nom: 'Transports Dupont',
              type_tms: 'par_mail',
              prestataire_logistique_id: null,
              actif: true,
            },
          ],
        },
      );
      render(<CollecteDetailPanel collecteId="c1" />);

      expect(
        (await screen.findAllByText('Transports Dupont', undefined, ATTENTE_UI))
          .length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(NON_ATTRIBUE)).toBeNull();

      await ouvrirOnglet('Logistique');
      const ligne = (
        await screen.findByText('Prestataire actuel', undefined, ATTENTE_UI)
      ).parentElement!;
      expect(within(ligne).getByText('Transports Dupont')).toBeInTheDocument();
      expect(screen.queryByText('Aucun prestataire attribué')).toBeNull();

      // La reco (top-1 = Strike) est affichée mais ne prend PAS la main sur une
      // collecte déjà attribuée : un clic sur le bouton d'envoi la ré-attribuerait.
      const carteStrike = await screen.findByRole(
        'radio',
        { name: /Strike/ },
        ATTENTE_UI,
      );
      await within(carteStrike).findByText('Recommandé', undefined, ATTENTE_UI);
      expect(carteStrike).toHaveAttribute('aria-checked', 'false');
      const carteActuelle = screen.getByRole('radio', {
        name: /Transports Dupont/,
      });
      expect(carteActuelle).toHaveAttribute('aria-checked', 'true');
      expect(within(carteActuelle).getByText('Actuel')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Dispatcher (manuel)' }),
      ).toBeInTheDocument();
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
        // R-UI-5 F7 : champ obligatoire = astérisque (`FormField required`).
        within(dialog).getByRole('combobox', { name: 'Nouveau statut *' }),
      );
      // M0.6/statut_admin_brouillon_absent — un brouillon n'apparaît pas côté
      // Admin : on n'y force pas une collecte. Le statut DB `programmee`
      // s'affiche « Créée » ou « Programmée » selon l'envoi (Val 2026-10-07).
      const options = screen.getAllByRole('option');
      expect(options.map((o) => o.getAttribute('data-value'))).not.toContain(
        'brouillon',
      );
      expect(
        options.find((o) => o.getAttribute('data-value') === 'programmee'),
      ).toHaveTextContent('Créée / Programmée');
      fireEvent.click(
        screen
          .getAllByRole('option')
          .find((o) => o.getAttribute('data-value') === 'validee')!,
      );
      // R-UI-5 F7 : « (obligatoire) » retiré du libellé, astérisque à la place.
      fireEvent.change(within(dialog).getByLabelText(/^Motif \(≥ 10/), {
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
      // tournees.statut (onglet Logistique — liste multi-camions), libellé FR (R-UI-0 B2)
      await ouvrirOnglet('Logistique');
      expect(
        await screen.findByText('Planifiée', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      // factures_collectes → factures.statut (onglet Documents), libellé FR (R-UI-0 B2)
      await ouvrirOnglet('Documents');
      expect(
        await screen.findByText('Émise', undefined, ATTENTE_UI),
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
      fireEvent.change(within(dialog).getByLabelText('Nombre de camions*'), {
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
    mode_validation: 'manuel_top1',
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
      // Choix d'une photo visible du client (PATCH /photos/<id>)
      if (url.includes('/photos/') && method === 'PATCH') {
        return ok({ photo: { id: 'p', visible_client: false } });
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

// Valeur d'un item du résumé « Attribution AG » : le <dd> qui suit le <dt> du
// libellé, cherché dans le <dl> du résumé (l'onglet Logistique en porte d'autres).
function valeurResumeAttribution(libelle: string): HTMLElement {
  const resume = screen
    .getByText('Association retenue')
    .closest('dl') as HTMLElement;
  return within(resume).getByText(libelle).nextElementSibling as HTMLElement;
}

describe('M0.6 — fiche collecte Documents/Pack/Attribution/Timeline (BL-P1-BOA-07)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  // Appel de régénération attendu pour un type de document donné.
  const regenerationDemandee = (
    fetchMock: ReturnType<typeof installMock>,
    type: string,
  ): boolean =>
    fetchMock.mock.calls.some(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes(`/documents/${type}/regenerate`) &&
        (c[1] as { method?: string } | undefined)?.method === 'POST',
    );

  it(
    'M0.6 — Bloc 3 Documents : collecte AG avec excédents, une seule ligne Rapport de don (attestation) ; Régénérer demande l’attestation',
    async () => {
      // La fixture porte aussi une ligne de rapport : elle n'est pas affichée.
      const fetchMock = installMock({});
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');

      expect(
        await screen.findByText('Rapport de don', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getAllByText('Rapport de don')).toHaveLength(1);
      expect(screen.getByText('ATT-DON-2026-00001')).toBeInTheDocument();
      expect(screen.queryByText('Rapport RSE')).not.toBeInTheDocument();
      expect(screen.queryByText('Attestation de don')).not.toBeInTheDocument();
      expect(screen.queryByTitle(/Rapport régénéré/)).not.toBeInTheDocument();

      // Deux boutons seulement sur l'onglet : ceux de cette ligne.
      const regenBtns = screen.getAllByRole('button', { name: /Régénérer/ });
      expect(regenBtns).toHaveLength(1);
      fireEvent.click(regenBtns[0]!);
      await waitFor(
        () =>
          expect(regenerationDemandee(fetchMock, 'attestation-don')).toBe(true),
        ATTENTE_UI,
      );
      expect(regenerationDemandee(fetchMock, 'rapport-recyclage-zd')).toBe(
        false,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 Documents : collecte ZD, Rapport RSE et Bordereau ZD ; Régénérer le rapport demande le rapport de recyclage',
    async () => {
      const fetchMock = installMock({
        collecte: baseZd,
        documents: documentsZd,
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');

      expect(
        await screen.findByText('Rapport RSE', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText('Bordereau ZD')).toBeInTheDocument();
      expect(screen.queryByText('Rapport de don')).not.toBeInTheDocument();

      const regenBtns = screen.getAllByRole('button', { name: /Régénérer/ });
      fireEvent.click(regenBtns[0]!);
      await waitFor(
        () =>
          expect(regenerationDemandee(fetchMock, 'rapport-recyclage-zd')).toBe(
            true,
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : picto « régénéré » affiché quand version ≠ initiale',
    async () => {
      installMock({ collecte: baseZd, documents: documentsZd });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      // rapport.version = 2 + regenere_at → picto ⟳ avec title « Rapport régénéré ».
      expect(
        await screen.findByTitle(/Rapport régénéré/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  // Document pas encore produit : un seul texte, quel que soit le statut de la
  // collecte (décision Val 2026-10-09). Lu SOUS le libellé de sa ligne, jamais en
  // pleine page ; « Télécharger » et « Régénérer » restent grisés.
  // Une collecte AG n'a qu'UNE ligne de document, nommée « Rapport de don »
  // (décision Val 2026-10-09), jamais de ligne « Rapport RSE ».
  const sansDocument = {
    rapport: null,
    bordereau: null,
    attestation: null,
    photos: [],
  };
  const TEXTE_DOCUMENT_A_VENIR = 'Généré sous 48h après la collecte';
  const ligneDocument = (libelle: string): HTMLElement =>
    screen.getByText(libelle).parentElement as HTMLElement;
  const boutonsDeLaLigne = (libelle: string): HTMLElement[] =>
    within(ligneDocument(libelle).parentElement as HTMLElement).getAllByRole(
      'button',
    );

  it.each([
    ['AG réalisée', baseAg, ['Rapport de don']],
    ['ZD réalisée', baseZd, ['Rapport RSE', 'Bordereau ZD']],
    [
      'AG pas encore réalisée',
      { ...baseAg, statut: 'validee' },
      ['Rapport de don'],
    ],
    [
      'ZD annulée',
      { ...baseZd, statut: 'annulee' },
      ['Rapport RSE', 'Bordereau ZD'],
    ],
  ])(
    'M0.6 — Bloc 3 : document absent, collecte %s : texte unique sous chaque ligne, boutons grisés',
    async (_cas, collecte, libelles) => {
      installMock({ collecte, documents: sansDocument });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      await screen.findByText(libelles.at(-1)!, undefined, ATTENTE_UI);

      for (const libelle of libelles) {
        expect(
          within(ligneDocument(libelle)).getByText(TEXTE_DOCUMENT_A_VENIR),
        ).toBeInTheDocument();
        const boutons = boutonsDeLaLigne(libelle);
        expect(boutons.map((b) => b.textContent)).toEqual([
          'Télécharger',
          'Régénérer',
        ]);
        for (const bouton of boutons) expect(bouton).toBeDisabled();
      }
      expect(screen.getAllByText(TEXTE_DOCUMENT_A_VENIR)).toHaveLength(
        libelles.length,
      );
      expect(screen.queryByText(/Non encore généré/)).not.toBeInTheDocument();
      if (!libelles.includes('Rapport RSE')) {
        expect(screen.queryByText('Rapport RSE')).not.toBeInTheDocument();
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : collecte AG avec excédents, rapport en base sans PDF : aucune ligne Rapport RSE',
    async () => {
      // Ce qu'ont laissé d'anciens batchs AG : une ligne rapports_rse, jamais de PDF.
      installMock({
        collecte: { ...baseAg, statut: 'cloturee' },
        documents: {
          ...documentsAg,
          rapport: {
            ...documentsAg.rapport,
            version: 1,
            genere_at: null,
            regenere_at: null,
            pdf_url: null,
          },
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      await screen.findByText('ATT-DON-2026-00001', undefined, ATTENTE_UI);

      expect(screen.queryByText('Rapport RSE')).not.toBeInTheDocument();
      expect(
        screen.queryByText('En attente de génération'),
      ).not.toBeInTheDocument();
      // Seule ligne de document : le rapport de don, téléchargeable.
      expect(screen.getAllByText('Rapport de don')).toHaveLength(1);
      const [telecharger] = boutonsDeLaLigne('Rapport de don');
      expect(telecharger).toBeEnabled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : collecte AG sans excédents, une seule ligne Rapport de don servie par le rapport sans excédent',
    async () => {
      const fetchMock = installMock({
        collecte: { ...baseAg, statut: 'realisee_sans_collecte' },
        documents: {
          ...sansDocument,
          rapport: {
            id: 'r-sans',
            version: 1,
            disponible_a: '2026-05-11T06:00:00Z',
            genere_at: '2026-05-11T06:00:00Z',
            regenere_at: null,
            consulte_par_user_at: null,
            pdf_url: 'rapports/r-sans.pdf',
          },
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      await screen.findByText('Rapport de don', undefined, ATTENTE_UI);

      // Une seule ligne, sous le même nom que pour une collecte avec excédents.
      expect(screen.getAllByText('Rapport de don')).toHaveLength(1);
      expect(screen.queryByText('Rapport RSE')).not.toBeInTheDocument();
      expect(
        within(ligneDocument('Rapport de don')).getByText('Disponible'),
      ).toBeInTheDocument();

      // Télécharger sert le rapport ; Régénérer demande SON type de document.
      const [telecharger, regenerer] = boutonsDeLaLigne('Rapport de don');
      fireEvent.click(telecharger!);
      await waitFor(
        () =>
          expect(
            fetchMock.mock.calls.some(
              (c) => c[0] === '/api/v1/admin/rapports-rse/r-sans/download',
            ),
          ).toBe(true),
        ATTENTE_UI,
      );
      fireEvent.click(regenerer!);
      await waitFor(
        () =>
          expect(
            regenerationDemandee(fetchMock, 'rapport-evenement-sans-excedent'),
          ).toBe(true),
        ATTENTE_UI,
      );
      expect(regenerationDemandee(fetchMock, 'rapport-recyclage-zd')).toBe(
        false,
      );
      expect(regenerationDemandee(fetchMock, 'attestation-don')).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : collecte AG sans excédents, rapport pas encore produit : texte unique sous Rapport de don',
    async () => {
      installMock({
        collecte: { ...baseAg, statut: 'realisee_sans_collecte' },
        documents: sansDocument,
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      await screen.findByText('Rapport de don', undefined, ATTENTE_UI);

      expect(screen.getAllByText('Rapport de don')).toHaveLength(1);
      expect(
        within(ligneDocument('Rapport de don')).getByText(
          TEXTE_DOCUMENT_A_VENIR,
        ),
      ).toBeInTheDocument();
      for (const bouton of boutonsDeLaLigne('Rapport de don')) {
        expect(bouton).toBeDisabled();
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : document présent : le texte du document absent ne s’affiche pas',
    async () => {
      installMock({});
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');
      await screen.findByText('ATT-DON-2026-00001', undefined, ATTENTE_UI);

      expect(
        screen.queryByText(TEXTE_DOCUMENT_A_VENIR),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  // (Bloc « Pack AG » retiré de la fiche — décision Val ; ex-tests Bloc 4 supprimés.)

  it(
    'M0.6 — Bloc 5 Attribution AG : association + transporteur retenus (attribution intégrée à la fiche, plus de stub « algo V2 »)',
    async () => {
      installMock({
        collecte: {
          ...baseAg,
          attributions_antgaspi: {
            ...baseAg.attributions_antgaspi,
            // Valeur réelle de l'enum, et instant où le jour de Paris (2 mai,
            // 00 h 30) n'est plus celui d'UTC (1er mai, 22 h 30).
            mode_validation: 'manuel_override',
            valide_at: '2026-05-01T22:30:00Z',
          },
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      expect(
        await screen.findByText('Attribution AG', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      // Association + transporteur retenus (embed attributions_antgaspi), lus
      // sous leur libellé : l'en-tête de la fiche porte aussi le nom de
      // l'association, il ne prouve rien du résumé.
      expect(valeurResumeAttribution('Association retenue')).toHaveTextContent(
        /^Les Restos du Cœur$/,
      );
      expect(valeurResumeAttribution('Transporteur retenu')).toHaveTextContent(
        /^A Toutes!$/,
      );
      // Validation (§06.06 Bloc 5) : mode + date de validation, au jour de Paris.
      expect(valeurResumeAttribution('Validation')).toHaveTextContent(
        /^manuel_override — 02\/05\/2026$/,
      );
      expect(
        screen.queryByText('En attente de validation'),
      ).not.toBeInTheDocument();
      // Volumes : estimé (collecte) puis réalisé (attribution), dans cet ordre.
      expect(
        valeurResumeAttribution('Volume repas (estimé / réalisé)'),
      ).toHaveTextContent(/^50 \/ 42$/);
      // L'attribution se fait dans la fiche (décision Val 2026-10-01) : plus de
      // lien vers un écran dédié.
      expect(
        screen.queryByRole('link', { name: /attribution compl/i }),
      ).not.toBeInTheDocument();
      // Le stub V2 a disparu.
      expect(
        screen.queryByText(/algo V2.*Non disponible en V1/),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 5 Attribution AG : validation en attente (valide_at nul) et volume réalisé absent',
    async () => {
      // Association retenue mais attribution non datée : la colonne `valide_at`
      // est nullable (§04), le résumé le dit au lieu d'afficher un mode sans date.
      installMock({
        collecte: {
          ...baseAg,
          statut: 'programmee',
          attributions_antgaspi: {
            ...baseAg.attributions_antgaspi,
            mode_validation: 'manuel_top1',
            valide_at: null,
            volume_repas_realise: null,
          },
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      await screen.findByText('Attribution AG', undefined, ATTENTE_UI);

      // Le badge seul : ni mode ni date tant que la validation n'est pas datée.
      expect(valeurResumeAttribution('Validation')).toHaveTextContent(
        /^En attente de validation$/,
      );
      // Volume estimé affiché, réalisé pas encore remonté → tiret.
      expect(
        valeurResumeAttribution('Volume repas (estimé / réalisé)'),
      ).toHaveTextContent(/^50 \/ —$/);
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
      await screen.findByText('Rapport de don', undefined, ATTENTE_UI);

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

  // Décisions Val 2026-10-07 : le client ne voit que les photos choisies par
  // l'équipe Savr dans cette galerie, 2 au maximum.
  const photo = (id: string, visible_client: boolean) => ({
    id,
    content_type: 'image/jpeg',
    created_at: '2026-07-16T00:05:00Z',
    visible_client,
    url: null,
  });

  it(
    'M0.6 — Bloc 3 : galerie — une case « Visible du client » par photo, compteur, cases grisées une fois 2 photos choisies',
    async () => {
      installMock({
        documents: {
          ...documentsAg,
          photos: [photo('p1', true), photo('p2', true), photo('p3', false)],
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');

      const cases = await screen.findAllByRole(
        'checkbox',
        { name: 'Visible du client' },
        ATTENTE_UI,
      );
      expect(cases).toHaveLength(3);
      expect(cases.map((c) => c.getAttribute('aria-checked'))).toEqual([
        'true',
        'true',
        'false',
      ]);
      // Les 2 places sont prises : la 3e photo ne peut pas être cochée, les
      // deux choisies restent décochables.
      expect(cases.map((c) => (c as HTMLButtonElement).disabled)).toEqual([
        false,
        false,
        true,
      ]);
      expect(
        screen.getByText(/Le client ne voit que les photos cochées/),
      ).toHaveTextContent('2 sur 2 choisies');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : galerie — avec une place libre, une photo non choisie peut être cochée',
    async () => {
      installMock({
        documents: {
          ...documentsAg,
          photos: [photo('p1', true), photo('p2', false)],
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');

      const cases = await screen.findAllByRole(
        'checkbox',
        { name: 'Visible du client' },
        ATTENTE_UI,
      );
      expect(cases.map((c) => (c as HTMLButtonElement).disabled)).toEqual([
        false,
        false,
      ]);
      expect(
        screen.getByText(/Le client ne voit que les photos cochées/),
      ).toHaveTextContent('1 sur 2 choisie.');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Bloc 3 : galerie — cocher ou décocher une photo envoie un PATCH /photos/<id> avec visible_client',
    async () => {
      const fetchMock = installMock({
        documents: {
          ...documentsAg,
          photos: [photo('p 1', true), photo('p2', false)],
        },
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Documents');

      const cases = await screen.findAllByRole(
        'checkbox',
        { name: 'Visible du client' },
        ATTENTE_UI,
      );
      fireEvent.click(cases[0]!);

      await waitFor(() => {
        const call = fetchMock.mock.calls.find(
          (c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH',
        );
        expect(call).toBeTruthy();
        // Identifiant encodé dans le chemin (jamais interpolé brut).
        expect(call![0]).toBe('/api/v1/admin/collectes/c1/photos/p%201');
        expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
          visible_client: false,
        });
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
      // Une collecte ZD n'a pas de rapport de don (ligne AG masquée).
      expect(screen.queryByText('Rapport de don')).not.toBeInTheDocument();
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
      await screen.findByText('Rapport de don', undefined, ATTENTE_UI);
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
    'M0.6 — Bloc 5 : la recommandation n°1 affiche ses scores détaillés (distance + capacité, §06.06 l.253)',
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
      // Formulaire intégré (décision Val 2026-10-01) : la n°1 est la carte
      // « Recommandée » avec ses scores ; les autres sont dans la liste.
      expect(
        await screen.findByText('3,2 km', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText(/capacité 200/)).toBeInTheDocument();
      expect(screen.queryAllByRole('link', { name: 'Choisir' })).toHaveLength(
        0,
      );
      expect(screen.getByText('Recommandée')).toBeInTheDocument();
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
      // Les coordonnées chauffeur ont quitté l'onglet Informations pour le bloc
      // « Chauffeur » de l'onglet Logistique (décision Val 2026-10-02).
      expect(within(infos).queryByText(/Informations chauffeur/)).toBeNull();
      expect(
        within(infos).queryByText(/aucune information chauffeur/),
      ).toBeNull();
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
      // Attribution validée : le résumé + le bloc dispatch (renvoi / changement
      // de prestataire), jamais le formulaire d'attribution intégré.
      expect(screen.getByText('Prestataire & Dispatch')).toBeInTheDocument();
      expect(
        screen.queryByLabelText('Type de véhicule souhaité'),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Grand en-tête AG (décision Val 2026-10-01) : badge, réf., lieu, date · heure, pax, traiteur, ville, prestataire, association — sans colonne résumé',
    async () => {
      installMock({});
      render(<CollecteDetailPanel collecteId="c1" />);
      const sousLigne = await screen.findByTestId(
        'fiche-admin-sous-ligne',
        {},
        ATTENTE_UI,
      );
      const enTete = sousLigne.closest('header') as HTMLElement;
      expect(
        within(enTete).getByTestId('badge-type-collecte'),
      ).toHaveTextContent('Anti-Gaspi');
      expect(within(enTete).getByText('Réf. TMS-9')).toBeInTheDocument();
      expect(
        within(enTete).getByRole('heading', { name: 'Pavillon' }),
      ).toBeInTheDocument();
      expect(sousLigne).toHaveTextContent('Dimanche 10 mai 2026 · 19:00');
      expect(sousLigne).toHaveTextContent("jusqu'à 80 pax");
      expect(sousLigne).toHaveTextContent('Traiteur Beta');
      expect(sousLigne).toHaveTextContent('Paris');
      expect(sousLigne).toHaveTextContent('Prestataire non attribué');
      // Statut TMS en badge coloré (pas en texte brut).
      expect(within(sousLigne).getByText('Acceptée presta').className).toMatch(
        /success/,
      );
      expect(sousLigne).toHaveTextContent('Les Restos du Cœur');
      // Frise compacte dans l'en-tête ; plus de colonne résumé.
      expect(
        within(enTete).getByRole('list', { name: 'Avancement de la collecte' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('complementary', { name: 'Résumé de la collecte' }),
      ).toBeNull();
      // Onglets seuls, en barre horizontale.
      expect(
        screen
          .getByRole('tablist', { name: 'Sections de la fiche collecte' })
          .getAttribute('aria-orientation'),
      ).toBe('horizontal');
      // « Forcer le statut » dans le pied d'actions.
      expect(
        screen
          .getByRole('button', { name: /Forcer le statut/ })
          .closest('footer'),
      ).not.toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Grand en-tête ZD : badge Zéro Déchet, pas de ligne association ; « dirty TMS » en sur-titre',
    async () => {
      installMock({ collecte: { ...baseZd, dirty_tms: true } });
      render(<CollecteDetailPanel collecteId="c1" />);
      const sousLigne = await screen.findByTestId(
        'fiche-admin-sous-ligne',
        {},
        ATTENTE_UI,
      );
      const enTete = sousLigne.closest('header') as HTMLElement;
      expect(
        within(enTete).getByTestId('badge-type-collecte'),
      ).toHaveTextContent('Zéro Déchet');
      expect(
        within(enTete).getByText('Modifiée — renvoi requis'),
      ).toBeInTheDocument();
      expect(sousLigne).not.toHaveTextContent('Association');
      expect(sousLigne).not.toHaveTextContent('Les Restos du Cœur');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — onLoaded remonte le titre accessible « Collecte … jusqu’à N pax »',
    async () => {
      const onLoaded = vi.fn();
      installMock({ collecte: baseAg });
      render(<CollecteDetailPanel collecteId="c1" onLoaded={onLoaded} />);
      await waitFor(() => expect(onLoaded).toHaveBeenCalled(), ATTENTE_UI);
      const arg = onLoaded.mock.calls.at(-1)?.[0] as { title: string };
      expect(arg.title).toContain('Collecte Anti-Gaspi');
      expect(arg.title).toContain("jusqu'à 80\u00a0pax"); // fmtPax : espace insécable
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

// ============================================================================
// Bloc « Chauffeur » de l'onglet Logistique (décision Val 2026-10-02) : même
// bloc que la fiche client (§06.04 « Logistique ») — nom, plaque, téléphone par
// camion, remontés automatiquement du prestataire (MTS-1 référentiel carrier,
// Everest coursier) et complétés par l'Admin. Remplace la card « Informations
// chauffeur » de l'onglet Informations (réservée au contrôle d'accès).
// ============================================================================

describe('M0.6 — onglet Logistique : bloc Chauffeur', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const tourneeMts1 = {
    rang: 1,
    tournees: {
      id: 'tour-1',
      statut: 'planifiee',
      tms_reference: 'TMS-42',
      external_ref_commande: 'CMD-42',
      plaque_immatriculation: 'AB-123-CD',
      chauffeur_nom: 'Paul Martin',
      chauffeur_telephone: '0612345678',
      accompagnant_nom: null,
      accompagnant_telephone: null,
      type_vehicule: 'camion_16m3',
    },
  };

  it(
    'sans tournée ni prestataire : une ligne « Camion » en attente, saisie impossible (« Attribuez d’abord un prestataire »)',
    async () => {
      // Un camion demandé (N = 1), aucune tournée, aucun prestataire posé :
      // la ligne existe (C2 Val 2026-10-06) mais la tournée ne peut pas être
      // créée sans prestataire (tournees.prestataire_logistique_id NOT NULL).
      mockFetch({ ...collecteAg, collecte_tournees: [] });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const bloc = await screen.findByTestId(
        'bloc-chauffeur',
        undefined,
        ATTENTE_UI,
      );
      expect(
        within(bloc).getByRole('heading', { name: 'Chauffeur' }),
      ).toBeInTheDocument();
      expect(within(bloc).getAllByTestId('camion-chauffeur')).toHaveLength(1);
      expect(
        within(bloc).getByText(/Attribuez d’abord un prestataire/),
      ).toBeInTheDocument();
      expect(
        within(bloc).getByText(/Tournée pas encore créée par le prestataire/),
      ).toBeInTheDocument();
      // Chauffeur, plaque, téléphone : trois « En attente », aucune saisie.
      expect(within(bloc).getAllByText('En attente')).toHaveLength(3);
      expect(
        screen.queryByRole('button', { name: 'Modifier les coordonnées' }),
      ).toBeNull();
      expect(screen.queryByText('Chauffeur pas encore affecté')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'tournée MTS-1 renseignée : nom, plaque et téléphone cliquable ; sans contrôle d’accès, pas de mention email',
    async () => {
      mockFetch({
        ...collecteAg,
        prestataire_logistique_id: 'presta-mts1',
        prestataire_actuel: {
          transporteur_id: 't-mts1',
          nom: 'Strike',
          type_tms: 'mts1',
        },
        collecte_tournees: [tourneeMts1],
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const bloc = (await screen.findByTestId(
        'camion-chauffeur',
        undefined,
        ATTENTE_UI,
      )) as HTMLElement;
      // Le canal nommé : MTS-1 (jamais « du prestataire » générique).
      expect(
        screen.getByText(/remontent automatiquement de MTS-1/),
      ).toBeInTheDocument();
      expect(within(bloc).getByText('Paul Martin')).toBeInTheDocument();
      expect(within(bloc).getByText('AB-123-CD')).toBeInTheDocument();
      expect(
        within(bloc).getByRole('link', { name: '0612345678' }),
      ).toHaveAttribute('href', 'tel:0612345678');
      expect(within(bloc).queryByText('En attente')).toBeNull();
      // Un seul camion : pas d'en-tête « Camion 1 ».
      expect(within(bloc).queryByText(/^Camion 1$/)).toBeNull();
      // Titre au singulier (un seul camion) — « Chauffeur » est aussi le label
      // du champ, d'où getAll.
      expect(screen.queryByText('Chauffeurs')).toBeNull();
      expect(screen.queryByText(/contrôle d’accès/)).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Modifier les coordonnées' }),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'vélo cargo sans plaque, coursier pas encore communiqué : « Sans objet (vélo cargo) » et « En attente » sur nom et téléphone',
    async () => {
      mockFetch({
        ...collecteAg,
        collecte_tournees: [
          {
            ...tourneeMts1,
            tournees: {
              ...tourneeMts1.tournees,
              plaque_immatriculation: null,
              chauffeur_nom: null,
              chauffeur_telephone: null,
              type_vehicule: 'velo_cargo',
            },
          },
        ],
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const bloc = (await screen.findByTestId(
        'camion-chauffeur',
        undefined,
        ATTENTE_UI,
      )) as HTMLElement;
      expect(
        within(bloc).getByText('Sans objet (vélo cargo)'),
      ).toBeInTheDocument();
      expect(within(bloc).getAllByText('En attente')).toHaveLength(2);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux camions chez un transporteur manuel : « Chauffeurs », en-tête « Camion N », accompagnant affiché, coordonnées « à saisir par l’équipe Ops »',
    async () => {
      mockFetch({
        ...collecteAg,
        prestataire_logistique_id: null,
        prestataire_actuel: {
          transporteur_id: 't-province',
          nom: 'Transports Dupont',
          type_tms: 'par_mail',
        },
        collecte_tournees: [
          tourneeMts1,
          {
            rang: 2,
            tournees: {
              ...tourneeMts1.tournees,
              id: 'tour-2',
              chauffeur_nom: 'Léa Durand',
              chauffeur_telephone: null,
              plaque_immatriculation: 'CD-456-EF',
              accompagnant_nom: 'Marc Petit',
              accompagnant_telephone: '0699887766',
            },
          },
        ],
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const camions = (await screen.findAllByTestId(
        'camion-chauffeur',
        undefined,
        ATTENTE_UI,
      )) as HTMLElement[];
      expect(camions).toHaveLength(2);
      expect(screen.getByText('Chauffeurs')).toBeInTheDocument();
      expect(within(camions[0]!).getByText('Camion 1')).toBeInTheDocument();
      expect(within(camions[1]!).getByText('Camion 2')).toBeInTheDocument();
      // Accompagnant du camion 2, absent du camion 1.
      expect(within(camions[1]!).getByText('Marc Petit')).toBeInTheDocument();
      // Plus de téléphone d'accompagnant à l'écran (retiré par Val 2026-10-06).
      expect(within(camions[1]!).queryByText('Tél. accompagnant')).toBeNull();
      expect(within(camions[1]!).queryByText('0699887766')).toBeNull();
      expect(within(camions[0]!).queryByText('Accompagnant')).toBeNull();
      // Transporteur manuel : rien ne remonte automatiquement.
      expect(screen.getByText(/à saisir par l’équipe Ops/)).toBeInTheDocument();
      expect(screen.queryByText(/remontent automatiquement/)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte terminée sans tournée : « Aucun chauffeur enregistré », aucune phrase au futur',
    async () => {
      mockFetch({ ...collecteAg, statut: 'annulee', collecte_tournees: [] });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      expect(
        await screen.findByText(
          'Aucun chauffeur enregistré',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Aucune tournée enregistrée pour cette collecte.'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/pourront être saisies/)).toBeNull();
      expect(screen.queryByText('Chauffeur pas encore affecté')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux camions demandés, une seule tournée, seul le camion 1 corrigé : le camion 2 laissé vide n’est pas envoyé (aucune tournée vide créée)',
    async () => {
      const fetchMock = mockFetch({
        ...collecteAg,
        nb_camions_demande: 2,
        prestataire_logistique_id: 'presta-1',
        prestataire_actuel: {
          transporteur_id: 't-1',
          nom: 'Transporteur manuel',
          type_tms: 'autre',
        },
        collecte_tournees: [tourneeMts1],
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      await screen.findByTestId('bloc-chauffeur', undefined, ATTENTE_UI);

      fireEvent.click(
        screen.getByRole('button', { name: 'Modifier les coordonnées' }),
      );
      const noms = screen.getAllByLabelText('Nom du chauffeur');
      expect(noms).toHaveLength(2);
      fireEvent.change(noms[0]!, { target: { value: 'Paul Martin-Durand' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          (c) =>
            String(c[0]).endsWith('/infos-acces') &&
            (c[1] as { method?: string } | undefined)?.method === 'PATCH',
        );
        expect(patch).toBeTruthy();
        const body = JSON.parse((patch![1] as { body: string }).body) as {
          tournees: Array<Record<string, unknown>>;
        };
        expect(body.tournees).toHaveLength(1);
        expect(body.tournees[0]).toMatchObject({
          tournee_id: 'tour-1',
          chauffeur_nom: 'Paul Martin-Durand',
        });
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte terminée, deux camions demandés, une seule tournée : une seule ligne, et la saisie ne concerne que la tournée existante (PATCH sans rang)',
    async () => {
      const fetchMock = mockFetch({
        ...collecteAg,
        statut: 'realisee',
        nb_camions_demande: 2,
        prestataire_logistique_id: 'presta-1',
        prestataire_actuel: {
          transporteur_id: 't-1',
          nom: 'Transporteur manuel',
          type_tms: 'autre',
        },
        collecte_tournees: [tourneeMts1],
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const bloc = await screen.findByTestId(
        'bloc-chauffeur',
        undefined,
        ATTENTE_UI,
      );
      expect(
        within(bloc).getByRole('heading', { name: 'Chauffeur' }),
      ).toBeInTheDocument();
      expect(within(bloc).getAllByTestId('camion-chauffeur')).toHaveLength(1);
      expect(within(bloc).queryByText('Camion 2')).toBeNull();
      expect(within(bloc).queryByText(/Tournée pas encore créée/)).toBeNull();

      fireEvent.click(
        screen.getByRole('button', { name: 'Modifier les coordonnées' }),
      );
      expect(screen.getAllByLabelText('Nom du chauffeur')).toHaveLength(1);
      fireEvent.change(screen.getByLabelText('Nom du chauffeur'), {
        target: { value: 'Paul Martin' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          (c) =>
            String(c[0]).endsWith('/infos-acces') &&
            (c[1] as { method?: string } | undefined)?.method === 'PATCH',
        );
        expect(patch).toBeTruthy();
        const body = JSON.parse((patch![1] as { body: string }).body) as {
          tournees: Array<Record<string, unknown>>;
        };
        expect(body.tournees).toHaveLength(1);
        expect(body.tournees[0]).toMatchObject({ tournee_id: 'tour-1' });
        expect(body.tournees[0]).not.toHaveProperty('rang');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'erreur à l’enregistrement (le prestataire a créé la tournée du camion 2 entre-temps) : message affiché, fiche rechargée, la saisie se rattache à la tournée créée — nom saisi conservé, plaque remontée reprise',
    async () => {
      const avant = {
        ...collecteAg,
        nb_camions_demande: 2,
        prestataire_logistique_id: 'presta-1',
        prestataire_actuel: {
          transporteur_id: 't-1',
          nom: 'Transporteur manuel',
          type_tms: 'autre',
        },
        collecte_tournees: [tourneeMts1],
      };
      const apres = {
        ...avant,
        collecte_tournees: [
          tourneeMts1,
          {
            rang: 2,
            tournees: {
              ...tourneeMts1.tournees,
              id: 'tour-2',
              plaque_immatriculation: 'ZZ-999-ZZ',
              chauffeur_nom: null,
              chauffeur_telephone: null,
            },
          },
        ],
      };
      let patchs = 0;
      let fiche: object = avant;
      const fetchMock = mockFetch(() => fiche) as unknown as ReturnType<
        typeof vi.fn
      >;
      const base = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(
        (url: string, opts?: { method?: string; body?: string }) => {
          if (url.endsWith('/infos-acces') && opts?.method === 'PATCH') {
            patchs += 1;
            if (patchs === 1) {
              // Le rang 2 vient d'être pris par le prestataire.
              fiche = apres;
              return Promise.resolve({
                ok: false,
                status: 409,
                json: async () => ({
                  error:
                    'Le prestataire vient de créer la tournée du camion 2 : rechargez la fiche avant de saisir.',
                }),
              });
            }
            return Promise.resolve({
              ok: true,
              json: async () => ({ email_envoye: false }),
            });
          }
          return base(url, opts);
        },
      );
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');
      await screen.findByTestId('bloc-chauffeur', undefined, ATTENTE_UI);

      fireEvent.click(
        screen.getByRole('button', { name: 'Modifier les coordonnées' }),
      );
      fireEvent.change(screen.getAllByLabelText('Nom du chauffeur')[1]!, {
        target: { value: 'Léa Durand' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      // Erreur affichée, formulaire toujours ouvert, fiche rechargée : la
      // plaque remontée par le prestataire apparaît dans le champ laissé vide.
      expect(
        await screen.findByText(/rechargez la fiche/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.getAllByLabelText('Plaque d’immatriculation')[1],
        ).toHaveValue('ZZ-999-ZZ');
      }, ATTENTE_UI);
      expect(screen.getAllByLabelText('Nom du chauffeur')[1]).toHaveValue(
        'Léa Durand',
      );

      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => {
        const calls = fetchMock.mock.calls.filter(
          (c) =>
            String(c[0]).endsWith('/infos-acces') &&
            (c[1] as { method?: string } | undefined)?.method === 'PATCH',
        );
        expect(calls).toHaveLength(2);
        const body = JSON.parse((calls[1]![1] as { body: string }).body) as {
          tournees: Array<Record<string, unknown>>;
        };
        const camion2 = body.tournees.find((t) => t.tournee_id === 'tour-2');
        expect(camion2).toMatchObject({
          tournee_id: 'tour-2',
          chauffeur_nom: 'Léa Durand',
          plaque_immatriculation: 'ZZ-999-ZZ',
        });
        expect(body.tournees.some((t) => 'rang' in t)).toBe(false);
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux camions demandés, une seule tournée : deux lignes, la saisie du camion 2 crée sa tournée (PATCH avec rang)',
    async () => {
      // Cas écran « Palais des Congrès » (Val 2026-10-06) : N = 2, l'adapter
      // n'a créé que la tournée du rang 1 → le rang 2 est saisissable quand
      // même, la route crée sa tournée (option C2).
      const fetchMock = mockFetch({
        ...collecteAg,
        nb_camions_demande: 2,
        prestataire_logistique_id: 'presta-mts1',
        prestataire_actuel: {
          transporteur_id: 't-strike',
          nom: 'Strike',
          type_tms: 'mts1',
        },
        collecte_tournees: [tourneeMts1],
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      const bloc = await screen.findByTestId(
        'bloc-chauffeur',
        undefined,
        ATTENTE_UI,
      );
      expect(
        within(bloc).getByRole('heading', { name: 'Chauffeurs' }),
      ).toBeInTheDocument();
      expect(within(bloc).getAllByTestId('camion-chauffeur')).toHaveLength(2);
      expect(within(bloc).getByText('Camion 2')).toBeInTheDocument();
      expect(
        within(bloc).getByText(/Tournée pas encore créée par le prestataire/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Attribuez d’abord un prestataire/)).toBeNull();

      fireEvent.click(
        screen.getByRole('button', { name: 'Modifier les coordonnées' }),
      );
      expect(
        screen.getByText(/tournée créée à l’enregistrement/),
      ).toBeInTheDocument();
      const noms = screen.getAllByLabelText('Nom du chauffeur');
      expect(noms).toHaveLength(2);
      fireEvent.change(noms[1]!, { target: { value: 'Léa Durand' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          (c) =>
            String(c[0]).endsWith('/infos-acces') &&
            (c[1] as { method?: string } | undefined)?.method === 'PATCH',
        );
        expect(patch).toBeTruthy();
        const body = JSON.parse((patch![1] as { body: string }).body) as {
          tournees: Array<Record<string, unknown>>;
        };
        expect(body.tournees).toHaveLength(2);
        expect(body.tournees[0]).toMatchObject({ tournee_id: 'tour-1' });
        expect(body.tournees[1]).toMatchObject({
          rang: 2,
          chauffeur_nom: 'Léa Durand',
        });
        expect(body.tournees[1]).not.toHaveProperty('tournee_id');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'contrôle d’accès requis : mention de l’email récap, « Modifier les coordonnées » ouvre le formulaire et PATCH infos-acces',
    async () => {
      const fetchMock = mockFetch({
        ...collecteAg,
        controle_acces_requis: true,
        infos_acces_email_envoye_at: null,
        collecte_tournees: [
          {
            ...tourneeMts1,
            tournees: {
              ...tourneeMts1.tournees,
              chauffeur_nom: null,
              chauffeur_telephone: null,
            },
          },
        ],
      });
      render(<CollecteDetailPanel collecteId="c1" />);
      await ouvrirOnglet('Logistique');

      expect(
        await screen.findByText(
          /exige un contrôle d’accès/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/infos à compléter avant envoi/),
      ).toBeInTheDocument();
      // Un seul camion, nom et téléphone manquants → « En attente » ×2.
      expect(screen.getAllByText('En attente')).toHaveLength(2);

      fireEvent.click(
        screen.getByRole('button', { name: 'Modifier les coordonnées' }),
      );
      fireEvent.change(screen.getByLabelText('Nom du chauffeur'), {
        target: { value: 'Paul Martin' },
      });
      fireEvent.change(screen.getByLabelText('Téléphone du chauffeur'), {
        target: { value: '0612345678' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          (c) =>
            String(c[0]).endsWith('/infos-acces') &&
            (c[1] as { method?: string } | undefined)?.method === 'PATCH',
        );
        expect(patch).toBeTruthy();
        const body = JSON.parse((patch![1] as { body: string }).body) as {
          tournees: Array<Record<string, string>>;
        };
        expect(body.tournees).toHaveLength(1);
        expect(body.tournees[0]).toMatchObject({
          tournee_id: 'tour-1',
          plaque_immatriculation: 'AB-123-CD',
          chauffeur_nom: 'Paul Martin',
          chauffeur_telephone: '0612345678',
        });
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );
});
