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
 *    libre lu, « 1 par collecte » porté par la base (23505 = déjà demandée),
 *    ni email ni Slack.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeClient, ligneCollecte } from '../helpers/fiche-client-mock';

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
