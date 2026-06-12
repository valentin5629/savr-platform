/**
 * seed_minimal — dataset déterministe Savr Plateforme V1 (dev + tests).
 * Reset < 30 s. Périmètre : plateforme.* + shared.* (jamais tms.*).
 *
 * Le référentiel (types_evenements, flux_dechets, parametres_*, grilles,
 * tarifs_zero_dechet, tarifs_packs_ag, email_templates, domaines_email_publics)
 * est déjà seedé par les migrations (bloc8 + auth) : on le RELIT par clé
 * naturelle, on ne le réinsère jamais.
 *
 * Ordre FK : orgs → entités → users → lieux → org_lieux → contacts →
 *   associations/prestataires/transporteurs → tarifs négo → packs →
 *   événements → collectes → flux → attributions → config AG →
 *   tournées → collecte_tournees → pesées → factures → lignes → séquences →
 *   bordereaux/attestations/rapports/exports/docs → outbox → emails →
 *   audit → integrations → coefficients.
 */

import type pg from 'pg';
import { seedUuid } from './uuid.js';
import { upsert, lookupMap, jsonb, type Row } from './db.js';
import { SEED_REF_DATE, fakePhone, seedEmail } from './constants.js';

const U = seedUuid;

// Type local : col() renvoie un sur-ensemble Row avec slug/ev de travail.
type ColSpec = Row & { slug: string; ev: string };

// ── Dates relatives à SEED_REF_DATE (jamais NOW()) ──────────────────────────
function d(offsetDays: number): string {
  const ref = new Date(SEED_REF_DATE + 'T00:00:00Z');
  ref.setUTCDate(ref.getUTCDate() + offsetDays);
  return ref.toISOString().slice(0, 10);
}
function ts(offsetDays: number, hour = 22): string {
  const ref = new Date(SEED_REF_DATE + 'T00:00:00Z');
  ref.setUTCDate(ref.getUTCDate() + offsetDays);
  ref.setUTCHours(hour, 0, 0, 0);
  return ref.toISOString();
}

export async function seedMinimal(client: pg.Client): Promise<void> {
  // ── 0. Référentiel (lecture seule par clé naturelle) ──────────────────────
  const grille = await lookupMap(
    client,
    'select id, nom from plateforme.grilles_tarifaires_zd where est_defaut',
    'nom',
  );
  const grilleZdId = grille.get('Grille standard V1');
  if (!grilleZdId)
    throw new Error('Référentiel manquant : grille ZD par défaut');
  const packTarif = await lookupMap(
    client,
    'select nb_collectes::text as k, id from plateforme.tarifs_packs_ag',
    'k',
  );
  const flux = await lookupMap(
    client,
    'select code, id from plateforme.flux_dechets',
    'code',
  );
  const typeEv = await lookupMap(
    client,
    'select code, id from plateforme.types_evenements',
    'code',
  );
  const tEvCocktail = typeEv.get('cocktail_repas_complet')!;
  const tEvRepas = typeEv.get('repas_assis')!;
  const F = (code: string) => flux.get(code)!;
  const PS = (s: string) => U('prest_' + s); // shared.prestataires id
  const TR = (s: string) => U('transp_' + s); // plateforme.transporteurs id

  // ── 1. Organisations ──────────────────────────────────────────────────────
  // org_savr : organisation interne staff. Type 'agence' faute de type interne
  // dans l'enum (cf. DIVERGENCE M0.7) ; exclue des comptes clients par seed:check.
  await upsert(
    client,
    'plateforme.organisations',
    [
      org('org_savr', 'Savr', 'agence', 'Savr SAS'),
      org('org_tr_kaspia', 'Kaspia', 'traiteur', 'Kaspia SAS'),
      org(
        'org_tr_fleurdemets',
        'Fleur de Mets',
        'traiteur',
        'Fleur de Mets SARL',
      ),
      org('org_tr_cirette', 'Cirette', 'traiteur', 'Cirette EURL'),
      org('org_ge_viparis', 'Viparis', 'gestionnaire_lieux', 'Viparis SAS'),
      org(
        'org_ge_artsforains',
        'Musée des Arts Forains',
        'gestionnaire_lieux',
        'Pavillons de Bercy SAS',
      ),
      org('org_ag_caromy', 'Caromy Event', 'agence', 'Caromy Event SARL'),
    ],
    ['id'],
  );

  // ── 2. Entités de facturation ─────────────────────────────────────────────
  await upsert(
    client,
    'plateforme.entites_facturation',
    [
      entite(
        'entite_kaspia',
        'org_tr_kaspia',
        'Kaspia SAS',
        '12345678901234',
        'Paris',
        '75008',
      ),
      entite(
        'entite_fleurdemets',
        'org_tr_fleurdemets',
        'Fleur de Mets SARL',
        '22222222200018',
        'Paris',
        '75009',
      ),
      entite(
        'entite_cirette',
        'org_tr_cirette',
        'Cirette EURL',
        '33333333300025',
        'Rouen',
        '76000',
      ),
      entite(
        'entite_viparis',
        'org_ge_viparis',
        'Viparis SAS',
        '55555555500031',
        'Paris',
        '75015',
      ),
      entite(
        'entite_caromy',
        'org_ag_caromy',
        'Caromy Event SARL',
        '66666666600048',
        'Paris',
        '75015',
      ),
    ],
    ['id'],
  );

  // ── 3. Users (4 staff + 11 clients) ───────────────────────────────────────
  await upsert(
    client,
    'plateforme.users',
    [
      user('user_admin', 'org_savr', 'admin_savr', 'Valentin', 'Admin'),
      user('user_ops1', 'org_savr', 'ops_savr', 'Ops', 'Un'),
      user('user_ops2', 'org_savr', 'ops_savr', 'Ops', 'Deux'),
      user(
        'user_commercial',
        'org_savr',
        'traiteur_commercial',
        'Commercial',
        'Savr',
      ),
      user(
        'user_manager_kaspia',
        'org_tr_kaspia',
        'traiteur_manager',
        'Manon',
        'Kaspia',
      ),
      user(
        'user_collab_kaspia',
        'org_tr_kaspia',
        'traiteur_commercial',
        'Colin',
        'Kaspia',
      ),
      user(
        'user_manager_fleurdemets',
        'org_tr_fleurdemets',
        'traiteur_manager',
        'Flora',
        'Mets',
      ),
      user(
        'user_collab_fleurdemets',
        'org_tr_fleurdemets',
        'traiteur_commercial',
        'Félix',
        'Mets',
      ),
      user(
        'user_manager_cirette',
        'org_tr_cirette',
        'traiteur_manager',
        'Cyril',
        'Cirette',
      ),
      user(
        'user_collab_cirette',
        'org_tr_cirette',
        'traiteur_commercial',
        'Camille',
        'Cirette',
      ),
      user(
        'user_gest_viparis',
        'org_ge_viparis',
        'gestionnaire_lieux',
        'Victor',
        'Paris',
      ),
      user(
        'user_collab_viparis',
        'org_ge_viparis',
        'gestionnaire_lieux',
        'Valérie',
        'Paris',
      ),
      user(
        'user_gest_artsforains',
        'org_ge_artsforains',
        'gestionnaire_lieux',
        'Arthur',
        'Forain',
      ),
      user('user_agence_caromy', 'org_ag_caromy', 'agence', 'Carole', 'Romy'),
      user('user_collab_caromy', 'org_ag_caromy', 'agence', 'Karim', 'Romy'),
    ],
    ['id'],
  );

  // ── 4. Lieux + rattachements ──────────────────────────────────────────────
  await upsert(
    client,
    'plateforme.lieux',
    [
      lieu(
        'lieu_pdv',
        'Paris Expo Porte de Versailles',
        '1 Place de la Porte de Versailles',
        '75015',
        'Paris',
        'idf',
        'poids_lourd',
      ),
      lieu(
        'lieu_palais',
        'Palais des Congrès de Paris',
        '2 Place de la Porte Maillot',
        '75017',
        'Paris',
        'idf',
        'poids_lourd',
        true,
      ),
      lieu(
        'lieu_champerret',
        'Espace Champerret',
        '6 Rue Jean Oestreicher',
        '75017',
        'Paris',
        'idf',
        'fourgon',
      ),
      lieu(
        'lieu_arts_forains',
        'Musée des Arts Forains',
        '53 Avenue des Terroirs de France',
        '75012',
        'Paris',
        'idf',
        'velo_cargo',
      ),
      lieu(
        'lieu_rouen',
        'Salle Rouen Normandie',
        '5 Rue des Chartreux',
        '76000',
        'Rouen',
        'province',
        'fourgon',
      ),
      lieu(
        'lieu_ponctuel',
        'Adresse libre — Paris 8e',
        '15 Avenue Hoche',
        '75008',
        'Paris',
        'idf',
        'fourgon',
      ),
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.organisations_lieux',
    [
      orgLieu('org_ge_viparis', 'lieu_pdv'),
      orgLieu('org_ge_viparis', 'lieu_palais'),
      orgLieu('org_ge_viparis', 'lieu_champerret'),
      orgLieu('org_ge_artsforains', 'lieu_arts_forains'),
      orgLieu('org_tr_kaspia', 'lieu_pdv'), // lieu partagé (Viparis + Kaspia)
      orgLieu('org_tr_kaspia', 'lieu_palais'),
      orgLieu('org_tr_cirette', 'lieu_rouen'),
      orgLieu('org_tr_fleurdemets', 'lieu_champerret'),
    ],
    ['id'],
  );

  // ── 5. Contacts traiteurs ─────────────────────────────────────────────────
  await upsert(
    client,
    'plateforme.contacts_traiteurs',
    [
      {
        id: U('contact_kaspia_1'),
        organisation_id: U('org_tr_kaspia'),
        prenom: 'Léa',
        nom: 'Réception',
        telephone: fakePhone(11),
        email: seedEmail('lea.reception.kaspia'),
        fonction: 'Cheffe de salle',
        actif: true,
      },
      {
        id: U('contact_kaspia_2'),
        organisation_id: U('org_tr_kaspia'),
        prenom: 'Tom',
        nom: 'Logistique',
        telephone: fakePhone(12),
        email: seedEmail('tom.logistique.kaspia'),
        fonction: 'Resp. logistique',
        actif: true,
      },
    ],
    ['id'],
  );

  // ── 6. Associations ───────────────────────────────────────────────────────
  await upsert(
    client,
    'plateforme.associations',
    [
      {
        id: U('asso_alpha'),
        nom: 'Association Alpha (fictif)',
        adresse: '12 Rue Alpha',
        ville: 'Paris',
        region: 'idf',
        contact_nom: 'Alice Alpha',
        contact_email: seedEmail('contact.alpha'),
        contact_telephone: fakePhone(21),
        habilitee_attestation_fiscale: true,
        actif: true,
        description_rapport_impact:
          'Association Alpha — redistribution alimentaire aux personnes précaires en Île-de-France.',
      },
      {
        id: U('asso_bravo'),
        nom: 'Association Bravo (fictif)',
        adresse: '8 Rue Bravo',
        ville: 'Paris',
        region: 'idf',
        contact_nom: 'Bruno Bravo',
        contact_email: seedEmail('contact.bravo'),
        contact_telephone: fakePhone(22),
        habilitee_attestation_fiscale: false,
        actif: true,
        description_rapport_impact:
          'Association Bravo — collecte et redistribution pour les familles du Val-de-Marne.',
      },
    ],
    ['id'],
  );

  // ── 7. Prestataires (shared) + transporteurs (plateforme) ─────────────────
  await upsert(
    client,
    'shared.prestataires',
    [
      prest('prest_strike', 'Strike', 'STRIKE', '77777777700019'),
      prest('prest_marathon', 'Marathon', 'MARATHON', '88888888800026'),
      prest(
        'prest_transnormandie',
        'Transnormandie',
        'TRANSNOR',
        '99999999900033',
      ),
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.transporteurs',
    [
      transp(
        'transp_strike',
        'Strike',
        '777777777',
        '10 Rue de la Logistique',
        '75019',
        'Paris',
        ['poids_lourd'],
        'STRIKE-MTS1',
      ),
      transp(
        'transp_marathon',
        'Marathon',
        '888888888',
        '22 Rue Marathon',
        '75020',
        'Paris',
        ['fourgon', 'poids_lourd'],
        'MARATHON-MTS1',
      ),
      transp(
        'transp_transnor',
        'Transnormandie',
        '999999999',
        '5 Quai de la Bourse',
        '76000',
        'Rouen',
        ['fourgon'],
        'TRANSNOR-MTS1',
      ),
    ],
    ['id'],
  );

  // ── 8. Tarifs négociés ────────────────────────────────────────────────────
  await upsert(
    client,
    'plateforme.tarifs_negocie',
    [
      {
        id: U('tn_kaspia'),
        activite: 'zd',
        scope: 'organisation',
        organisation_id: U('org_tr_kaspia'),
        gestionnaire_organisation_id: null,
        lieu_id: null,
        remise_pct: 0.15,
        valide_du: '2025-01-01',
        commentaires: 'Tarif négocié Kaspia -15%',
      },
      {
        id: U('tn_viparis'),
        activite: 'zd',
        scope: 'gestionnaire',
        organisation_id: null,
        gestionnaire_organisation_id: U('org_ge_viparis'),
        lieu_id: null,
        remise_pct: 0.05,
        valide_du: '2025-01-01',
        commentaires: 'Remise gestionnaire Viparis -5%',
      },
    ],
    ['id'],
  );

  // ── 9. Packs AG (3 actifs + 1 épuisé ; Cirette = bas ≤10%) ────────────────
  await upsert(
    client,
    'plateforme.packs_antgaspi',
    [
      pack(
        'pack_kaspia',
        'org_tr_kaspia',
        packTarif.get('20')!,
        20,
        4,
        0,
        'actif',
        d(-150),
      ),
      pack(
        'pack_fleurdemets',
        'org_tr_fleurdemets',
        packTarif.get('20')!,
        20,
        7,
        0,
        'actif',
        d(-120),
      ),
      pack(
        'pack_cirette_bas',
        'org_tr_cirette',
        packTarif.get('50')!,
        50,
        46,
        0,
        'actif',
        d(-200),
      ), // 4/50 = 8% (bas)
      pack(
        'pack_fleurdemets_epuise',
        'org_tr_fleurdemets',
        packTarif.get('10')!,
        10,
        10,
        0,
        'epuise',
        d(-365),
      ),
    ],
    ['id'],
  );

  // ── 10. Événements ────────────────────────────────────────────────────────
  type EvSpec = {
    slug: string;
    org: string;
    lieu: string;
    pax: number;
    type: string;
    off: number | null;
    nom: string;
  };
  const events: EvSpec[] = [
    {
      slug: 'ev_k1',
      org: 'org_tr_kaspia',
      lieu: 'lieu_pdv',
      pax: 500,
      type: tEvCocktail,
      off: -200,
      nom: 'Dîner Kaspia nov.',
    },
    {
      slug: 'ev_k2',
      org: 'org_tr_kaspia',
      lieu: 'lieu_pdv',
      pax: 1800,
      type: tEvCocktail,
      off: -150,
      nom: 'Salon Kaspia XL',
    },
    {
      slug: 'ev_k3',
      org: 'org_tr_kaspia',
      lieu: 'lieu_palais',
      pax: 700,
      type: tEvRepas,
      off: -45,
      nom: 'Congrès Kaspia',
    },
    {
      slug: 'ev_k4',
      org: 'org_tr_kaspia',
      lieu: 'lieu_pdv',
      pax: 600,
      type: tEvCocktail,
      off: -5,
      nom: 'Réception Kaspia',
    },
    {
      slug: 'ev_k5',
      org: 'org_tr_kaspia',
      lieu: 'lieu_pdv',
      pax: 900,
      type: tEvCocktail,
      off: -7,
      nom: 'Gala Kaspia multi',
    },
    {
      slug: 'ev_k6',
      org: 'org_tr_kaspia',
      lieu: 'lieu_pdv',
      pax: 400,
      type: tEvCocktail,
      off: 15,
      nom: 'Kaspia à venir',
    },
    {
      slug: 'ev_k_datenull',
      org: 'org_tr_kaspia',
      lieu: 'lieu_pdv',
      pax: 600,
      type: tEvCocktail,
      off: null,
      nom: 'Kaspia — date TBD',
    },
    {
      slug: 'ev_f1',
      org: 'org_tr_fleurdemets',
      lieu: 'lieu_palais',
      pax: 350,
      type: tEvRepas,
      off: -90,
      nom: 'Gala Fleur AG',
    },
    {
      slug: 'ev_f2',
      org: 'org_tr_fleurdemets',
      lieu: 'lieu_champerret',
      pax: 250,
      type: tEvCocktail,
      off: -95,
      nom: 'Cocktail Fleur AG',
    },
    {
      slug: 'ev_f3',
      org: 'org_tr_fleurdemets',
      lieu: 'lieu_champerret',
      pax: 180,
      type: tEvCocktail,
      off: -100,
      nom: 'Fleur AG sans repas',
    },
    {
      slug: 'ev_f4',
      org: 'org_tr_fleurdemets',
      lieu: 'lieu_champerret',
      pax: 200,
      type: tEvCocktail,
      off: -30,
      nom: 'Fleur annulé H-6',
    },
    {
      slug: 'ev_f5',
      org: 'org_tr_fleurdemets',
      lieu: 'lieu_arts_forains',
      pax: 80,
      type: tEvCocktail,
      off: -180,
      nom: 'Cocktail Fleur 80 pax',
    },
    {
      slug: 'ev_f6',
      org: 'org_tr_fleurdemets',
      lieu: 'lieu_champerret',
      pax: 300,
      type: tEvCocktail,
      off: 5,
      nom: 'Fleur dispatch',
    },
    {
      slug: 'ev_f7',
      org: 'org_tr_fleurdemets',
      lieu: 'lieu_champerret',
      pax: 220,
      type: tEvCocktail,
      off: 10,
      nom: 'Fleur rejetée',
    },
    {
      slug: 'ev_f8',
      org: 'org_tr_fleurdemets',
      lieu: 'lieu_palais',
      pax: 400,
      type: tEvRepas,
      off: 30,
      nom: 'Fleur AG brouillon',
    },
    {
      slug: 'ev_f9',
      org: 'org_tr_fleurdemets',
      lieu: 'lieu_champerret',
      pax: 180,
      type: tEvCocktail,
      off: -60,
      nom: 'Fleur annulé direct',
    },
    {
      slug: 'ev_c1',
      org: 'org_tr_cirette',
      lieu: 'lieu_rouen',
      pax: 220,
      type: tEvRepas,
      off: -120,
      nom: 'Cirette Rouen AG',
    },
    {
      slug: 'ev_c2',
      org: 'org_tr_cirette',
      lieu: 'lieu_rouen',
      pax: 150,
      type: tEvCocktail,
      off: -110,
      nom: 'Cirette Rouen ZD',
    },
    {
      slug: 'ev_c3',
      org: 'org_tr_cirette',
      lieu: 'lieu_rouen',
      pax: 120,
      type: tEvCocktail,
      off: 20,
      nom: 'Cirette brouillon tiers',
    },
  ];
  const mgrOf: Record<string, string> = {
    org_tr_kaspia: 'user_manager_kaspia',
    org_tr_fleurdemets: 'user_manager_fleurdemets',
    org_tr_cirette: 'user_manager_cirette',
  };
  const entiteOf: Record<string, string> = {
    org_tr_kaspia: 'entite_kaspia',
    org_tr_fleurdemets: 'entite_fleurdemets',
    org_tr_cirette: 'entite_cirette',
  };
  await upsert(
    client,
    'plateforme.evenements',
    events.map((e, i) => ({
      id: U(e.slug),
      organisation_id: U(e.org),
      traiteur_operationnel_organisation_id: U(e.org),
      entite_facturation_id: U(entiteOf[e.org]!),
      lieu_id: U(e.lieu),
      created_by: U(mgrOf[e.org]!),
      nom_evenement: e.nom,
      type_evenement_id: e.type,
      date_evenement: e.off === null ? null : d(e.off),
      pax: e.pax,
      contact_principal_nom: 'Contact ' + e.nom,
      contact_principal_telephone: fakePhone(100 + i),
    })),
    ['id'],
  );

  // ── 11. Collectes (20) ────────────────────────────────────────────────────
  const collectes: ColSpec[] = [
    // Kaspia ZD
    col(
      'col_zd_cloturee_01',
      'ev_k1',
      'zero_dechet',
      'cloturee',
      -200,
      PS('strike'),
      { taux_recyclage: 78.5 },
    ),
    col(
      'col_zd_palier_haut',
      'ev_k2',
      'zero_dechet',
      'cloturee',
      -150,
      PS('strike'),
      { nb_camions_demande: 2, taux_recyclage: 81.2 },
    ),
    col(
      'col_zd_hist_partiel',
      'ev_k1',
      'zero_dechet',
      'cloturee',
      -210,
      PS('strike'),
      { historique_partiel: true, taux_recyclage: 68.0 },
    ),
    col(
      'col_zd_cloturee_nonfac',
      'ev_k3',
      'zero_dechet',
      'cloturee',
      -45,
      PS('strike'),
      { taux_recyclage: 75.0 },
    ),
    col(
      'col_zd_realisee',
      'ev_k4',
      'zero_dechet',
      'realisee',
      -5,
      PS('strike'),
      { realisee_at: ts(-5, 23) },
    ),
    col(
      'col_zd_multi_tour',
      'ev_k5',
      'zero_dechet',
      'realisee',
      -7,
      PS('strike'),
      { nb_camions_demande: 2, realisee_at: ts(-7, 23) },
    ),
    col('col_zd_programmee', 'ev_k6', 'zero_dechet', 'programmee', 15, null, {
      statut_tms: 'non_envoye',
      informations_completes: true,
    }),
    // Fleur de Mets AG + ZD
    col(
      'col_ag_nominal',
      'ev_f1',
      'anti_gaspi',
      'cloturee',
      -90,
      PS('marathon'),
      { pack_antgaspi_id: U('pack_fleurdemets'), volume_estime_repas: 35 },
    ),
    col(
      'col_ag_poids_ops',
      'ev_f2',
      'anti_gaspi',
      'cloturee',
      -95,
      PS('marathon'),
      { volume_estime_repas: 25 },
    ),
    col(
      'col_ag_sans_collecte',
      'ev_f3',
      'anti_gaspi',
      'realisee_sans_collecte',
      -100,
      PS('marathon'),
      { aucun_repas_motif: 'Aucun invendu disponible à la collecte' },
    ),
    col(
      'col_ag_annule_tardif',
      'ev_f4',
      'anti_gaspi',
      'annulee',
      -30,
      PS('marathon'),
      {
        pack_antgaspi_id: U('pack_fleurdemets'),
        annulee_cote_savr: true,
        annulee_cote_savr_motif: 'Annulation client H-6',
      },
    ),
    col(
      'col_zd_palier_bas',
      'ev_f5',
      'zero_dechet',
      'cloturee',
      -180,
      PS('marathon'),
      { taux_recyclage: 72.0 },
    ),
    col(
      'col_dispatch_non_envoye',
      'ev_f6',
      'zero_dechet',
      'programmee',
      5,
      PS('strike'),
      { statut_tms: 'non_envoye' },
    ),
    col(
      'col_dispatch_dirty',
      'ev_f6',
      'anti_gaspi',
      'programmee',
      8,
      PS('marathon'),
      { statut_tms: 'acceptee', dirty_tms: true },
    ),
    col(
      'col_dispatch_rejetee',
      'ev_f7',
      'zero_dechet',
      'programmee',
      10,
      PS('strike'),
      { statut_tms: 'rejetee_par_prestataire' },
    ),
    col('col_brouillon', 'ev_f8', 'anti_gaspi', 'brouillon', 30, null, {}),
    col('col_annulee_directe', 'ev_f9', 'zero_dechet', 'annulee', -60, null, {
      annulee_cote_savr: true,
      annulee_cote_savr_motif: 'Événement reporté',
    }),
    // Cirette province
    col(
      'col_ag_cirette_rouen',
      'ev_c1',
      'anti_gaspi',
      'cloturee',
      -120,
      PS('transnormandie'),
      { pack_antgaspi_id: U('pack_cirette_bas'), volume_estime_repas: 22 },
    ),
    col(
      'col_zd_cirette_rouen',
      'ev_c2',
      'zero_dechet',
      'cloturee',
      -110,
      PS('transnormandie'),
      { taux_recyclage: 70.0 },
    ),
    col(
      'col_brouillon_tiers',
      'ev_c3',
      'zero_dechet',
      'brouillon',
      20,
      null,
      {},
    ),
  ];
  // On retire les champs de travail slug/ev avant insertion.
  await upsert(
    client,
    'plateforme.collectes',
    collectes.map(({ slug: _s, ev: _e, ...rest }) => rest),
    ['id'],
  );

  // ── 12. Collecte flux (14 lignes dont 2 alerte min / 2 max) ───────────────
  await upsert(
    client,
    'plateforme.collecte_flux',
    [
      cflux('cf_01_bio', 'col_zd_cloturee_01', F('biodechet'), 187.5),
      cflux('cf_01_carton', 'col_zd_cloturee_01', F('carton'), 62.3),
      cflux('cf_01_verre', 'col_zd_cloturee_01', F('verre'), 95.8),
      cflux('cf_haut_bio', 'col_zd_palier_haut', F('biodechet'), 892.0),
      cflux('cf_haut_carton', 'col_zd_palier_haut', F('carton'), 234.0),
      cflux('cf_haut_max', 'col_zd_palier_haut', F('dechet_residuel'), 5200.0), // alerte max
      cflux('cf_bas_bio', 'col_zd_palier_bas', F('biodechet'), 42.0),
      cflux('cf_bas_min', 'col_zd_palier_bas', F('verre'), 1.2), // alerte min
      cflux('cf_nonfac_bio', 'col_zd_cloturee_nonfac', F('biodechet'), 155.0),
      cflux('cf_nonfac_max', 'col_zd_cloturee_nonfac', F('emballage'), 6100.0), // alerte max
      cflux('cf_hist_min', 'col_zd_hist_partiel', F('verre'), 0.8), // alerte min
      cflux('cf_cirette_bio', 'col_zd_cirette_rouen', F('biodechet'), 88.0),
      cflux('cf_multi_bio', 'col_zd_multi_tour', F('biodechet'), 312.0),
      cflux('cf_multi_carton', 'col_zd_multi_tour', F('carton'), 98.5),
    ],
    ['id'],
  );

  // ── 13. Attributions AG (1 par collecte AG) + config auto-accept ──────────
  await upsert(
    client,
    'plateforme.attributions_antgaspi',
    [
      attr(
        'attr_nominal',
        'col_ag_nominal',
        'asso_alpha',
        TR('marathon'),
        'idf',
        'manuel_top1',
      ),
      attr(
        'attr_override',
        'col_ag_poids_ops',
        'asso_bravo',
        TR('marathon'),
        'idf',
        'manuel_override',
        'Réattribution Admin après refus asso initiale',
      ),
      attr(
        'attr_auto',
        'col_ag_cirette_rouen',
        'asso_alpha',
        TR('transnor'),
        'province',
        'auto_accept',
      ),
      attr(
        'attr_annule',
        'col_ag_annule_tardif',
        'asso_alpha',
        TR('marathon'),
        'idf',
        'manuel_top1',
      ),
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.config_auto_accept_ag',
    [
      {
        id: U('cfg_aa_fleur'),
        organisation_id: U('org_tr_fleurdemets'),
        association_id: U('asso_alpha'),
        transporteur_id: TR('marathon'),
        auto_accept_actif: true,
        seuil_pax_min: 100,
        seuil_pax_max: 800,
      },
    ],
    ['id'],
  );

  // ── 14. Tournées + collecte_tournees + pesées brutes ──────────────────────
  await upsert(
    client,
    'plateforme.tournees',
    [
      tournee(
        'tour_01',
        'TOUR-MIN-01',
        -200,
        PS('strike'),
        'MTS1-ORDER-MIN-01',
      ),
      tournee(
        'tour_02',
        'TOUR-MIN-02',
        -90,
        PS('marathon'),
        'MTS1-ORDER-MIN-02',
      ),
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.collecte_tournees',
    [
      ct('col_zd_cloturee_01', 'tour_01'),
      ct('col_ag_nominal', 'tour_02'),
      ct('col_zd_multi_tour', 'tour_01'),
      ct('col_zd_multi_tour', 'tour_02'),
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.pesees_tournees',
    [
      {
        id: U('pt_01_bio'),
        tournee_id: U('tour_01'),
        stop_id: 'stop-1',
        flux_id: F('biodechet'),
        poids_kg: 187.5,
      },
      {
        id: U('pt_01_carton'),
        tournee_id: U('tour_01'),
        stop_id: 'stop-1',
        flux_id: F('carton'),
        poids_kg: 62.3,
      },
    ],
    ['id'],
  );

  // ── 15. Factures + lignes + séquences ─────────────────────────────────────
  await upsert(
    client,
    'plateforme.factures',
    [
      facture(
        'fac_zd_collecte_01',
        'entite_kaspia',
        'org_tr_kaspia',
        'ZD-2025-0001',
        'payee',
        -200,
        240,
        { date_echeance: d(-170) },
      ),
      facture(
        'fac_zd_mensuelle',
        'entite_kaspia',
        'org_tr_kaspia',
        'ZD-2025-0002',
        'payee',
        -150,
        720,
        {
          date_echeance: d(-120),
          periode_debut: d(-180),
          periode_fin: d(-150),
        },
      ),
      facture(
        'fac_ag_pack',
        'entite_fleurdemets',
        'org_tr_fleurdemets',
        'AG-2025-0001',
        'payee',
        -120,
        2400,
        { date_echeance: d(-90) },
      ),
      facture(
        'fac_zd_fleur',
        'entite_fleurdemets',
        'org_tr_fleurdemets',
        'ZD-2025-0003',
        'envoyee',
        -60,
        250,
        { date_echeance: d(-30) },
      ),
      facture(
        'fac_zd_cirette',
        'entite_cirette',
        'org_tr_cirette',
        'ZD-2025-0004',
        'payee',
        -110,
        250,
        { date_echeance: d(-80) },
      ),
      facture(
        'fac_rejetee_4xx',
        'entite_cirette',
        'org_tr_cirette',
        'ZD-2025-0005',
        'brouillon',
        -80,
        250,
        { pennylane_statut: 'rejet_422' },
      ),
    ],
    ['id'],
  );
  // Avoir séparé (trigger : l'origine doit être 'payee' et déjà présente)
  await upsert(
    client,
    'plateforme.factures',
    [
      {
        id: U('fac_avoir'),
        entite_facturation_id: U('entite_fleurdemets'),
        organisation_id: U('org_tr_fleurdemets'),
        numero_facture: 'AVOIR-2025-0001',
        statut: 'payee',
        date_emission: d(-100),
        montant_ht: -240,
        taux_tva: 20,
        montant_tva: -48,
        montant_ttc: -288,
        facture_origine_id: U('fac_ag_pack'),
        motif_avoir: 'Correction de facturation',
      },
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.factures_collectes',
    [
      fcol(
        'fc_01_a',
        'fac_zd_collecte_01',
        'col_zd_cloturee_01',
        240,
        'Collecte ZD',
      ),
      fcol('fc_01_libre', 'fac_zd_collecte_01', null, 25, 'Frais de dossier'),
      fcol(
        'fc_mens_a',
        'fac_zd_mensuelle',
        'col_zd_cloturee_nonfac',
        240,
        'Collecte ZD mensuelle',
      ),
      fcol(
        'fc_mens_b',
        'fac_zd_mensuelle',
        'col_zd_hist_partiel',
        240,
        'Collecte ZD mensuelle',
      ),
      fcol(
        'fc_mens_c',
        'fac_zd_mensuelle',
        'col_zd_multi_tour',
        240,
        'Collecte ZD mensuelle',
      ),
      fcol(
        'fc_pack',
        'fac_ag_pack',
        null,
        2400,
        'Pack Anti-Gaspi 20 collectes',
      ),
      fcol('fc_avoir', 'fac_avoir', null, -240, 'Avoir — correction'),
      fcol('fc_fleur', 'fac_zd_fleur', 'col_zd_palier_bas', 250, 'Collecte ZD'),
      fcol(
        'fc_cirette',
        'fac_zd_cirette',
        'col_zd_cirette_rouen',
        250,
        'Collecte ZD province',
      ),
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.sequences_facturation',
    [
      { serie: 'ZD_COLLECTE', annee: 2025, dernier: 5 },
      { serie: 'AG_MENSUEL', annee: 2025, dernier: 1 },
      { serie: 'AVOIR', annee: 2025, dernier: 1 },
    ],
    ['serie', 'annee'],
  );

  // ── 16. Documents ─────────────────────────────────────────────────────────
  await upsert(
    client,
    'plateforme.bordereaux_savr',
    [
      bordereau('bord_01', 'col_zd_cloturee_01', -197),
      bordereau('bord_02', 'col_zd_palier_haut', -147),
      bordereau('bord_03', 'col_zd_cirette_rouen', -107),
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.attestations_don',
    [
      {
        id: U('att_alpha'),
        collecte_id: U('col_ag_nominal'),
        association_id: U('asso_alpha'),
        mention_fiscale_2041ge: true,
        nb_repas: 350,
        valeur_don_estimee_ht: 1750,
        statut: 'genere',
        genere_at: ts(-80),
        eligible_at: ts(-89),
      },
      {
        id: U('att_bravo'),
        collecte_id: U('col_ag_poids_ops'),
        association_id: U('asso_bravo'),
        mention_fiscale_2041ge: false,
        nb_repas: 250,
        valeur_don_estimee_ht: 1250,
        statut: 'genere',
        genere_at: ts(-85),
        eligible_at: ts(-94),
      },
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.rapports_rse',
    [
      {
        id: U('rapport_01'),
        collecte_id: U('col_zd_cloturee_01'),
        evenement_id: U('ev_k1'),
        version: 1,
        disponible_a: ts(-199),
        envoye_client: true,
        envoye_at: ts(-199),
        genere_at: ts(-199),
      },
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.exports_registre',
    [
      {
        id: U('exp_1'),
        organisation_id: U('org_tr_kaspia'),
        created_by: U('user_manager_kaspia'),
        periode_debut: '2025-06-01',
        periode_fin: '2025-12-31',
        nb_collectes: 4,
      },
      {
        id: U('exp_2'),
        organisation_id: U('org_tr_kaspia'),
        created_by: U('user_manager_kaspia'),
        periode_debut: '2025-01-01',
        periode_fin: '2025-05-31',
        nb_collectes: 0,
      },
      {
        id: U('exp_3'),
        organisation_id: U('org_tr_cirette'),
        created_by: U('user_manager_cirette'),
        periode_debut: '2025-06-01',
        periode_fin: '2025-12-31',
        nb_collectes: 1,
      },
    ],
    ['id'],
  );
  await upsert(
    client,
    'plateforme.documents_generaux_savr',
    [
      {
        id: U('doc_1'),
        type_document: 'cgv',
        entity_type: 'organisation',
        entity_id: U('org_tr_kaspia'),
        statut: 'genere',
        genere_at: ts(-200),
      },
      {
        id: U('doc_2'),
        type_document: 'recap_annuel',
        entity_type: 'organisation',
        entity_id: U('org_tr_fleurdemets'),
        statut: 'genere',
        genere_at: ts(-30),
      },
    ],
    ['id'],
  );

  // ── 17. Outbox (G4) : 3 events dont 1 non consommé ────────────────────────
  await upsert(
    client,
    'plateforme.outbox_events',
    [
      {
        id: U('ob_e1'),
        aggregate_type: 'collecte',
        aggregate_id: U('col_zd_programmee'),
        event_type: 'collecte.creee',
        payload: jsonb({ collecte_id: U('col_zd_programmee') }),
        consumer: 'adapter_mts1',
        statut: 'done',
        attempts: 1,
        processed_at: ts(-1),
      },
      {
        id: U('ob_e2'),
        aggregate_type: 'collecte',
        aggregate_id: U('col_dispatch_dirty'),
        event_type: 'collecte.modifiee',
        payload: jsonb({ collecte_id: U('col_dispatch_dirty') }),
        consumer: 'adapter_mts1',
        statut: 'done',
        attempts: 1,
        processed_at: ts(-1),
      },
      {
        id: U('ob_e3'),
        aggregate_type: 'collecte',
        aggregate_id: U('col_ag_annule_tardif'),
        event_type: 'collecte.annulee',
        payload: jsonb({ collecte_id: U('col_ag_annule_tardif') }),
        consumer: null,
        statut: 'pending',
        attempts: 0,
      },
    ],
    ['id'],
  );

  // ── 18. Emails envoyés (6 dont 1 échec) ───────────────────────────────────
  await upsert(
    client,
    'plateforme.emails_envoyes',
    [
      email(
        'em_1',
        'bordereau_disponible',
        'manager.kaspia',
        'Votre bordereau est disponible',
        'delivered',
        -197,
      ),
      email(
        'em_2',
        'bienvenue_organisation',
        'manager.fleurdemets',
        'Bienvenue sur Savr',
        'delivered',
        -300,
      ),
      email(
        'em_3',
        'confirmation_collecte',
        'manager.kaspia',
        'Confirmation de votre collecte',
        'sent',
        -205,
      ),
      email(
        'em_4',
        'attribution_association',
        'contact.alpha',
        'Collecte Anti-Gaspi attribuée',
        'delivered',
        -88,
      ),
      email(
        'em_5',
        'pack_ag_active',
        'manager.fleurdemets',
        'Votre pack Anti-Gaspi est activé',
        'delivered',
        -120,
      ),
      email(
        'em_echec',
        'bordereau_disponible',
        'manager.fail',
        'Votre bordereau est disponible',
        'failed',
        -10,
      ),
    ],
    ['id'],
  );

  // ── 19. Audit log (5) — id bigserial, insertion simple après reset ────────
  await client.query(
    `INSERT INTO plateforme.audit_log (user_id, role, action, table_name, record_id, old_values, new_values, created_at)
     VALUES
       ($1,'ops_savr','UPDATE','packs_antgaspi',$2,'{"notes":null}','{"notes":"ajustement Ops"}',$8),
       ($3,'admin_savr','UPDATE','users',$4,'{"actif":true}','{"actif":false}',$8),
       ($5,'gestionnaire_lieux','UPDATE','lieux',$6,'{}','{"contraintes_horaires":"20h-6h"}',$8),
       ($1,'ops_savr','UPDATE','factures',$7,'{"statut":"brouillon"}','{"statut":"envoyee"}',$8),
       (NULL,'system','INSERT','attributions_antgaspi',$9,'{}','{"mode":"auto_accept"}',$8)`,
    [
      U('user_ops1'),
      U('pack_fleurdemets'),
      U('user_admin'),
      U('user_collab_kaspia'),
      U('user_gest_viparis'),
      U('lieu_pdv'),
      U('fac_zd_collecte_01'),
      ts(-100, 10),
      U('attr_auto'),
    ],
  );

  // ── 20. Intégrations (logs + inbox = 4) ───────────────────────────────────
  await upsert(
    client,
    'plateforme.integrations_logs',
    [
      {
        id: U('ilog_1'),
        integration: 'mts1',
        direction: 'entrant',
        methode: 'GET',
        endpoint: '/v3/orders',
        statut_http: 200,
        duree_ms: 120,
        created_at: ts(-5, 6),
      },
      {
        id: U('ilog_2'),
        integration: 'mts1',
        direction: 'sortant',
        methode: 'POST',
        endpoint: '/v3/orders',
        statut_http: 201,
        duree_ms: 230,
        created_at: ts(-30, 6),
      },
    ],
    ['id', 'created_at'],
  );
  await upsert(
    client,
    'plateforme.integrations_inbox',
    [
      {
        id: U('inbox_1'),
        source: 'mts1',
        event_type: 'tour.status',
        event_id_externe: 'evt-min-001',
        payload: jsonb({ tourId: 'T1', status: 'DELIVERED' }),
        traite: true,
        traite_at: ts(-5, 6),
      },
      {
        id: U('inbox_2'),
        source: 'mts1',
        event_type: 'tour.status',
        event_id_externe: 'evt-min-002',
        payload: jsonb({ tourId: 'T2', status: 'IN_PROGRESS' }),
        traite: false,
      },
    ],
    ['id'],
  );

  // ── 21. Coefficient perte labo (1 custom) ─────────────────────────────────
  await upsert(
    client,
    'plateforme.coefficients_perte_labo',
    [
      {
        id: U('coeff_kaspia'),
        organisation_id: U('org_tr_kaspia'),
        annee_reference: 2025,
        coefficient_kg_couvert: 0.18,
        saisi_par: U('user_ops1'),
        source_commentaire: 'Estimation labo 2025',
      },
    ],
    ['id'],
  );

  // grilleZdId est relu pour valider la présence du référentiel (cf. plus haut).
  void grilleZdId;
}

// ───────────────────────── builders ────────────────────────────────────────
function org(slug: string, nom: string, type: string, raison: string): Row {
  return {
    id: U(slug),
    nom,
    raison_sociale: raison,
    type,
    email_principal: seedEmail('contact.' + slug),
    actif: true,
  };
}
function entite(
  slug: string,
  orgSlug: string,
  raison: string,
  siret: string,
  ville: string,
  cp: string,
): Row {
  return {
    id: U(slug),
    organisation_id: U(orgSlug),
    raison_sociale: raison,
    siret,
    adresse_facturation: '1 Adresse Facturation',
    code_postal: cp,
    ville,
    siret_verification: 'verifie',
    siret_verifie_le: ts(-300, 10),
    conditions_paiement_jours: 30,
    entite_par_defaut: true,
  };
}
function user(
  slug: string,
  orgSlug: string,
  role: string,
  prenom: string,
  nom: string,
): Row {
  return {
    id: U(slug),
    organisation_id: U(orgSlug),
    email: seedEmail(slug.replace(/^user_/, '')),
    prenom,
    nom,
    role,
    actif: true,
  };
}
function lieu(
  slug: string,
  nom: string,
  adresse: string,
  cp: string,
  ville: string,
  region: string,
  vehicule: string,
  controle = false,
): Row {
  return {
    id: U(slug),
    nom,
    adresse_acces: adresse,
    code_postal: cp,
    ville,
    region,
    type_vehicule_max: vehicule,
    controle_acces_requis_default: controle,
    actif: true,
  };
}
function orgLieu(orgSlug: string, lieuSlug: string): Row {
  return {
    id: U(`ol_${orgSlug}_${lieuSlug}`),
    organisation_id: U(orgSlug),
    lieu_id: U(lieuSlug),
  };
}
function prest(slug: string, nom: string, code: string, siret: string): Row {
  return {
    id: U(slug),
    nom,
    code,
    type_prestation: ['zd', 'ag'],
    mode_integration: 'mts1',
    siret,
    statut: 'actif',
  };
}
function transp(
  slug: string,
  nom: string,
  siren: string,
  adresse: string,
  cp: string,
  ville: string,
  vehicules: string[],
  codeMts1: string,
): Row {
  return {
    id: U(slug),
    nom,
    siren,
    adresse,
    code_postal: cp,
    ville,
    types_vehicules: vehicules,
    type_tms: 'mts1',
    code_transporteur_mts1: codeMts1,
    contact_nom: 'Ops ' + nom,
    contact_email: seedEmail('ops.' + slug),
    contact_telephone: fakePhone(200 + siren.length),
    actif: true,
  };
}
function pack(
  slug: string,
  orgSlug: string,
  tarifId: string,
  nb: number,
  utilisees: number,
  annulees: number,
  statut: string,
  dateAchat: string,
): Row {
  return {
    id: U(slug),
    organisation_id: U(orgSlug),
    tarif_pack_id: tarifId,
    nb_collectes: nb,
    nb_utilisees: utilisees,
    nb_annulees: annulees,
    statut,
    date_achat: dateAchat,
  };
}
function col(
  slug: string,
  ev: string,
  type: string,
  statut: string,
  off: number,
  prestId: string | null,
  extra: Row,
): ColSpec {
  return {
    slug,
    ev,
    id: U(slug),
    evenement_id: U(ev),
    type,
    statut,
    date_collecte: d(off),
    heure_collecte: '22:00:00',
    prestataire_logistique_id: prestId,
    ...extra,
  };
}
function cflux(
  slug: string,
  colSlug: string,
  fluxId: string,
  poids: number,
): Row {
  return {
    id: U(slug),
    collecte_id: U(colSlug),
    flux_id: fluxId,
    poids_reel_kg: poids,
  };
}
function attr(
  slug: string,
  colSlug: string,
  assoSlug: string,
  transpId: string,
  branche: string,
  mode: string,
  override?: string,
): Row {
  const r: Row = {
    id: U(slug),
    collecte_id: U(colSlug),
    association_id: U(assoSlug),
    transporteur_id: transpId,
    branche_attribution: branche,
    mode_validation: mode,
  };
  if (override) {
    r.motif_override = override;
    r.motif_override_libre = override;
  }
  return r;
}
function tournee(
  slug: string,
  ref: string,
  off: number,
  prestId: string,
  extRef: string,
): Row {
  return {
    id: U(slug),
    reference_interne: ref,
    date_tournee: d(off),
    creneau: 'nuit',
    prestataire_logistique_id: prestId,
    statut: 'terminee',
    external_ref_commande: extRef,
    tms_reference: extRef + '-TOUR',
    heure_debut_reelle: ts(off, 22),
    heure_fin_reelle: ts(off + 1, 1),
  };
}
function ct(colSlug: string, tourSlug: string): Row {
  return {
    id: U(`ct_${colSlug}_${tourSlug}`),
    collecte_id: U(colSlug),
    tournee_id: U(tourSlug),
  };
}
function facture(
  slug: string,
  entiteSlug: string,
  orgSlug: string,
  numero: string,
  statut: string,
  off: number,
  ht: number,
  extra: Row,
): Row {
  const tva = Math.round(ht * 0.2 * 100) / 100;
  return {
    id: U(slug),
    entite_facturation_id: U(entiteSlug),
    organisation_id: U(orgSlug),
    numero_facture: numero,
    statut,
    date_emission: d(off),
    montant_ht: ht,
    taux_tva: 20,
    montant_tva: tva,
    montant_ttc: ht + tva,
    ...extra,
  };
}
function fcol(
  slug: string,
  facSlug: string,
  colSlug: string | null,
  ht: number,
  desc: string,
): Row {
  return {
    id: U(slug),
    facture_id: U(facSlug),
    collecte_id: colSlug ? U(colSlug) : null,
    montant_ht: ht,
    description: desc,
  };
}
function bordereau(slug: string, colSlug: string, off: number): Row {
  return {
    id: U(slug),
    collecte_id: U(colSlug),
    statut: 'genere',
    genere_at: ts(off),
    eligible_at: ts(off - 1),
  };
}
function email(
  slug: string,
  code: string,
  dest: string,
  sujet: string,
  statut: string,
  off: number,
): Row {
  return {
    id: U(slug),
    template_code: code,
    destinataire: seedEmail(dest),
    sujet,
    statut,
    resend_id: 'resend-' + slug,
    envoye_at: ts(off, 6),
  };
}
