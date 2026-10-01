/**
 * M3.1 — Pop-up fiche collecte client (§06.04 refonte Val 2026-09-29), côté API :
 * chargeur commun `chargerFicheCollecteClient` via la route traiteur, demande
 * urgente des coordonnées (Q3) et fermeture de l'écriture client de
 * `notes_internes` (arbitrage C1).
 *
 * Exigences sécurité de la revue du sync 2026-09-29 vérifiées ICI (pas à l'écran) :
 *  · ni notes internes ni nom de prestataire dans la réponse ;
 *  · téléphone du chauffeur servi seulement en programmee / validee / en_cours ;
 *  · demande urgente : visibilité RLS AVANT l'écriture service-role, aucun texte
 *    libre lu, « 1 ouverte par collecte » porté par la base (23505 = déjà
 *    demandée), ni email ni Slack ;
 *  · documents lus sous la RLS du traiteur : l'attestation de don du donneur
 *    d'ordre n'est pas servie au traiteur opérationnel (D12).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  makeClient,
  ligneCollecte,
  reserveEvenement,
} from '../helpers/fiche-client-mock';
import { etatRapport } from '@/lib/collectes/fiche-client-types';

let rls = makeClient();
let admin = makeClient();
const mockRequireUser = vi.fn();
const mockSendEmail = vi.fn();
const mockSendAlert = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));
vi.mock('@savr/shared/src/alerting/slack.js', () => ({
  sendAlert: (...a: unknown[]) => mockSendAlert(...a),
}));

function req(path: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`http://localhost${path}`, {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined
      ? {
          body: JSON.stringify(init.body),
          headers: { 'Content-Type': 'application/json' },
        }
      : {}),
  });
}

async function getFiche() {
  const { GET } = await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
  const res = await GET(req('/api/v1/traiteur/collectes/c1'), {
    params: Promise.resolve({ id: 'c1' }),
  });
  return { res, json: (await res.json()) as { data: Record<string, unknown> } };
}

async function postUrgence(body?: unknown) {
  const { POST } =
    await import('@/app/api/v1/traiteur/collectes/[id]/coordonnees-urgence/route.js');
  return POST(
    req('/api/v1/traiteur/collectes/c1/coordonnees-urgence', {
      method: 'POST',
      body,
    }),
    { params: Promise.resolve({ id: 'c1' }) },
  );
}

function auth(role = 'traiteur_manager', org = 'org-1', user = 'user-1') {
  mockRequireUser.mockResolvedValue({
    ctx: { userId: user, role, organisationId: org },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  auth();
});

describe('M3.1 / fiche client — réponse GET (sécurité)', () => {
  it('M3.1/fiche_get_sans_notes_ni_prestataire — colonnes Admin et prestataire jamais servies', async () => {
    rls.results.collectes = {
      data: {
        ...ligneCollecte(),
        // Même si une ligne en portait, rien ne doit sortir.
        notes_internes: 'NOTE ADMIN SECRÈTE',
      },
      error: null,
    };
    admin.results.collecte_tournees = {
      data: [
        {
          rang: 1,
          tournee: {
            plaque_immatriculation: 'AB-123-CD',
            chauffeur_nom: 'Léa',
            chauffeur_telephone: '0612345678',
            type_vehicule: 'camionnette',
            prestataire_logistique_id: 'p1',
          },
        },
      ],
      error: null,
    };
    const { res, json } = await getFiche();
    expect(res.status).toBe(200);
    const texte = JSON.stringify(json);
    expect(texte).not.toContain('notes_internes');
    expect(texte).not.toContain('NOTE ADMIN SECRÈTE');
    expect(texte).not.toContain('prestataire');
    // La lecture elle-même ne demande pas la colonne.
    expect(rls.selects.collectes?.[0]).not.toContain('notes_internes');
    expect(admin.selects.collecte_tournees?.[0]).not.toContain('prestataire');
    expect(admin.calls).not.toContain('prestataires');
  });

  it.each(['programmee', 'validee', 'en_cours'])(
    'M3.1/fiche_get_telephone_fenetre — %s : téléphone du chauffeur servi',
    async (statut) => {
      rls.results.collectes = { data: ligneCollecte({ statut }), error: null };
      admin.results.collecte_tournees = {
        data: [
          {
            rang: 1,
            tournee: {
              plaque_immatriculation: 'AB-123-CD',
              chauffeur_nom: 'Léa',
              chauffeur_telephone: '0612345678',
              type_vehicule: 'camionnette',
            },
          },
        ],
        error: null,
      };
      const { json } = await getFiche();
      const t = json.data.tournees as Array<{ chauffeur_telephone: string }>;
      expect(t[0]?.chauffeur_telephone).toBe('0612345678');
    },
  );

  it.each(['realisee', 'cloturee', 'annulee', 'realisee_sans_collecte'])(
    'M3.1/fiche_get_telephone_hors_fenetre — %s : aucun camion lu ni servi',
    async (statut) => {
      rls.results.collectes = { data: ligneCollecte({ statut }), error: null };
      // Piège : la base renverrait un téléphone si on la lisait.
      admin.results.collecte_tournees = {
        data: [
          {
            rang: 1,
            tournee: {
              plaque_immatriculation: 'AB-123-CD',
              chauffeur_nom: 'Léa',
              chauffeur_telephone: '0612345678',
              type_vehicule: 'camionnette',
            },
          },
        ],
        error: null,
      };
      const { json } = await getFiche();
      expect(json.data.tournees).toEqual([]);
      expect(admin.calls).not.toContain('collecte_tournees');
      expect(JSON.stringify(json)).not.toContain('0612345678');
    },
  );

  it('M3.1/fiche_get_invisible_404_sans_service_role — collecte hors périmètre : 404, aucune lecture service-role', async () => {
    rls.results.collectes = { data: null, error: null };
    const { res } = await getFiche();
    expect(res.status).toBe(404);
    expect(admin.calls).toHaveLength(0);
  });
});

// Colonnes d'`evenements` hors GRANT SELECT authenticated (migration
// 20261001103000, arbitrages Val C2/C3/C5) : la lecture RLS ne les demande plus,
// le chargeur les lit en service-role pour qui y a titre.
describe('M3.1 / fiche client — colonnes réservées de l’événement', () => {
  const COLONNES_FERMEES = [
    'contact_principal_nom',
    'contact_principal_telephone',
    'contact_secours_nom',
    'contact_secours_telephone',
    'reference_affaire',
    'notes_internes',
    'entite_facturation_id',
  ];

  it('M3.1/fiche_get_contacts_service_role — traiteur programmateur : contacts + référence d’affaire, jamais demandés sous RLS', async () => {
    rls.results.collectes = { data: ligneCollecte(), error: null };
    admin.results.evenements = { data: reserveEvenement(), error: null };
    const { res, json } = await getFiche();
    expect(res.status).toBe(200);
    const evt = json.data.evenement as Record<string, unknown>;
    expect(evt).toMatchObject({
      contacts_visibles: true,
      contact_principal_nom: 'Paul',
      contact_principal_telephone: '0611223344',
      contact_secours_nom: 'Léa',
      contact_secours_telephone: '0655443322',
      reference_affaire: 'AFF-2026-042',
    });
    // La lecture sous l'identité de l'utilisateur ne cite AUCUNE colonne fermée
    // (elle lèverait 42501 : la fiche entière tomberait en 500).
    for (const col of COLONNES_FERMEES)
      expect(rls.selects.collectes?.[0]).not.toContain(col);
    expect(rls.calls).not.toContain('evenements');
    // Lecture service-role bornée à CET événement.
    expect(admin.eqs.evenements).toEqual([['id', 'e1']]);
    expect(admin.selects.evenements?.[0]).not.toContain('notes_internes');
    expect(admin.selects.evenements?.[0]).not.toContain(
      'entite_facturation_id',
    );
  });

  it('M3.1/fiche_get_reference_affaire_programmateur_seul — traiteur opérationnel : contacts servis, référence d’affaire du donneur d’ordre ni lue ni servie', async () => {
    rls.results.collectes = {
      data: ligneCollecte({
        evenement: {
          ...ligneCollecte().evenement,
          organisation_id: 'org-agence',
          traiteur_operationnel_organisation_id: 'org-1',
        },
      }),
      error: null,
    };
    // Piège : la base renverrait la référence si on la demandait.
    admin.results.evenements = { data: reserveEvenement(), error: null };
    const { json } = await getFiche();
    const evt = json.data.evenement as Record<string, unknown>;
    expect(evt.contacts_visibles).toBe(true);
    expect(evt.contact_principal_telephone).toBe('0611223344');
    expect(admin.selects.evenements?.[0]).not.toContain('reference_affaire');
    expect(admin.selects.evenements?.[0]).toContain('contact_principal_nom');
  });

  it('M3.1/fiche_get_contacts_erreur_500 — lecture des contacts en échec : 500, jamais « aucun contact »', async () => {
    rls.results.collectes = { data: ligneCollecte(), error: null };
    admin.results.evenements = { data: null, error: { message: 'boom' } };
    const { res } = await getFiche();
    expect(res.status).toBe(500);
  });
});

describe('M3.1 / fiche client — contenu servi', () => {
  it('M3.1/fiche_get_bilan_flux_zd — Réalisée : pesées par flux sommées, figées', async () => {
    rls.results.collectes = {
      data: ligneCollecte({
        statut: 'cloturee',
        taux_recyclage: 78.4,
        co2_net_kg: 312,
        collecte_flux: [
          { poids_reel_kg: 400, flux_dechets: { code: 'biodechet' } },
          { poids_reel_kg: 20, flux_dechets: { code: 'biodechet' } },
          { poids_reel_kg: 90, flux_dechets: { code: 'verre' } },
          { poids_reel_kg: null, flux_dechets: { code: 'carton' } },
        ],
      }),
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.bilan_flux).toEqual({ biodechet: 420, verre: 90 });
    expect(json.data.taux_recyclage).toBe(78.4);
    expect(json.data.co2_net_kg).toBe(312);
  });

  it('M3.1/fiche_get_bilan_flux_avant_realisation — pas de bilan avant « Réalisée »', async () => {
    rls.results.collectes = {
      data: ligneCollecte({
        statut: 'realisee',
        collecte_flux: [
          { poids_reel_kg: 400, flux_dechets: { code: 'biodechet' } },
        ],
      }),
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.bilan_flux).toBeNull();
  });

  it('M3.1/fiche_get_association_ag — AG validée : association (nom, ville, présentation) + repas, lus sous RLS', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ type: 'anti_gaspi', statut: 'cloturee' }),
      error: null,
    };
    // Forme OBJET (attributions_antgaspi est une relation to-one).
    rls.results.attributions_antgaspi = {
      data: {
        volume_repas_realise: 840,
        association: {
          nom: 'Les Restos du Cœur',
          ville: 'Paris',
          description_rapport_impact: 'Aide alimentaire.',
        },
      },
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.repas_donnes).toBe(840);
    expect(json.data.association).toEqual({
      nom: 'Les Restos du Cœur',
      ville: 'Paris',
      description: 'Aide alimentaire.',
    });
    expect(admin.calls).not.toContain('attributions_antgaspi');
  });

  it('M3.1/fiche_get_lieu_effectif — instructions d’accès : surcharge de la collecte appliquée', async () => {
    rls.results.collectes = {
      data: ligneCollecte({
        lieu_overrides: { acces_details: 'Quai B, badge 1234' },
      }),
      error: null,
    };
    const { json } = await getFiche();
    const lieu = (json.data.evenement as { lieu: { acces_details: string } })
      .lieu;
    expect(lieu.acces_details).toBe('Quai B, badge 1234');
    // La réponse ne porte que le lieu effectif, pas la surcharge brute.
    expect(JSON.stringify(json)).not.toContain('lieu_overrides');
  });

  it('M3.1/fiche_get_urgence_demandee — alerte existante ⇒ coordonnees_urgence_demandee', async () => {
    rls.results.collectes = { data: ligneCollecte(), error: null };
    admin.results.alertes_admin = { data: { id: 'a1' }, error: null };
    const { json } = await getFiche();
    expect(json.data.coordonnees_urgence_demandee).toBe(true);
  });

  it('M3.1/fiche_get_urgence_ouverte_seule — seule une demande OUVERTE grise le bouton (D10)', async () => {
    rls.results.collectes = { data: ligneCollecte(), error: null };
    await getFiche();
    // Une alerte clôturée ne doit pas empêcher une nouvelle demande.
    expect(admin.eqs.alertes_admin).toContainEqual(['statut', 'ouverte']);
  });

  it('M3.1/fiche_get_actions_par_role — manager de l’orga actif, commercial non créateur grisé, terminal absent', async () => {
    rls.results.collectes = { data: ligneCollecte(), error: null };
    let { json } = await getFiche();
    expect(json.data.actions).toEqual({
      modifier: 'actif',
      annuler: 'actif',
      annulation: 'demande',
    });

    auth('traiteur_commercial', 'org-1', 'user-autre');
    ({ json } = await getFiche());
    expect(json.data.actions).toEqual({
      modifier: 'grise',
      annuler: 'grise',
      annulation: 'demande',
    });

    auth();
    rls.results.collectes = {
      data: ligneCollecte({ statut: 'programmee' }),
      error: null,
    };
    ({ json } = await getFiche());
    expect((json.data.actions as { annulation: string }).annulation).toBe(
      'directe',
    );

    rls.results.collectes = {
      data: ligneCollecte({ statut: 'cloturee' }),
      error: null,
    };
    ({ json } = await getFiche());
    expect(json.data.actions).toEqual({
      modifier: 'absent',
      annuler: 'absent',
      annulation: null,
    });
  });
});

describe('M3.1 / documents de la fiche — lus sous la RLS du traiteur (D12)', () => {
  // Collecte AG clôturée, programmée par une agence ; le traiteur courant
  // (org-1) est l'opérationnel sur place.
  function collecteAgenceAg() {
    return ligneCollecte({
      type: 'anti_gaspi',
      statut: 'cloturee',
      evenement: {
        ...ligneCollecte().evenement,
        organisation_id: 'org-agence',
        traiteur_operationnel_organisation_id: 'org-1',
      },
    });
  }
  const ATTESTATION_AGENCE = {
    data: { eligible_at: '2020-01-01T00:00:00Z', pdf_url: 'att-agence.pdf' },
    error: null,
  };

  it('M3.1/fiche_get_attestation_donneur_ordre_reservee — traiteur opérationnel : attestation non lue, rapport réservé', async () => {
    rls.results.collectes = { data: collecteAgenceAg(), error: null };
    // Piège : en service-role, l'attestation de l'agence serait lisible.
    admin.results.attestations_don = ATTESTATION_AGENCE;
    // Sous la RLS du traiteur (att_traiteur_select) : aucune attestation.
    rls.results.attestations_don = { data: null, error: null };
    const { json } = await getFiche();
    expect(json.data.rapport_rse_disponible).toBe(false);
    expect(json.data.rapport_reserve_donneur_ordre).toBe(true);
    expect(admin.calls).not.toContain('attestations_don');
    expect(admin.calls).not.toContain('rapports_rse');
  });

  it('M3.1/fiche_get_attestation_programmateur — traiteur programmateur : attestation lue sous sa RLS', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ type: 'anti_gaspi', statut: 'cloturee' }),
      error: null,
    };
    rls.results.attestations_don = ATTESTATION_AGENCE;
    const { json } = await getFiche();
    expect(json.data.rapport_rse_disponible).toBe(true);
    expect(json.data.rapport_reserve_donneur_ordre).toBe(false);
  });

  it('M3.1/fiche_get_rapport_zd_traiteur_operationnel — ZD : le rapport RSE reste servi (rr_select)', async () => {
    rls.results.collectes = {
      data: ligneCollecte({
        statut: 'cloturee',
        evenement: {
          ...ligneCollecte().evenement,
          organisation_id: 'org-agence',
          traiteur_operationnel_organisation_id: 'org-1',
        },
      }),
      error: null,
    };
    rls.results.rapports_rse = {
      data: {
        disponible_a: '2020-01-02T00:00:00Z',
        genere_at: '2020-01-02T00:00:00Z',
        regenere_at: null,
      },
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.rapport_rse_disponible).toBe(true);
    expect(json.data.rapport_reserve_donneur_ordre).toBe(false);
  });

  it('M3.1/rapport_download_attestation_donneur_ordre_404 — téléchargement refusé au traiteur opérationnel', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi', statut: 'cloturee' },
      error: null,
    };
    admin.results.attestations_don = {
      data: { id: 'att-1', ...ATTESTATION_AGENCE.data },
      error: null,
    };
    rls.results.attestations_don = { data: null, error: null };
    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/rapport-rse/download/route.js');
    const res = await GET(
      req('/api/v1/traiteur/collectes/c1/rapport-rse/download'),
      {
        params: Promise.resolve({ id: 'c1' }),
      },
    );
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('att-agence');
    expect(admin.calls).toHaveLength(0);
  });
});

describe('M3.1 / ligne document — état calculé par le serveur (arbitrage Val 2026-09-30)', () => {
  const H = 3600 * 1000;
  const ilYa = (ms: number) => new Date(Date.now() - ms).toISOString();

  it.each([
    ['ZD programmée, pas encore réalisée', 'zero_dechet', 'programmee', null],
    ['ZD réalisée il y a 2 h', 'zero_dechet', 'realisee', ilYa(2 * H)],
    ['AG réalisée il y a 23 h', 'anti_gaspi', 'realisee', ilYa(23 * H)],
  ])(
    'M3.1/fiche_get_rapport_etat_a_venir — %s : avant l’échéance H+24',
    async (_cas, type, statut, realisee_at) => {
      rls.results.collectes = {
        data: ligneCollecte({ type, statut, realisee_at }),
        error: null,
      };
      const { json } = await getFiche();
      expect(json.data.rapport_rse_disponible).toBe(false);
      expect(json.data.rapport_etat).toBe('a_venir');
    },
  );

  it.each([
    [
      'AG réalisée le 13/09, attestation sans PDF (cas constaté)',
      'anti_gaspi',
      'cloturee',
      '2026-09-13T21:00:00Z',
      'attestations_don',
      { eligible_at: '2026-09-14T21:00:00Z', pdf_url: null },
    ],
    [
      'ZD clôturée, aucune ligne de document (lot du matin sauté)',
      'zero_dechet',
      'cloturee',
      ilYa(30 * H),
      null,
      null,
    ],
    [
      'ZD clôturée, rendu PDF pas encore fait',
      'zero_dechet',
      'cloturee',
      ilYa(30 * H),
      'rapports_rse',
      { disponible_a: ilYa(6 * H), genere_at: null, regenere_at: null },
    ],
    [
      'AG sans excédent réalisée il y a 25 h, sans rapport',
      'anti_gaspi',
      'realisee_sans_collecte',
      ilYa(25 * H),
      null,
      null,
    ],
    [
      'clôturée sans date de réalisation (historique)',
      'zero_dechet',
      'cloturee',
      null,
      null,
      null,
    ],
  ] as const)(
    'M3.1/fiche_get_rapport_etat_en_preparation — %s',
    async (_cas, type, statut, realisee_at, table, ligne) => {
      rls.results.collectes = {
        data: ligneCollecte({ type, statut, realisee_at }),
        error: null,
      };
      if (table) rls.results[table] = { data: ligne, error: null };
      const { json } = await getFiche();
      expect(json.data.rapport_rse_disponible).toBe(false);
      expect(json.data.rapport_etat).toBe('en_preparation');
    },
  );

  it('M3.1/fiche_get_rapport_etat_disponible — PDF généré, embargo écoulé', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ statut: 'cloturee', realisee_at: ilYa(30 * H) }),
      error: null,
    };
    rls.results.rapports_rse = {
      data: {
        disponible_a: ilYa(6 * H),
        genere_at: ilYa(5 * H),
        regenere_at: null,
      },
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.rapport_rse_disponible).toBe(true);
    expect(json.data.rapport_etat).toBe('disponible');
  });

  it('M3.1/fiche_get_rapport_etat_reserve — traiteur opérationnel : « réservé » l’emporte sur l’échéance passée', async () => {
    rls.results.collectes = {
      data: ligneCollecte({
        type: 'anti_gaspi',
        statut: 'cloturee',
        realisee_at: ilYa(30 * 24 * H),
        evenement: {
          ...ligneCollecte().evenement,
          organisation_id: 'org-agence',
          traiteur_operationnel_organisation_id: 'org-1',
        },
      }),
      error: null,
    };
    rls.results.attestations_don = { data: null, error: null };
    const { json } = await getFiche();
    expect(json.data.rapport_reserve_donneur_ordre).toBe(true);
    expect(json.data.rapport_etat).toBe('reserve');
  });

  it('M3.1/rapport_etat_echeance_h24 — bascule exactement à réalisation + 24 h', () => {
    const realisee_at = '2026-09-13T21:00:00.000Z';
    const echeance = new Date(realisee_at).getTime() + 24 * H;
    const etat = (maintenant: number) =>
      etatRapport({
        reserve: false,
        disponible: false,
        statut: 'realisee',
        realisee_at,
        maintenant,
      });
    expect(etat(echeance - 1)).toBe('a_venir');
    expect(etat(echeance)).toBe('en_preparation');
    // Disponible et réservé ne dépendent pas de l'échéance.
    expect(
      etatRapport({
        reserve: false,
        disponible: true,
        statut: 'cloturee',
        realisee_at,
        maintenant: echeance - 1,
      }),
    ).toBe('disponible');
    expect(
      etatRapport({
        reserve: true,
        disponible: false,
        statut: 'cloturee',
        realisee_at,
        maintenant: echeance + 1,
      }),
    ).toBe('reserve');
  });
});

describe('M3.1 / factures de la fiche — cloisonnement (revue sécurité 2026-09-29)', () => {
  it('M3.1/fiche_get_factures_sous_rls_traiteur_operationnel — la facture de l’agence programmatrice ne fuit pas', async () => {
    // Collecte programmée par une agence (facturée à l'AGENCE), le traiteur
    // courant est l'opérationnel sur place.
    rls.results.collectes = {
      data: ligneCollecte({
        evenement: {
          ...ligneCollecte().evenement,
          organisation_id: 'org-agence',
          traiteur_operationnel_organisation_id: 'org-1',
        },
      }),
      error: null,
    };
    // Piège : en service-role, la facture de l'agence serait lisible.
    admin.results.factures_collectes = {
      data: [
        {
          facture: {
            id: 'f-ag',
            numero_facture: 'FAC-AGENCE-1',
            statut: 'emise',
            pdf_url_savr: 'ag.pdf',
            pdf_url_pennylane: null,
          },
        },
      ],
      error: null,
    };
    // Sous la RLS du traiteur : aucune facture (fac_client_select / fc_select).
    rls.results.factures_collectes = { data: [], error: null };
    const { json } = await getFiche();
    expect(json.data.factures).toEqual([]);
    expect(JSON.stringify(json)).not.toContain('FAC-AGENCE-1');
    expect(admin.calls).not.toContain('factures_collectes');
    expect(admin.calls).not.toContain('factures');
  });

  it('M3.1/fiche_get_factures_brouillon_exclu — seules les factures émises sont servies', async () => {
    rls.results.collectes = { data: ligneCollecte(), error: null };
    rls.results.factures_collectes = {
      data: [
        {
          facture: {
            id: 'f1',
            numero_facture: 'FZD-1',
            statut: 'brouillon',
            pdf_url_savr: null,
            pdf_url_pennylane: null,
          },
        },
        {
          facture: {
            id: 'f2',
            numero_facture: 'FZD-2',
            statut: 'emise',
            pdf_url_savr: 'f2.pdf',
            pdf_url_pennylane: null,
          },
        },
      ],
      error: null,
    };
    const { json } = await getFiche();
    expect(
      (json.data.factures as Array<{ numero_facture: string }>).map(
        (f) => f.numero_facture,
      ),
    ).toEqual(['FZD-2']);
  });
});

describe('M3.1 / demande urgente des coordonnées (Q3)', () => {
  const camionIncomplet = {
    data: [
      {
        tournee: {
          plaque_immatriculation: null,
          chauffeur_nom: 'Léa',
          chauffeur_telephone: null,
          type_vehicule: 'camionnette',
        },
      },
    ],
    error: null,
  };

  it('M3.1/urgence_collecte_invisible_404 — collecte d’une autre organisation : 404, aucune écriture', async () => {
    rls.results.collectes = { data: null, error: null };
    const res = await postUrgence();
    expect(res.status).toBe(404);
    expect(admin.inserts).toHaveLength(0);
    expect(admin.calls).toHaveLength(0);
  });

  it('M3.1/urgence_insert_alerte_ops — alerte in-app Ops, texte construit serveur, ni email ni Slack', async () => {
    rls.results.collectes = {
      data: {
        id: 'c1',
        statut: 'validee',
        date_collecte: '2026-10-28',
        heure_collecte: '22:00:00',
        evenement: { lieu: { nom: 'Paris Expo' } },
      },
      error: null,
    };
    admin.results.collecte_tournees = camionIncomplet;
    const res = await postUrgence({ message: 'TEXTE LIBRE INJECTÉ' });
    expect(res.status).toBe(200);
    expect(admin.inserts).toHaveLength(1);
    const { table, row } = admin.inserts[0]!;
    expect(table).toBe('alertes_admin');
    expect(row).toMatchObject({
      code: 'coordonnees_chauffeur_urgence',
      entity_type: 'collecte',
      entity_id: 'c1',
      titre: 'Coordonnées du chauffeur demandées en urgence',
    });
    expect(JSON.stringify(row)).not.toContain('TEXTE LIBRE INJECTÉ');
    expect(JSON.stringify(row)).toContain('Paris Expo');
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendAlert).not.toHaveBeenCalled();
    // Contrôle RLS AVANT toute écriture service-role.
    expect(rls.calls[0]).toBe('collectes');
  });

  it('M3.1/urgence_doublon_idempotent — violation d’unicité (double clic) : même réponse, pas d’erreur', async () => {
    rls.results.collectes = {
      data: { id: 'c1', statut: 'en_cours', date_collecte: '2026-10-28' },
      error: null,
    };
    admin.results.collecte_tournees = camionIncomplet;
    admin.setInsertResult({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    const res = await postUrgence();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { demandee: true } });
  });

  it.each(['brouillon', 'realisee', 'cloturee', 'annulee'])(
    'M3.1/urgence_statut_hors_fenetre_409 — %s : refus, aucune alerte',
    async (statut) => {
      rls.results.collectes = {
        data: { id: 'c1', statut, date_collecte: '2026-10-28' },
        error: null,
      };
      const res = await postUrgence();
      expect(res.status).toBe(409);
      expect(admin.inserts).toHaveLength(0);
    },
  );

  it('M3.1/urgence_coordonnees_completes_409 — coordonnées déjà là : refus, aucune alerte', async () => {
    rls.results.collectes = {
      data: { id: 'c1', statut: 'validee', date_collecte: '2026-10-28' },
      error: null,
    };
    admin.results.collecte_tournees = {
      data: [
        {
          tournee: {
            plaque_immatriculation: 'AB-123-CD',
            chauffeur_nom: 'Léa',
            chauffeur_telephone: '0612345678',
            type_vehicule: 'camionnette',
          },
        },
      ],
      error: null,
    };
    const res = await postUrgence();
    expect(res.status).toBe(409);
    expect(admin.inserts).toHaveLength(0);
  });
});

describe('M3.1 / notes internes Admin (C1)', () => {
  it('M3.1/edition_notes_internes_refusee — un client ne peut plus écrire notes_internes', async () => {
    rls.results.collectes = { data: ligneCollecte(), error: null };
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      req('/api/v1/traiteur/collectes/c1', {
        method: 'PATCH',
        body: { notes_internes: 'écrasement' },
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(422);
    expect(admin.rpcCalls).toHaveLength(0);
  });
});
