/**
 * seed_demo — dataset autonome timeline 12 mois (478 collectes). Reset < 5 min.
 * Lit les matrices CSV committées (fixtures/data/), ne les génère pas.
 *
 * Périmètre : plateforme.* + shared.* (jamais tms.*). GATE EVEREST : zéro
 * mission Everest ; A Toutes! existe en référentiel mais ne sert aucune
 * collecte (bascule fallback MTS-1 au go-live).
 *
 * Le référentiel (types_evenements, flux_dechets, grilles, packs, templates…)
 * est seedé par les migrations : relu par clé naturelle, jamais réinséré.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type pg from 'pg';
import { seedUuid } from './uuid.js';
import { upsert, lookupMap, jsonb, type Row } from './db.js';
import { fakePhone, seedEmail } from './constants.js';

const U = seedUuid;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

// Au-delà du 2026-05-01 (mois courant de la timeline) → realisee, sinon cloturee.
const REALISEE_FROM = '2026-05-01';

function tsAt(dateStr: string, hour: number): string {
  const dd = new Date(dateStr + 'T00:00:00Z');
  dd.setUTCHours(hour, 0, 0, 0);
  return dd.toISOString();
}

type CsvCollecte = {
  slug: string;
  traiteur: string;
  type: string;
  date: string;
  lieu: string;
  pax: number;
  camions: number;
};
type CsvTournee = {
  slug: string;
  transporteur: string;
  date: string;
  collectes: string[];
  statut: string;
};

function parseCollectes(): CsvCollecte[] {
  const csv = readFileSync(
    resolve(REPO_ROOT, 'fixtures/data/matrix_collectes.csv'),
    'utf8',
  );
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const [slug, traiteur, type, date, lieu, pax, camions] = l.split(',');
      return {
        slug: slug!,
        traiteur: traiteur!,
        type: type!,
        date: date!,
        lieu: lieu!,
        pax: Number(pax),
        camions: Number(camions),
      };
    });
}
function parseTournees(): CsvTournee[] {
  const csv = readFileSync(
    resolve(REPO_ROOT, 'fixtures/data/matrix_tournees.csv'),
    'utf8',
  );
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const [slug, transporteur, , date, collectes, statut] = l.split(',');
      return {
        slug: slug!,
        transporteur: transporteur!,
        date: date!,
        collectes: collectes!.split('|'),
        statut: statut!,
      };
    });
}

export async function seedDemo(client: pg.Client): Promise<void> {
  // ── Référentiel ───────────────────────────────────────────────────────────
  const grille = await lookupMap(
    client,
    'select id, nom from plateforme.grilles_tarifaires_zd where est_defaut',
    'nom',
  );
  if (!grille.get('Grille standard V1'))
    throw new Error('Référentiel manquant');
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
  const F = (c: string) => flux.get(c)!;
  const tEvZd = typeEv.get('cocktail_repas_complet')!;
  const tEvAg = typeEv.get('repas_assis')!;

  // ── Organisations ─────────────────────────────────────────────────────────
  const traiteurs = [
    'kaspia',
    'fleurdemets',
    'cirette',
    'butard',
    'grandchemin',
    'lenotre',
    'potel',
    'nomad',
  ];
  const orgs: Row[] = [
    org('org_savr', 'Savr', 'agence', 'Savr SAS'),
    ...traiteurs.map((t) =>
      org(`org_tr_${t}`, cap(t), 'traiteur', `${cap(t)} SAS`),
    ),
    org('org_ge_viparis', 'Viparis', 'gestionnaire_lieux', 'Viparis SAS'),
    org(
      'org_ge_artsforains',
      'Musée des Arts Forains',
      'gestionnaire_lieux',
      'Pavillons de Bercy SAS',
    ),
    org(
      'org_ge_trianon',
      'Trianon — Élysée Montmartre',
      'gestionnaire_lieux',
      'Trianon SAS',
    ),
    org('org_ag_caromy', 'Caromy Event', 'agence', 'Caromy Event SARL'),
    org('org_ag_arep', 'Agence AREP', 'agence', 'AREP SARL'),
  ];
  await upsert(client, 'plateforme.organisations', orgs, ['id']);

  // ── Entités de facturation (1/traiteur + Potel 2e) ────────────────────────
  const entites: Row[] = traiteurs.map((t, i) =>
    entite(
      `entite_${t}`,
      `org_tr_${t}`,
      `${cap(t)} SAS`,
      siret(10 + i),
      t === 'cirette' ? 'Rouen' : 'Paris',
    ),
  );
  entites.push(
    entite(
      'entite_potel_2',
      'org_tr_potel',
      'Potel et Chabot — Entité 2',
      siret(40),
      'Paris',
      false,
    ),
  );
  await upsert(client, 'plateforme.entites_facturation', entites, ['id']);

  // ── Users ─────────────────────────────────────────────────────────────────
  const users: Row[] = [
    user('user_admin', 'org_savr', 'admin_savr', 'Valentin', 'Admin'),
    user('user_ops1', 'org_savr', 'ops_savr', 'Ops', 'Un'),
    user('user_ops2', 'org_savr', 'ops_savr', 'Ops', 'Deux'),
    user('user_ops3', 'org_savr', 'ops_savr', 'Ops', 'Trois'),
    user(
      'user_commercial',
      'org_savr',
      'traiteur_commercial',
      'Commercial',
      'Savr',
    ),
    user(
      'user_commercial2',
      'org_savr',
      'traiteur_commercial',
      'Commerciale',
      'Savr',
    ),
  ];
  for (const t of traiteurs) {
    users.push(
      user(
        `user_manager_${t}`,
        `org_tr_${t}`,
        'traiteur_manager',
        cap(t),
        'Manager',
      ),
    );
    users.push(
      user(
        `user_collab_${t}`,
        `org_tr_${t}`,
        'traiteur_commercial',
        cap(t),
        'Collab',
      ),
    );
  }
  users.push(
    user(
      'user_gest_viparis',
      'org_ge_viparis',
      'gestionnaire_lieux',
      'Victor',
      'Paris',
    ),
  );
  users.push(
    user(
      'user_collab_viparis',
      'org_ge_viparis',
      'gestionnaire_lieux',
      'Valérie',
      'Paris',
    ),
  );
  users.push(
    user(
      'user_gest_artsforains',
      'org_ge_artsforains',
      'gestionnaire_lieux',
      'Arthur',
      'Forain',
    ),
  );
  users.push(
    user(
      'user_gest_trianon',
      'org_ge_trianon',
      'gestionnaire_lieux',
      'Tristan',
      'Trianon',
    ),
  );
  users.push(
    user('user_agence_caromy', 'org_ag_caromy', 'agence', 'Carole', 'Romy'),
  );
  users.push(
    user('user_collab_caromy', 'org_ag_caromy', 'agence', 'Karim', 'Romy'),
  );
  users.push(
    user('user_agence_arep', 'org_ag_arep', 'agence', 'Adèle', 'Arep'),
  );
  await upsert(client, 'plateforme.users', users, ['id']);

  // ── Lieux (9 de la matrice + extras = 18) ─────────────────────────────────
  const lieux: Row[] = [
    lieu(
      'lieu_porte_versailles',
      'Paris Expo Porte de Versailles',
      '1 Place de la Porte de Versailles',
      '75015',
      'Paris',
      'idf',
      'poids_lourd',
    ),
    lieu(
      'lieu_palais_congres',
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
      'lieu_rouen_normandie',
      'Salle Rouen Normandie',
      '5 Rue des Chartreux',
      '76000',
      'Rouen',
      'province',
      'fourgon',
    ),
    lieu(
      'lieu_convention_centre',
      'Paris Convention Centre',
      '52 Place de la Porte de Versailles',
      '75015',
      'Paris',
      'idf',
      'poids_lourd',
    ),
    lieu(
      'lieu_le_bourget',
      'Paris Le Bourget',
      '2 Rue de la Haie Coq',
      '93300',
      'Le Bourget',
      'idf',
      'poids_lourd',
    ),
    lieu(
      'lieu_trianon',
      'Trianon — Élysée Montmartre',
      '80 Boulevard de Rochechouart',
      '75018',
      'Paris',
      'idf',
      'fourgon',
    ),
    lieu(
      'lieu_villepinte',
      'Paris Nord Villepinte',
      'ZAC Paris Nord 2',
      '93420',
      'Villepinte',
      'idf',
      'poids_lourd',
    ),
    lieu(
      'lieu_cnit',
      'CNIT Forest',
      '2 Place de la Défense',
      '92800',
      'Puteaux',
      'idf',
      'poids_lourd',
    ),
    lieu(
      'lieu_carrousel',
      'Les Salles du Carrousel',
      '99 Rue de Rivoli',
      '75001',
      'Paris',
      'idf',
      'fourgon',
    ),
    lieu(
      'lieu_rothschild',
      'Hôtel Salomon de Rothschild',
      '11 Rue Berryer',
      '75008',
      'Paris',
      'idf',
      'fourgon',
    ),
    lieu(
      'lieu_la_serre',
      'La Serre',
      '1 Avenue de la Porte de Versailles',
      '75015',
      'Paris',
      'idf',
      'fourgon',
    ),
    lieu(
      'lieu_paris_nord',
      'Paris Nord 2',
      '165 Avenue du Bois de la Pie',
      '93420',
      'Villepinte',
      'idf',
      'poids_lourd',
    ),
    lieu(
      'lieu_ponctuel_1',
      'Adresse libre — Paris 8e',
      '15 Avenue Hoche',
      '75008',
      'Paris',
      'idf',
      'fourgon',
    ),
    lieu(
      'lieu_ponctuel_2',
      'Adresse libre — Neuilly',
      '5 Avenue Charles de Gaulle',
      '92200',
      'Neuilly',
      'idf',
      'fourgon',
    ),
    lieu(
      'lieu_ponctuel_3',
      'Adresse libre — Lyon',
      '20 Rue de la République',
      '69002',
      'Lyon',
      'province',
      'fourgon',
    ),
    lieu(
      'lieu_ponctuel_4',
      'Adresse libre — Versailles',
      '1 Place d’Armes',
      '78000',
      'Versailles',
      'idf',
      'fourgon',
    ),
  ];
  await upsert(client, 'plateforme.lieux', lieux, ['id']);
  await upsert(
    client,
    'plateforme.organisations_lieux',
    [
      ...[
        'lieu_porte_versailles',
        'lieu_palais_congres',
        'lieu_champerret',
        'lieu_convention_centre',
        'lieu_le_bourget',
        'lieu_villepinte',
        'lieu_cnit',
        'lieu_carrousel',
        'lieu_rothschild',
        'lieu_la_serre',
      ].map((l) => orgLieu('org_ge_viparis', l)),
      orgLieu('org_ge_artsforains', 'lieu_arts_forains'),
      orgLieu('org_ge_trianon', 'lieu_trianon'),
    ],
    ['id'],
  );

  // ── Associations (5 dont 1 désactivée) ────────────────────────────────────
  await upsert(
    client,
    'plateforme.associations',
    [
      asso('asso_alpha', 'Association Alpha (fictif)', 'idf', true, true),
      asso('asso_bravo', 'Association Bravo (fictif)', 'idf', false, true),
      asso('asso_charlie', 'Association Charlie (fictif)', 'idf', true, true),
      asso('asso_delta', 'Association Delta (fictif)', 'idf', true, false), // désactivée
      asso('asso_echo', 'Association Echo (fictif)', 'province', false, true),
    ],
    ['id'],
  );

  // ── Prestataires + transporteurs (4 + A Toutes! gate) ─────────────────────
  await upsert(
    client,
    'shared.prestataires',
    [
      prest('prest_strike', 'Strike', 'STRIKE', siret(70)),
      prest('prest_marathon', 'Marathon', 'MARATHON', siret(80)),
      prest('prest_transnormandie', 'Transnormandie', 'TRANSNOR', siret(90)),
      prest('prest_a_toutes', 'A Toutes!', 'ATOUTES', siret(95)),
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
        '10 Rue Logistique',
        '75019',
        'Paris',
        ['poids_lourd'],
        'mts1',
        'STRIKE-MTS1',
        'prest_strike',
      ),
      transp(
        'transp_marathon',
        'Marathon',
        '888888888',
        '22 Rue Marathon',
        '75020',
        'Paris',
        ['fourgon', 'poids_lourd'],
        'mts1',
        'MARATHON-MTS1',
        'prest_marathon',
      ),
      transp(
        'transp_transnor',
        'Transnormandie',
        '999999999',
        '5 Quai Bourse',
        '76000',
        'Rouen',
        ['fourgon'],
        'mts1',
        'TRANSNOR-MTS1',
        'prest_transnormandie',
      ),
      transp(
        'transp_a_toutes',
        'A Toutes!',
        '111111111',
        '3 Rue du Vélo',
        '75011',
        'Paris',
        ['velo_cargo'],
        'a_toutes',
        null,
        'prest_a_toutes',
      ),
      transp(
        'transp_sans_code',
        'Presta sans code',
        '222222222',
        '9 Rue Inconnue',
        '75012',
        'Paris',
        ['fourgon'],
        'mts1',
        null,
        null,
      ), // R_code_mts1 négatif + pont prestataire absent (fixture négative)
    ],
    ['id'],
  );

  // ── Tarifs négociés (Kaspia -15%, Potel -8%, Viparis -5%) ─────────────────
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
      },
      {
        id: U('tn_potel'),
        activite: 'zd',
        scope: 'organisation',
        organisation_id: U('org_tr_potel'),
        gestionnaire_organisation_id: null,
        lieu_id: null,
        remise_pct: 0.08,
        valide_du: '2025-01-01',
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
      },
    ],
    ['id'],
  );

  // ── Packs AG (1 actif/traiteur AG + 2 épuisés) ────────────────────────────
  const packs: Row[] = [];
  for (const t of traiteurs) {
    if (t === 'nomad') continue; // compte vide
    const used = t === 'butard' ? 18 : 6; // Butard = bas ≤ 10% (18/20)
    packs.push(
      pack(`pack_${t}`, `org_tr_${t}`, 20, used, 'actif', '2025-09-01'),
    );
  }
  packs.push(
    pack(
      'pack_lenotre_epuise',
      'org_tr_lenotre',
      10,
      10,
      'epuise',
      '2025-02-01',
    ),
  );
  packs.push(
    pack('pack_potel_epuise', 'org_tr_potel', 10, 10, 'epuise', '2025-03-01'),
  );
  await upsert(client, 'plateforme.packs_antgaspi', packs, ['id']);

  // ── Événements + collectes (478, 1:1 depuis la matrice) ───────────────────
  const rows = parseCollectes();
  const mgr = (t: string) => U(`user_manager_${t}`);
  const evRows: Row[] = [];
  const colRows: Row[] = [];
  rows.forEach((r, i) => {
    const t = r.traiteur.replace(/^org_tr_/, '');
    const evId = U('ev_' + r.slug);
    const isAg = r.type === 'anti_gaspi';
    // ~1 événement / 9 est PROGRAMMÉ par une agence (donneur d'ordre) et exécuté par
    // le traiteur → alimente le dashboard agence (scopé sur evenements.organisation_id).
    const isAgenceEvent = i % 9 === 0;
    evRows.push({
      id: evId,
      organisation_id: isAgenceEvent ? U('org_ag_caromy') : U(r.traiteur),
      traiteur_operationnel_organisation_id: U(r.traiteur),
      entite_facturation_id: U(`entite_${t}`),
      lieu_id: U(r.lieu),
      created_by: isAgenceEvent ? U('user_agence_caromy') : mgr(t),
      nom_evenement: `${cap(t)} — ${r.date}`,
      type_evenement_id: isAg ? tEvAg : tEvZd,
      date_evenement: r.date,
      pax: r.pax,
      contact_principal_nom: `Contact ${cap(t)}`,
      contact_principal_telephone: fakePhone(300 + (i % 90)),
    });
    const realisee = r.date >= REALISEE_FROM;
    const statut = realisee ? 'realisee' : 'cloturee';
    const presta =
      r.lieu === 'lieu_rouen_normandie'
        ? 'transnormandie'
        : i % 2 === 0
          ? 'strike'
          : 'marathon';
    const extra: Row = { nb_camions_demande: r.camions };
    if (isAg) {
      extra.pack_antgaspi_id = t === 'nomad' ? null : U(`pack_${t}`);
      extra.volume_estime_repas = Math.round(0.1 * r.pax);
    } else {
      extra.taux_recyclage = 70 + (i % 20);
    }
    // Toute collecte de cette matrice est realisee OU cloturee = collecte réalisée :
    // realisee_at doit TOUJOURS être posé (une cloturee est passée par realisee).
    // Les dashboards (gestionnaire + admin/dashboard-client) filtrent la période sur realisee_at.
    extra.realisee_at = tsAt(r.date, 23);
    colRows.push({
      id: U(r.slug),
      evenement_id: evId,
      type: r.type,
      statut,
      date_collecte: r.date,
      heure_collecte: '22:00:00',
      prestataire_logistique_id: U('prest_' + presta),
      ...extra,
    });
  });
  await upsert(client, 'plateforme.evenements', evRows, ['id']);
  // Insertion des collectes par lots (limite de paramètres SQL).
  await batchUpsert(client, 'plateforme.collectes', colRows, ['id'], 200);

  // ── Collecte flux (ZD : 3 flux/collecte) ──────────────────────────────────
  const fluxRows: Row[] = [];
  rows
    .filter((r) => r.type === 'zero_dechet')
    .forEach((r, i) => {
      const base = r.pax * 0.3;
      // Les 5 flux ZD présents sur chaque collecte (Bloc 2 barres empilées + Bloc 4 donut
      // utilisent les 5 flux : biodechet/emballage/carton/verre/dechet_residuel).
      fluxRows.push(
        cflux(`cf_${r.slug}_bio`, r.slug, F('biodechet'), round1(base * 0.4)),
      );
      fluxRows.push(
        cflux(`cf_${r.slug}_carton`, r.slug, F('carton'), round1(base * 0.25)),
      );
      fluxRows.push(
        cflux(`cf_${r.slug}_emb`, r.slug, F('emballage'), round1(base * 0.15)),
      );
      // verre : normal, ou alerte MIN (1 collecte / 40)
      fluxRows.push(
        cflux(
          `cf_${r.slug}_verre`,
          r.slug,
          F('verre'),
          i % 40 === 0 ? 1.5 : round1(base * 0.12),
        ),
      );
      // dechet_residuel : normal, ou alerte MAX (1 collecte / 40)
      fluxRows.push(
        cflux(
          `cf_${r.slug}_residuel`,
          r.slug,
          F('dechet_residuel'),
          i % 40 === 20 ? 5300 : round1(base * 0.08),
        ),
      );
    });
  await batchUpsert(client, 'plateforme.collecte_flux', fluxRows, ['id'], 300);

  // ── Calcul CO₂ ZD (rejeu de la transition de clôture) ─────────────────────
  // Le trigger `trg_co2_zd_cloture` est AFTER UPDATE (transition realisee→cloturee) :
  // le seed INSÈRE les collectes déjà 'cloturee', donc le trigger ne se déclenche
  // jamais → co2_induit/evite/net + taux_recyclage restent vides en dev (héros CO₂
  // R24 masqué, carte KPI CO₂ à 0). On rejoue la transition sur les collectes ZD
  // clôturées, APRÈS l'insertion des flux, pour peupler ces grandeurs exactement
  // comme en prod (où la clôture est un UPDATE via le cron embargo H+24). ZD only :
  // aucune régression de pack (triggers pack = AG). Compte 'cloturee' inchangé
  // (on termine en 'cloturee' — cf. seed:check).
  await client.query(`
    DROP TABLE IF EXISTS _seed_zd_clot;
    CREATE TEMP TABLE _seed_zd_clot AS
      SELECT id FROM plateforme.collectes
      WHERE type = 'zero_dechet' AND statut = 'cloturee';
    UPDATE plateforme.collectes SET statut = 'realisee'
      WHERE id IN (SELECT id FROM _seed_zd_clot);
    UPDATE plateforme.collectes SET statut = 'cloturee'
      WHERE id IN (SELECT id FROM _seed_zd_clot);
    DROP TABLE _seed_zd_clot;
  `);

  // ── Attributions AG (1/collecte AG) ───────────────────────────────────────
  const assos = ['asso_alpha', 'asso_bravo', 'asso_charlie', 'asso_echo'];
  const attrRows: Row[] = rows
    .filter((r) => r.type === 'anti_gaspi')
    .map((r, i) => {
      const isProvince = r.lieu === 'lieu_rouen_normandie';
      const tr = isProvince ? 'transnor' : i % 2 === 0 ? 'marathon' : 'strike';
      const mode =
        i % 5 === 0
          ? 'auto_accept'
          : i % 7 === 0
            ? 'manuel_override'
            : 'manuel_top1';
      // Repas donnés ≈ 8-12 % du pax (varie pour une courbe ratio non plate).
      const volumeRepas = Math.round(r.pax * (0.08 + (i % 6) * 0.008));
      const a = attr(
        `attr_${r.slug}`,
        r.slug,
        assos[i % assos.length]!,
        U('transp_' + tr),
        isProvince ? 'province' : 'idf',
        mode,
        volumeRepas,
      );
      return a;
    });
  await batchUpsert(
    client,
    'plateforme.attributions_antgaspi',
    attrRows,
    ['id'],
    300,
  );

  // ── Calcul CO₂ AG (UPDATE nu, sans transition de statut) ──────────────────
  // Même logique que le ZD ci-dessus MAIS sans round-trip : rejouer cloturee→
  // realisee déclencherait `trg_pack_debit_realisee` (BEFORE UPDATE OF statut) →
  // double-débit du pack. On peuple co2_evite_kg + snapshot par un UPDATE qui NE
  // NOMME PAS `statut` (les 3 triggers pack ne se déclenchent jamais). Formule +
  // snapshot = copie exacte de trg_co2_ag_cloture. volume_repas_realise est déjà
  // seedé sur les attributions AG (cf. attr(..., volumeRepas)) → la 1re requête
  // est un no-op ici (guard IS NULL), conservée pour la symétrie avec seed_minimal.
  await client.query(`
    UPDATE plateforme.attributions_antgaspi aa
    SET volume_repas_realise = c.volume_estime_repas
    FROM plateforme.collectes c
    WHERE aa.collecte_id = c.id
      AND c.type = 'anti_gaspi' AND c.statut = 'cloturee'
      AND aa.volume_repas_realise IS NULL
      AND c.volume_estime_repas IS NOT NULL;

    WITH fac AS (
      SELECT
        COALESCE((SELECT facteur_co2_evite_par_repas_kg
                    FROM plateforme.parametres_facteurs_co2_ag
                    WHERE actif = true ORDER BY date_maj DESC LIMIT 1), 2.5) AS facteur,
        COALESCE((SELECT date_maj
                    FROM plateforme.parametres_facteurs_co2_ag
                    WHERE actif = true ORDER BY date_maj DESC LIMIT 1), now()) AS facteur_ts,
        COALESCE((SELECT valeur
                    FROM plateforme.parametres_co2_divers
                    WHERE cle = 'equiv_km_voiture_kgco2'), 0.218) AS fe_voiture
    ),
    calc AS (
      SELECT c.id, COALESCE(aa.volume_repas_realise, 0) AS volume
      FROM plateforme.collectes c
        LEFT JOIN plateforme.attributions_antgaspi aa ON aa.collecte_id = c.id
      WHERE c.type = 'anti_gaspi' AND c.statut = 'cloturee'
    )
    UPDATE plateforme.collectes c
    SET co2_evite_kg = calc.volume * fac.facteur,
        co2_facteurs_snapshot = jsonb_build_object(
          'type', 'anti_gaspi',
          'facteur_co2_evite_par_repas_kg', fac.facteur,
          'volume_repas_realise', calc.volume,
          'equivalences', jsonb_build_object(
            'km_voiture', round((calc.volume * fac.facteur) / fac.fe_voiture)::integer
          ),
          'version_parametres_at', fac.facteur_ts::text
        ),
        updated_at = now()
    FROM calc, fac
    WHERE c.id = calc.id;
  `);

  await upsert(
    client,
    'plateforme.config_auto_accept_ag',
    [
      {
        id: U('cfg_aa_kaspia'),
        organisation_id: U('org_tr_kaspia'),
        association_id: U('asso_alpha'),
        transporteur_id: U('transp_strike'),
        auto_accept_actif: true,
        seuil_pax_min: 100,
        seuil_pax_max: 1500,
      },
      {
        id: U('cfg_aa_potel'),
        organisation_id: U('org_tr_potel'),
        association_id: U('asso_charlie'),
        transporteur_id: U('transp_marathon'),
        auto_accept_actif: true,
      },
      {
        id: U('cfg_aa_cirette'),
        organisation_id: U('org_tr_cirette'),
        association_id: U('asso_echo'),
        transporteur_id: U('transp_transnor'),
        auto_accept_actif: false,
      },
    ],
    ['id'],
  );

  // ── Tournées + collecte_tournees (depuis CSV) ─────────────────────────────
  const tournees = parseTournees();
  const tourRows: Row[] = tournees.map((t) => ({
    id: U(t.slug),
    reference_interne: t.slug.toUpperCase(),
    date_tournee: t.date,
    creneau: 'nuit',
    prestataire_logistique_id: U(t.transporteur),
    statut: 'terminee',
    external_ref_commande: 'MTS1-' + t.slug,
    tms_reference: 'TOUR-' + t.slug,
    heure_debut_reelle: tsAt(t.date, 22),
    heure_fin_reelle: tsAt(t.date, 23),
  }));
  await batchUpsert(client, 'plateforme.tournees', tourRows, ['id'], 200);
  // La matrice tournées référence quelques collectes AG absentes de la matrice
  // collectes (drift fixtures, cf. DIVERGENCE M0.7) : on ne lie que celles qui
  // existent réellement, et on journalise les références ignorées.
  const validCols = new Set(rows.map((r) => r.slug));
  const ctRows: Row[] = [];
  let skipped = 0;
  for (const t of tournees) {
    for (const colSlug of t.collectes) {
      if (!validCols.has(colSlug)) {
        skipped++;
        continue;
      }
      ctRows.push({
        id: U(`ct_${colSlug}_${t.slug}`),
        collecte_id: U(colSlug),
        tournee_id: U(t.slug),
      });
    }
  }
  if (skipped > 0) {
    console.log(
      `[seed:demo] ${skipped} liens tournée→collecte ignorés (collecte absente de la matrice).`,
    );
  }
  await batchUpsert(
    client,
    'plateforme.collecte_tournees',
    ctRows,
    ['id'],
    300,
  );

  // ── Factures ZD mensuelles groupées par traiteur + achats pack ────────────
  await seedFactures(client, rows);

  // ── Documents : bordereaux (ZD clôturée) + attestations (AG clôturée) ─────
  const bordRows: Row[] = rows
    .filter((r) => r.type === 'zero_dechet' && r.date < REALISEE_FROM)
    .map((r) => bordereau(`bord_${r.slug}`, r.slug, r.date));
  await batchUpsert(
    client,
    'plateforme.bordereaux_savr',
    bordRows,
    ['id'],
    300,
  );

  const attRows: Row[] = rows
    .filter((r) => r.type === 'anti_gaspi' && r.date < REALISEE_FROM)
    .map((r, i) => {
      const assoSlug = assos[i % assos.length]!;
      const habilitee =
        assoSlug === 'asso_alpha' || assoSlug === 'asso_charlie';
      return {
        id: U(`att_${r.slug}`),
        collecte_id: U(r.slug),
        association_id: U(assoSlug),
        mention_fiscale_2041ge: habilitee,
        nb_repas: Math.round(0.1 * r.pax),
        valeur_don_estimee_ht: Math.round(0.1 * r.pax * 5),
        statut: 'emise', // attestation_statut (M2.4) : brouillon|emise|corrigee|annulee
        genere_at: tsAt(r.date, 6),
        eligible_at: tsAt(r.date, 6),
      };
    });
  await batchUpsert(
    client,
    'plateforme.attestations_don',
    attRows,
    ['id'],
    300,
  );

  // ── Rapports RSE (échantillon) ────────────────────────────────────────────
  const zdClot = rows
    .filter((r) => r.type === 'zero_dechet' && r.date < REALISEE_FROM)
    .slice(0, 12);
  await upsert(
    client,
    'plateforme.rapports_rse',
    zdClot.map((r, i) => ({
      id: U(`rapport_${r.slug}`),
      collecte_id: U(r.slug),
      evenement_id: U('ev_' + r.slug),
      version: 1,
      disponible_a: tsAt(r.date, 23),
      envoye_client: i % 2 === 0,
      genere_at: tsAt(r.date, 6),
    })),
    ['id'],
  );

  // ── Exports registre (3 formats simulés) ──────────────────────────────────
  await upsert(
    client,
    'plateforme.exports_registre',
    [
      {
        id: U('exp_kaspia'),
        organisation_id: U('org_tr_kaspia'),
        user_id: U('user_manager_kaspia'),
        periode_debut: '2025-06-01',
        periode_fin: '2026-05-31',
        nb_lignes: 100,
        type_export: 'registre_dechets',
        format: 'csv',
        genere_at: '2026-06-01T06:00:00Z',
      },
      {
        id: U('exp_potel'),
        organisation_id: U('org_tr_potel'),
        user_id: U('user_manager_potel'),
        periode_debut: '2025-06-01',
        periode_fin: '2026-05-31',
        nb_lignes: 40,
        type_export: 'registre_dechets',
        format: 'csv',
        genere_at: '2026-06-01T06:00:00Z',
      },
      {
        id: U('exp_lenotre'),
        organisation_id: U('org_tr_lenotre'),
        user_id: U('user_manager_lenotre'),
        periode_debut: '2025-06-01',
        periode_fin: '2026-05-31',
        nb_lignes: 26,
        type_export: 'registre_dechets',
        format: 'csv',
        genere_at: '2026-06-01T06:00:00Z',
      },
    ],
    ['id'],
  );

  // ── Outbox (échantillon, dont non consommés) ──────────────────────────────
  const outboxRows: Row[] = rows.slice(0, 30).map((r, i) => ({
    id: U(`ob_${r.slug}`),
    aggregate_type: 'collecte',
    aggregate_id: U(r.slug),
    event_type: 'collecte.creee',
    payload: jsonb({ collecte_id: U(r.slug) }),
    consumer: i % 10 === 0 ? null : 'adapter_mts1',
    statut: i % 10 === 0 ? 'pending' : 'done',
    attempts: i % 10 === 0 ? 0 : 1,
    processed_at: i % 10 === 0 ? null : tsAt(r.date, 6),
  }));
  await upsert(client, 'plateforme.outbox_events', outboxRows, ['id']);

  // ── Emails (échantillon) ──────────────────────────────────────────────────
  const emailRows: Row[] = rows
    .slice(0, 100)
    .map((r, i) =>
      email(
        `em_${r.slug}`,
        'confirmation_collecte',
        `manager.${r.traiteur.replace('org_tr_', '')}`,
        'Confirmation de votre collecte',
        i % 25 === 0 ? 'failed' : 'delivered',
        r.date,
      ),
    );
  await batchUpsert(
    client,
    'plateforme.emails_envoyes',
    emailRows,
    ['id'],
    300,
  );

  // ── Audit log (échantillon) ───────────────────────────────────────────────
  await client.query(
    `INSERT INTO plateforme.audit_log (user_id, role, action, table_name, record_id, created_at)
     SELECT $1, 'ops_savr', 'UPDATE', 'collectes', id, '2026-03-01T10:00:00Z'
     FROM plateforme.collectes ORDER BY id LIMIT 50`,
    [U('user_ops1')],
  );

  // ── Intégrations ──────────────────────────────────────────────────────────
  const ilogRows: Row[] = Array.from({ length: 20 }, (_, i) => ({
    id: U(`ilog_${i}`),
    integration: 'mts1',
    direction: i % 2 === 0 ? 'entrant' : 'sortant',
    methode: i % 2 === 0 ? 'GET' : 'POST',
    endpoint: '/v3/orders',
    statut_http: 200,
    duree_ms: 100 + i,
    created_at: tsAt('2026-04-15', 6),
  }));
  await upsert(client, 'plateforme.integrations_logs', ilogRows, [
    'id',
    'created_at',
  ]);
  await upsert(
    client,
    'plateforme.integrations_inbox',
    Array.from({ length: 20 }, (_, i) => ({
      id: U(`inbox_${i}`),
      source: 'mts1',
      event_type: 'tour.status',
      event_id_externe: `evt-demo-${i}`,
      payload: jsonb({ tourId: 'T' + i, status: 'OK' }),
      traite: i % 3 !== 0,
    })),
    ['id'],
  );

  // ── Coefficients perte labo ───────────────────────────────────────────────
  await upsert(
    client,
    'plateforme.coefficients_perte_labo',
    traiteurs
      .filter((t) => t !== 'nomad')
      .map((t) => ({
        id: U(`coeff_${t}`),
        organisation_id: U(`org_tr_${t}`),
        annee_reference: 2025,
        coefficient_kg_couvert: 0.18,
        saisi_par: U('user_ops1'),
        source_commentaire: 'Estimation labo',
      })),
    ['id'],
  );

  console.log(
    `[seed:demo] 478 collectes + ${tournees.length} tournées injectées.`,
  );
}

// ── Factures groupées ZD mensuelles + achats pack AG ────────────────────────
async function seedFactures(
  client: pg.Client,
  rows: CsvCollecte[],
): Promise<void> {
  const counters: Record<string, number> = {
    ZD_MENSUEL: 0,
    AG_MENSUEL: 0,
    ZD_COLLECTE: 0,
    AVOIR: 0,
  };
  const next = (serie: string) => ++counters[serie]!;
  const num = (serie: string, prefix: string) =>
    `${prefix}-2026-${String(next(serie)).padStart(4, '0')}`;

  const factures: Row[] = [];
  const lignes: Row[] = [];

  // Groupes ZD clôturés par (traiteur, mois)
  const groups = new Map<string, CsvCollecte[]>();
  for (const r of rows) {
    if (r.type !== 'zero_dechet' || r.date >= REALISEE_FROM) continue;
    const key = `${r.traiteur}|${r.date.slice(0, 7)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  for (const [key, cols] of groups) {
    const [orgSlug, mois] = key.split('|');
    const t = orgSlug!.replace('org_tr_', '');
    const facSlug = `fac_zd_${key}`;
    const ht = cols.length * 300;
    factures.push(
      facture(
        facSlug,
        `entite_${t}`,
        orgSlug!,
        num('ZD_MENSUEL', 'ZD'),
        'payee',
        mois + '-28',
        ht,
        {
          periode_debut: mois + '-01',
          periode_fin: mois + '-28',
          type: 'zero_dechet',
        },
      ),
    );
    for (const c of cols)
      lignes.push(
        fcol(`fcl_${c.slug}`, facSlug, c.slug, 300, 'Collecte ZD ' + mois),
      );
  }

  // Achat pack AG par traiteur (hors nomad)
  for (const t of [
    'kaspia',
    'fleurdemets',
    'cirette',
    'butard',
    'grandchemin',
    'lenotre',
    'potel',
  ]) {
    const facSlug = `fac_pack_${t}`;
    factures.push(
      facture(
        facSlug,
        `entite_${t}`,
        `org_tr_${t}`,
        num('AG_MENSUEL', 'AG'),
        'payee',
        '2025-09-05',
        2400,
        { type: 'achat_pack_antigaspi', pack_antgaspi_id: U(`pack_${t}`) },
      ),
    );
    lignes.push(
      fcol(
        `fcl_pack_${t}`,
        facSlug,
        null,
        2400,
        'Pack Anti-Gaspi 20 collectes',
      ),
    );
  }

  await batchUpsert(client, 'plateforme.factures', factures, ['id'], 200);

  // Avoir sur une facture pack payée (trigger : origine payee déjà présente)
  await upsert(
    client,
    'plateforme.factures',
    [
      {
        id: U('fac_avoir_demo'),
        entite_facturation_id: U('entite_kaspia'),
        organisation_id: U('org_tr_kaspia'),
        numero_facture: num('AVOIR', 'AVOIR'),
        statut: 'payee',
        date_emission: '2025-10-01',
        montant_ht: -300,
        taux_tva: 20,
        montant_tva: -60,
        montant_ttc: -360,
        type: 'avoir',
        facture_origine_id: U('fac_pack_kaspia'),
        motif_avoir: 'Geste commercial',
      },
    ],
    ['id'],
  );
  lignes.push(
    fcol('fcl_avoir_demo', 'fac_avoir_demo', null, -300, 'Avoir commercial'),
  );
  await batchUpsert(
    client,
    'plateforme.factures_collectes',
    lignes,
    ['id'],
    300,
  );

  // Séquences gapless = compteurs finaux
  await upsert(
    client,
    'plateforme.sequences_facturation',
    [
      { serie: 'ZD_MENSUEL', annee: 2026, dernier_numero: counters.ZD_MENSUEL },
      { serie: 'AG_MENSUEL', annee: 2026, dernier_numero: counters.AG_MENSUEL },
      { serie: 'AVOIR', annee: 2026, dernier_numero: counters.AVOIR },
    ],
    ['serie', 'annee'],
  );
}

// ── Insertion par lots (limite ~65k paramètres SQL) ─────────────────────────
async function batchUpsert(
  client: pg.Client,
  table: string,
  rows: Row[],
  conflict: string[],
  size: number,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await upsert(client, table, rows.slice(i, i + size), conflict);
  }
}

// ── builders ────────────────────────────────────────────────────────────────
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function siret(n: number): string {
  return String(n).padStart(2, '0') + '345678900000'.slice(0, 12);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
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
  sir: string,
  ville: string,
  parDefaut = true,
): Row {
  return {
    id: U(slug),
    organisation_id: U(orgSlug),
    raison_sociale: raison,
    siret: sir,
    adresse_facturation: '1 Adresse Facturation',
    code_postal: ville === 'Rouen' ? '76000' : '75008',
    ville,
    siret_verification: 'verifie',
    siret_verifie_le: tsAt('2025-05-01', 10),
    conditions_paiement_jours: 30,
    entite_par_defaut: parDefaut,
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
function asso(
  slug: string,
  nom: string,
  region: string,
  habilitee: boolean,
  actif: boolean,
): Row {
  return {
    id: U(slug),
    nom,
    adresse: '1 Rue Asso',
    ville: region === 'province' ? 'Rouen' : 'Paris',
    region,
    contact_nom: 'Contact ' + nom,
    contact_email: seedEmail('contact.' + slug),
    contact_telephone: fakePhone(21),
    habilitee_attestation_fiscale: habilitee,
    actif,
    description_rapport_impact: `${nom} — redistribution alimentaire solidaire (description fictive de seed).`,
  };
}
function prest(slug: string, nom: string, code: string, sir: string): Row {
  return {
    id: U(slug),
    nom,
    code,
    type_prestation: ['zd', 'ag'],
    mode_integration: 'mts1',
    siret: sir,
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
  typeTms: string,
  codeMts1: string | null,
  prestataireSlug: string | null,
): Row {
  return {
    id: U(slug),
    nom,
    siren,
    adresse,
    code_postal: cp,
    ville,
    types_vehicules: vehicules,
    type_tms: typeTms,
    code_transporteur_mts1: codeMts1,
    // Pont V1-only transporteur → shared.prestataires (R5/BL-P0-08) : permet au
    // dispatch AG de poser tournees.prestataire_logistique_id (FK NOT NULL).
    prestataire_logistique_id: prestataireSlug ? U(prestataireSlug) : null,
    contact_nom: 'Ops ' + nom,
    contact_email: seedEmail('ops.' + slug),
    contact_telephone: fakePhone(200),
    actif: true,
  };
}
function pack(
  slug: string,
  orgSlug: string,
  nb: number,
  utilisees: number,
  statut: string,
  dateAchat: string,
): Row {
  // Coût par collecte (crédit) décroissant avec la taille du pack (économie
  // d'échelle) — sert au CA « économique » AG (montant amorti par collecte livrée,
  // v_kpi_admin + tableau Revenus). Pack 20 crédits = 120€/collecte → 2400€ (cohérent
  // avec la facture d'achat de pack du seed).
  const prixUnitaire = nb >= 60 ? 100 : nb >= 30 ? 110 : nb >= 20 ? 120 : 130;
  return {
    id: U(slug),
    organisation_id: U(orgSlug),
    type_pack:
      nb === 10
        ? 'pack_10'
        : nb === 30
          ? 'pack_30'
          : nb === 60
            ? 'pack_60'
            : 'personnalise',
    credits_initiaux: nb,
    credits_consommes: utilisees,
    prix_unitaire_ht: prixUnitaire,
    montant_total_ht: prixUnitaire * nb,
    statut,
    date_achat: dateAchat,
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
  volumeRepas?: number,
): Row {
  const r: Row = {
    id: U(slug),
    collecte_id: U(colSlug),
    association_id: U(assoSlug),
    transporteur_id: transpId,
    branche_attribution: branche,
    mode_validation: mode,
  };
  // Repas réellement donnés (alimente Bloc 2 AG « repas donnés » + ratio repas/pax).
  if (volumeRepas != null) {
    r.volume_repas_realise = volumeRepas;
    r.poids_repas_kg = Math.round(volumeRepas * 0.5 * 10) / 10;
  }
  if (mode === 'manuel_override') {
    r.motif_override = 'Réattribution Admin';
    r.motif_override_libre = 'Réattribution Admin';
  }
  return r;
}
function bordereau(slug: string, colSlug: string, date: string): Row {
  return {
    id: U(slug),
    collecte_id: U(colSlug),
    statut: 'emis', // bordereau_statut (M1.6) : brouillon|emis|corrige|annule
    genere_at: tsAt(date, 6),
    eligible_at: tsAt(date, 6),
  };
}
function facture(
  slug: string,
  entiteSlug: string,
  orgSlug: string,
  numero: string,
  statut: string,
  dateEmission: string,
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
    date_emission: dateEmission,
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
    // CHECK chk_fc_collecte_ou_designation (M1.7) : ligne sans collecte → designation requise.
    designation: colSlug ? null : desc,
  };
}
function email(
  slug: string,
  code: string,
  dest: string,
  sujet: string,
  statut: string,
  date: string,
): Row {
  return {
    id: U(slug),
    template_code: code,
    destinataire: seedEmail(dest),
    sujet,
    statut,
    resend_id: 'resend-' + slug,
    envoye_at: tsAt(date, 6),
  };
}
