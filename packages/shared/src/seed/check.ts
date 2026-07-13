/**
 * seed:check — intégrité du seed (intégrable au harnais CI).
 *
 *   1. Volumétrie conforme au catalogue (seed_minimal).
 *   2. Objets clés présents (lookup par slug/clé naturelle).
 *   3. Zéro email hors @savr-test.local, zéro téléphone hors range fictif.
 *   4. Séquences de facturation sans trou (gapless).
 *   5. Somme matrice CSV = 478 collectes.
 *
 * Échec d'un check → exit code ≠ 0.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEnv, assertDev, connect } from './db.js';
import { seedUuid } from './uuid.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failures.push(label);
  }
}

type Scalar = (sql: string) => Promise<number>;
type Pg = Awaited<ReturnType<typeof connect>>;

function finalize(): void {
  console.log('');
  if (failures.length > 0) {
    console.error(`seed:check — ${failures.length} échec(s) ❌`);
    process.exit(1);
  }
  console.log('seed:check — OK ✅');
}

// Checks communs aux 2 datasets : confidentialité + matrice CSV.
async function checkCommon(scalar: Scalar): Promise<void> {
  console.log('Confidentialité (emails / téléphones)');
  check(
    '0 email hors @savr-test.local',
    (await scalar(
      "select count(*) n from (select email from plateforme.users union all select contact_email from plateforme.associations union all select email_principal from plateforme.organisations where email_principal is not null) t where email not like '%@savr-test.local'",
    )) === 0,
  );
  check(
    '0 téléphone hors range +33 6 99 99',
    (await scalar(
      "select count(*) n from (select contact_principal_telephone t from plateforme.evenements union all select contact_telephone from plateforme.associations union all select telephone from plateforme.contacts_traiteurs) x where t not like '+33 6 99 99%'",
    )) === 0,
  );
  console.log('Matrice demo');
  const csv = readFileSync(
    resolve(REPO_ROOT, 'fixtures/data/matrix_collectes.csv'),
    'utf8',
  );
  const rows = csv
    .trim()
    .split('\n')
    .slice(1)
    .filter((l) => l.trim().length > 0);
  check(
    'matrix_collectes.csv = 478 lignes',
    rows.length === 478,
    `${rows.length} lignes`,
  );
}

// Volumétrie seed_demo (catalogue §01, dataset autonome 12 mois).
async function checkDemo(c: Pg, scalar: Scalar): Promise<void> {
  console.log('1. Volumétrie seed_demo');
  check(
    'organisations = 14',
    (await scalar('select count(*) n from plateforme.organisations')) === 14,
  );
  check(
    'traiteurs = 8',
    (await scalar(
      "select count(*) n from plateforme.organisations where type='traiteur'",
    )) === 8,
  );
  check(
    'gestionnaires = 3',
    (await scalar(
      "select count(*) n from plateforme.organisations where type='gestionnaire_lieux'",
    )) === 3,
  );
  check(
    'users = 29',
    (await scalar('select count(*) n from plateforme.users')) === 29,
  );
  check(
    'lieux = 18',
    (await scalar('select count(*) n from plateforme.lieux')) === 18,
  );
  check(
    'associations = 5',
    (await scalar('select count(*) n from plateforme.associations')) === 5,
  );
  check(
    'association désactivée >= 1',
    (await scalar(
      'select count(*) n from plateforme.associations where actif=false',
    )) >= 1,
  );
  check(
    'collectes = 478',
    (await scalar('select count(*) n from plateforme.collectes')) === 478,
  );
  check(
    'collectes cloturee = 426',
    (await scalar(
      "select count(*) n from plateforme.collectes where statut='cloturee'",
    )) === 426,
  );
  check(
    'collectes realisee = 52',
    (await scalar(
      "select count(*) n from plateforme.collectes where statut='realisee'",
    )) === 52,
  );
  check(
    'collecte_flux > 800',
    (await scalar('select count(*) n from plateforme.collecte_flux')) > 800,
  );
  check(
    'attributions = 167',
    (await scalar(
      'select count(*) n from plateforme.attributions_antgaspi',
    )) === 167,
  );
  check(
    'tournées = 63',
    (await scalar('select count(*) n from plateforme.tournees')) === 63,
  );
  check(
    'packs actifs = 7',
    (await scalar(
      "select count(*) n from plateforme.packs_antgaspi where statut='actif'",
    )) === 7,
  );
  check(
    'factures > 50',
    (await scalar('select count(*) n from plateforme.factures')) > 50,
  );
  check(
    'bordereaux > 0',
    (await scalar('select count(*) n from plateforme.bordereaux_savr')) > 0,
  );
  check(
    'attestations > 0',
    (await scalar('select count(*) n from plateforme.attestations_don')) > 0,
  );

  console.log('2. Règles & objets clés');
  check(
    'Nomad = compte vide (0 collecte)',
    (await scalar(
      `select count(*) n from plateforme.collectes c join plateforme.evenements e on e.id=c.evenement_id where e.organisation_id='${seedUuid('org_tr_nomad')}'`,
    )) === 0,
  );
  check(
    'avoir sur facture payee',
    (await scalar(
      "select count(*) n from plateforme.factures f join plateforme.factures o on o.id=f.facture_origine_id where o.statut='payee'",
    )) >= 1,
  );
  check(
    'transporteur sans code MTS-1 (cas négatif)',
    (await scalar(
      "select count(*) n from plateforme.transporteurs where type_tms='mts1' and code_transporteur_mts1 is null",
    )) >= 1,
  );
  check(
    'A Toutes! présent mais zéro collecte servie (GATE Everest)',
    (await scalar(
      `select count(*) n from plateforme.collectes where prestataire_logistique_id='${seedUuid('prest_a_toutes')}'`,
    )) === 0,
  );
  check(
    '1 facture avec ligne collecte_id NULL',
    (await scalar(
      'select count(*) n from plateforme.factures_collectes where collecte_id is null',
    )) >= 1,
  );

  console.log('3. Séquences gapless');
  const seqRows = (
    await c.query(
      // colonne renommée dernier → dernier_numero en M1.7 (20260615000100) ;
      // alias conservé pour le reste du check (bug latent révélé quand le schéma
      // dev a rattrapé le rename — sans rapport avec le CO₂).
      'select serie, dernier_numero as dernier, annee from plateforme.sequences_facturation',
    )
  ).rows;
  for (const { serie, dernier } of seqRows) {
    const prefix =
      serie === 'ZD_MENSUEL'
        ? 'ZD-'
        : serie === 'AG_MENSUEL'
          ? 'AG-'
          : 'AVOIR-';
    const maxNum = await scalar(
      `select coalesce(max(substring(numero_facture from '[0-9]+$')::int),0) n from plateforme.factures where numero_facture like '${prefix}%'`,
    );
    check(
      `séquence ${serie} = max facture (${dernier})`,
      Number(dernier) === maxNum,
      `dernier=${dernier}, max=${maxNum}`,
    );
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  assertDev(env);
  const c = await connect(env);

  const scalar = async (sql: string): Promise<number> =>
    Number((await c.query(sql)).rows[0].n);
  const exists = async (table: string, id: string): Promise<boolean> =>
    (await c.query(`select 1 from ${table} where id = $1`, [id])).rowCount ===
    1;

  try {
    // ── Détection du dataset chargé (par volumétrie collectes) ──────────────
    const nCollectes = await scalar(
      'select count(*) n from plateforme.collectes',
    );
    const dataset = nCollectes === 478 ? 'demo' : 'minimal';
    console.log(`Dataset détecté : ${dataset} (${nCollectes} collectes)\n`);

    if (dataset === 'demo') {
      await checkDemo(c, scalar);
      await checkCommon(scalar);
      await c.end();
      finalize();
      return;
    }

    // ── 1. Volumétrie seed_minimal (catalogue §01) ──────────────────────────
    console.log('1. Volumétrie');
    check(
      'organisations = 7',
      (await scalar('select count(*) n from plateforme.organisations')) === 7,
    );
    check(
      'traiteurs = 3',
      (await scalar(
        "select count(*) n from plateforme.organisations where type='traiteur'",
      )) === 3,
    );
    check(
      'users = 15',
      (await scalar('select count(*) n from plateforme.users')) === 15,
    );
    check(
      'staff users = 4 (org_savr)',
      (await scalar(
        `select count(*) n from plateforme.users where organisation_id = '${seedUuid('org_savr')}'`,
      )) === 4,
    );
    check(
      'lieux = 6',
      (await scalar('select count(*) n from plateforme.lieux')) === 6,
    );
    check(
      'associations = 2',
      (await scalar('select count(*) n from plateforme.associations')) === 2,
    );
    check(
      'entites_facturation = 5',
      (await scalar(
        'select count(*) n from plateforme.entites_facturation',
      )) === 5,
    );
    check(
      'transporteurs = 3',
      (await scalar('select count(*) n from plateforme.transporteurs')) === 3,
    );
    check(
      'prestataires = 3',
      (await scalar('select count(*) n from shared.prestataires')) === 3,
    );
    check(
      'packs actifs = 3',
      (await scalar(
        "select count(*) n from plateforme.packs_antgaspi where statut='actif'",
      )) === 3,
    );
    check(
      'packs épuisés = 1',
      (await scalar(
        "select count(*) n from plateforme.packs_antgaspi where statut='epuise'",
      )) === 1,
    );
    check(
      'collectes = 20',
      (await scalar('select count(*) n from plateforme.collectes')) === 20,
    );
    check(
      'collectes cloturee = 9',
      (await scalar(
        "select count(*) n from plateforme.collectes where statut='cloturee'",
      )) === 9,
    );
    check(
      'collectes realisee_sans_collecte = 1',
      (await scalar(
        "select count(*) n from plateforme.collectes where statut='realisee_sans_collecte'",
      )) === 1,
    );
    check(
      'collectes brouillon = 2',
      (await scalar(
        "select count(*) n from plateforme.collectes where statut='brouillon'",
      )) === 2,
    );
    check(
      'collectes annulee = 2',
      (await scalar(
        "select count(*) n from plateforme.collectes where statut='annulee'",
      )) === 2,
    );
    check(
      'collecte_flux = 14',
      (await scalar('select count(*) n from plateforme.collecte_flux')) === 14,
    );
    check(
      'attributions = 4',
      (await scalar(
        'select count(*) n from plateforme.attributions_antgaspi',
      )) === 4,
    );
    check(
      'factures = 7',
      (await scalar('select count(*) n from plateforme.factures')) === 7,
    );
    check(
      'bordereaux = 3',
      (await scalar('select count(*) n from plateforme.bordereaux_savr')) === 3,
    );
    check(
      'attestations = 2',
      (await scalar('select count(*) n from plateforme.attestations_don')) ===
        2,
    );
    check(
      'exports_registre = 3',
      (await scalar('select count(*) n from plateforme.exports_registre')) ===
        3,
    );
    check(
      'outbox = 3',
      (await scalar('select count(*) n from plateforme.outbox_events')) === 3,
    );
    check(
      'outbox non consommé = 1',
      (await scalar(
        "select count(*) n from plateforme.outbox_events where statut='pending'",
      )) === 1,
    );
    check(
      'emails = 6',
      (await scalar('select count(*) n from plateforme.emails_envoyes')) === 6,
    );
    check(
      'email échec = 1',
      (await scalar(
        "select count(*) n from plateforme.emails_envoyes where statut='failed'",
      )) === 1,
    );
    check(
      'audit_log = 6',
      (await scalar('select count(*) n from plateforme.audit_log')) === 6,
    );

    // ── 2. Objets clés présents (lookup par slug) ───────────────────────────
    console.log('2. Objets clés (slug → UUID v5)');
    for (const slug of [
      'org_tr_kaspia',
      'org_ge_viparis',
      'org_ag_caromy',
      'asso_alpha',
      'asso_bravo',
    ]) {
      check(
        `organisation/asso ${slug}`,
        (
          await c.query(
            'select 1 from plateforme.organisations where id=$1 union all select 1 from plateforme.associations where id=$1',
            [seedUuid(slug)],
          )
        ).rowCount === 1,
      );
    }
    check(
      'persona user_admin',
      await exists('plateforme.users', seedUuid('user_admin')),
    );
    check(
      'persona user_manager_kaspia',
      await exists('plateforme.users', seedUuid('user_manager_kaspia')),
    );
    check(
      'collecte col_zd_palier_haut',
      await exists('plateforme.collectes', seedUuid('col_zd_palier_haut')),
    );
    check(
      'collecte col_ag_sans_collecte',
      await exists('plateforme.collectes', seedUuid('col_ag_sans_collecte')),
    );
    check(
      'avoir AVOIR-2025-0001 sur facture payee',
      (await scalar(
        "select count(*) n from plateforme.factures f join plateforme.factures o on o.id=f.facture_origine_id where f.numero_facture='AVOIR-2025-0001' and o.statut='payee'",
      )) === 1,
    );
    check(
      'pack Cirette bas ≤ 10%',
      (await scalar(
        "select count(*) n from plateforme.packs_antgaspi where credits_restants::numeric / credits_initiaux <= 0.10 and statut='actif'",
      )) >= 1,
    );
    // ev_k_datenull = cas intentionnel « date à confirmer » (sans collecte).
    // NB : les événements dont la seule collecte est annulée passent aussi à
    // NULL via trg_set_date_evenement (MIN des collectes non annulées) — normal.
    check(
      'événement ev_k_datenull date_evenement NULL',
      (await scalar(
        `select count(*) n from plateforme.evenements where id='${seedUuid('ev_k_datenull')}' and date_evenement is null`,
      )) === 1,
    );

    // ── 3. Confidentialité données fictives ─────────────────────────────────
    console.log('3. Données fictives (emails / téléphones)');
    check(
      '0 email hors @savr-test.local',
      (await scalar(
        "select count(*) n from (select email from plateforme.users union all select contact_email from plateforme.associations union all select email_principal from plateforme.organisations where email_principal is not null) t where email not like '%@savr-test.local'",
      )) === 0,
    );
    check(
      '0 téléphone hors range +33 6 99 99',
      (await scalar(
        "select count(*) n from (select contact_principal_telephone t from plateforme.evenements union all select contact_telephone from plateforme.associations union all select telephone from plateforme.contacts_traiteurs) x where t not like '+33 6 99 99%'",
      )) === 0,
    );

    // ── 4. Séquences gapless ────────────────────────────────────────────────
    console.log('4. Séquences de facturation gapless');
    const seqRows = (
      await c.query(
        // dernier → dernier_numero (rename M1.7 20260615000100) ; alias conservé.
        'select serie, dernier_numero as dernier from plateforme.sequences_facturation',
      )
    ).rows;
    for (const { serie, dernier } of seqRows) {
      const prefix =
        serie === 'ZD_COLLECTE'
          ? 'ZD-2025-'
          : serie === 'AG_MENSUEL'
            ? 'AG-2025-'
            : 'AVOIR-2025-';
      const maxNum = await scalar(
        `select coalesce(max(substring(numero_facture from '[0-9]+$')::int),0) n from plateforme.factures where numero_facture like '${prefix}%'`,
      );
      check(
        `séquence ${serie} = max facture (${dernier})`,
        Number(dernier) === maxNum,
        `dernier=${dernier}, max=${maxNum}`,
      );
    }

    // ── 5. Matrice CSV = 478 ────────────────────────────────────────────────
    console.log('5. Matrice demo (478 collectes)');
    const csv = readFileSync(
      resolve(REPO_ROOT, 'fixtures/data/matrix_collectes.csv'),
      'utf8',
    );
    const rows = csv
      .trim()
      .split('\n')
      .slice(1)
      .filter((l) => l.trim().length > 0);
    check(
      'matrix_collectes.csv = 478 lignes',
      rows.length === 478,
      `${rows.length} lignes`,
    );
  } finally {
    await c.end();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`seed:check — ${failures.length} échec(s) ❌`);
    process.exit(1);
  }
  console.log('seed:check — OK ✅');
}

main().catch((err) => {
  console.error('[seed:check] erreur :', err.message);
  process.exit(1);
});
