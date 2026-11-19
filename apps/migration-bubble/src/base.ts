/**
 * Accès à la base de l'import : garde « base locale jetable », schéma technique
 * `migration`, écriture idempotente et coupure des déclencheurs.
 *
 * Deux verrous avant toute écriture (décision Val 2026-10-28 : répétitions sur
 * base locale jetable, jamais `savr-dev`, jamais la prod) :
 *   1. l'hôte de l'adresse de connexion est la machine elle-même ;
 *   2. la base porte le marqueur que seul `base-jetable.sh` pose — une base
 *      distante atteinte par un tunnel local ne l'a pas.
 */
import { isAbsolute, relative, resolve } from 'node:path';

import pg from 'pg';

import {
  TABLES_CIBLES,
  type Correspondance,
  type LigneCible,
  type Rejet,
  type TableCible,
} from './plan';

export class BaseRefusee extends Error {}

const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface AccesBase {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Refuse toute adresse qui ne désigne pas la machine elle-même. Rend les
 * paramètres de connexion un par un : l'adresse brute n'est jamais passée au
 * pilote, dont les options d'URL (`?host=…`) pourraient désigner un autre hôte.
 */
export function exigerBaseLocale(adresse: string | undefined): AccesBase {
  if (!adresse)
    throw new BaseRefusee(
      'Adresse de la base absente (MIGRATION_BUBBLE_DATABASE_URL).',
    );
  let url: URL;
  try {
    url = new URL(adresse);
  } catch {
    throw new BaseRefusee('Adresse de la base illisible.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new BaseRefusee('Adresse de la base : protocole inattendu.');
  if (!HOTES_LOCAUX.has(url.hostname.toLowerCase()))
    throw new BaseRefusee(
      `Import refusé : l'hôte « ${url.hostname} » n'est pas cette machine. ` +
        "L'import ne tourne que sur la base locale jetable.",
    );
  if (url.search !== '')
    throw new BaseRefusee(
      'Import refusé : adresse de la base avec options (?…), non acceptées.',
    );
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
  };
}

/** Ce dont l'import a besoin d'un client Postgres (permet un faux client en test). */
export interface Requeteur {
  query: (
    texte: string,
    valeurs?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

const MARQUEUR_BASE_JETABLE = 'migration.base_jetable';

export async function exigerBaseJetable(client: Requeteur): Promise<void> {
  const { rows } = await client.query(
    'SELECT to_regclass($1) IS NOT NULL AS presente',
    [MARQUEUR_BASE_JETABLE],
  );
  if (rows[0]?.presente !== true)
    throw new BaseRefusee(
      `Import refusé : la base ne porte pas le marqueur ${MARQUEUR_BASE_JETABLE}. ` +
        'Seule une base montée par base-jetable.sh est acceptée.',
    );
}

/** Client Postgres tel que `connecter` s'en sert (le pilote `pg`, ou un faux client en test). */
export interface ClientBase extends Requeteur {
  connect: () => Promise<unknown>;
  end: () => Promise<unknown>;
}

export async function connecter(
  adresse: string | undefined,
  creerClient: (acces: AccesBase) => ClientBase = (acces) =>
    new pg.Client(acces),
): Promise<ClientBase> {
  const client = creerClient(exigerBaseLocale(adresse));
  await client.connect();
  try {
    // Le marqueur d'abord : sur une base qui ne le porte pas, RIEN d'autre n'est exécuté.
    await exigerBaseJetable(client);
    // Schéma technique posé à chaque connexion : import, checks et remise à zéro voient les mêmes tables.
    await client.query(SCHEMA_TECHNIQUE);
  } catch (erreur) {
    await client.end();
    throw erreur;
  }
  return client;
}

/**
 * Le dossier de travail (exports lus, cache, fichiers à valider, rapports)
 * porte des données réelles : il ne doit jamais se trouver dans le dépôt, qui
 * est public.
 */
export function exigerHorsDepot(dossier: string, racineDepot: string): void {
  const interieur = relative(resolve(racineDepot), resolve(dossier));
  if (
    interieur === '' ||
    (!interieur.startsWith('..') && !isAbsolute(interieur))
  )
    throw new BaseRefusee(
      `Dossier de travail refusé : « ${dossier} » est dans le dépôt, qui est public. ` +
        'Les sorties de l’import portent des données réelles.',
    );
}

// ── Schéma technique ─────────────────────────────────────────────────────────

/**
 * Posé par le script dans la base jetable seulement : aucun fichier dans
 * supabase/migrations/. Le schéma technique « migration » seul : la colonne de
 * marquage des collectes importées (`collectes.origine`, décision Val
 * 2026-11-15) vient de la migration du dépôt 20261119120000, le script ne
 * modifie jamais lui-même une table du produit.
 */
const SCHEMA_TECHNIQUE = `
CREATE SCHEMA IF NOT EXISTS migration;
REVOKE ALL ON SCHEMA migration FROM PUBLIC;
CREATE TABLE IF NOT EXISTS migration.sources_brutes (
  source_type text NOT NULL,
  bubble_id   text NOT NULL,
  ligne       jsonb NOT NULL,
  PRIMARY KEY (source_type, bubble_id)
);
CREATE TABLE IF NOT EXISTS migration.id_map (
  source_type  text NOT NULL,
  bubble_id    text NOT NULL,
  target_table text NOT NULL,
  target_id    uuid NOT NULL,
  fusionne     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (source_type, bubble_id)
);
CREATE TABLE IF NOT EXISTS migration.rejets (
  source_type text NOT NULL,
  bubble_id   text NOT NULL,
  motif       text NOT NULL,
  PRIMARY KEY (source_type, bubble_id)
);
-- Email à qui rendre l'événement à son inscription (décision Val 2026-11-15) :
-- celui du commercial Bubble, sinon l'email de contact du traiteur. Toujours en
-- minuscules, sans espace. Une ligne par événement importé qui a un email.
CREATE TABLE IF NOT EXISTS migration.auteurs_evenements (
  evenement_id uuid PRIMARY KEY,
  email        text NOT NULL CHECK (email = lower(btrim(email))),
  provenance   text NOT NULL CHECK (provenance IN ('commercial', 'contact_traiteur'))
);
ALTER TABLE migration.auteurs_evenements ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration.sources_brutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration.id_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration.rejets ENABLE ROW LEVEL SECURITY;
-- Lecture d'un nombre Bubble (virgule décimale) en SQL : sert aux checks, qui
-- relisent les exports bruts sans passer par le code TypeScript.
CREATE OR REPLACE FUNCTION migration.nombre(t text) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(t) ~ '^-?[0-9]+([.,][0-9]+)?$'
              THEN replace(btrim(t), ',', '.')::numeric END
$$;
REVOKE ALL ON FUNCTION migration.nombre(text) FROM PUBLIC;
`;

export interface BilanEcriture {
  table: string;
  lues: number;
  inserees: number;
  modifiees: number;
  inchangees: number;
  /** Valeurs de clé des lignes insérées ou modifiées à ce passage. */
  touchees: string[];
}

const IDENTIFIANT = /^[a-z_][a-z0-9_]*$/;
/** Horodatages posés à l'insertion seulement : la base ou ses déclencheurs les font vivre ensuite. */
const INSERTION_SEULE = ['created_at', 'updated_at', 'verifie_at'];

/**
 * Écrit des lignes sans jamais rien créer en double : met à jour celles qui
 * existent ET diffèrent, insère celles qui manquent, ne touche pas aux autres.
 * Aucun `INSERT … ON CONFLICT` : les déclencheurs « avant insertion »
 * s'exécuteraient aussi pour les lignes déjà présentes.
 *
 * Contrôle de fin positif : après l'écriture, chaque ligne du plan est relue
 * et comparée. Une mise à jour filtrée en silence (droits, RLS) fait échouer.
 */
export async function ecrireTable(
  client: Requeteur,
  table: string,
  lignes: LigneCible[],
  options: { cle?: string; insertionSeule?: string[] } = {},
): Promise<BilanEcriture> {
  const bilan: BilanEcriture = {
    table,
    lues: lignes.length,
    inserees: 0,
    modifiees: 0,
    inchangees: 0,
    touchees: [],
  };
  if (lignes.length === 0) return bilan;
  const cle = options.cle ?? 'id';
  const colonnes = Object.keys(lignes[0]!);
  for (const nom of [...table.split('.'), ...colonnes, cle])
    if (!IDENTIFIANT.test(nom))
      throw new Error(`Identifiant SQL inattendu : ${nom}`);
  if (lignes.some((l) => Object.keys(l).join() !== colonnes.join()))
    throw new Error(
      `${table} : toutes les lignes doivent porter les mêmes colonnes.`,
    );
  const figees = new Set([
    ...INSERTION_SEULE,
    ...(options.insertionSeule ?? []),
  ]);
  const comparees = colonnes.filter((c) => c !== cle && !figees.has(c));
  const tuple = (alias: string) =>
    `(${comparees.map((c) => `${alias}.${c}`).join(', ')})`;
  const donnees = `SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`;
  const charge = [JSON.stringify(lignes)];

  const { rows } = await client.query(
    `WITH donnees AS (${donnees}),
     modifiees AS (
       ${
         comparees.length === 0
           ? `SELECT NULL::text AS cle WHERE false`
           : `UPDATE ${table} t
                 SET ${comparees.map((c) => `${c} = d.${c}`).join(', ')}
                FROM donnees d
               WHERE t.${cle} = d.${cle}
                 AND ${tuple('t')} IS DISTINCT FROM ${tuple('d')}
           RETURNING t.${cle}::text AS cle`
       }
     ),
     inserees AS (
       INSERT INTO ${table} (${colonnes.join(', ')})
       SELECT ${colonnes.map((c) => `d.${c}`).join(', ')}
         FROM donnees d
        WHERE NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.${cle} = d.${cle})
       RETURNING ${cle}::text AS cle
     )
     SELECT coalesce((SELECT array_agg(cle) FROM modifiees), '{}') AS modifiees,
            coalesce((SELECT array_agg(cle) FROM inserees), '{}') AS inserees`,
    charge,
  );
  const modifiees = rows[0]!.modifiees as string[];
  const inserees = rows[0]!.inserees as string[];
  bilan.modifiees = modifiees.length;
  bilan.inserees = inserees.length;
  bilan.inchangees = lignes.length - modifiees.length - inserees.length;
  bilan.touchees = [...inserees, ...modifiees];

  const controle = await client.query(
    `WITH donnees AS (${donnees})
     SELECT count(*)::int AS ecarts
       FROM donnees d
       LEFT JOIN ${table} t ON t.${cle} = d.${cle}
      WHERE t.${cle} IS NULL
         ${comparees.length === 0 ? '' : `OR ${tuple('t')} IS DISTINCT FROM ${tuple('d')}`}`,
    charge,
  );
  const ecarts = controle.rows[0]!.ecarts as number;
  if (ecarts !== 0)
    throw new Error(
      `${table} : ${ecarts} ligne(s) du plan absentes ou différentes après écriture ` +
        '(écriture filtrée en silence, ou valeur réécrite par un déclencheur).',
    );
  return bilan;
}

export async function chargerStaging(
  client: Requeteur,
  sourceType: string,
  lignes: Record<string, string>[],
): Promise<void> {
  const charge = JSON.stringify(
    lignes.map((ligne) => ({
      source_type: sourceType,
      bubble_id: ligne['unique id']!.trim(),
      ligne,
    })),
  );
  // Le staging reflète exactement l'export chargé : ce qui n'y est plus en sort.
  await client.query(
    `DELETE FROM migration.sources_brutes s
      WHERE s.source_type = $1
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS d(bubble_id text)
           WHERE d.bubble_id = s.bubble_id)`,
    [sourceType, charge],
  );
  await client.query(
    `WITH d AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb)
         AS x(source_type text, bubble_id text, ligne jsonb)
     ), maj AS (
       UPDATE migration.sources_brutes s SET ligne = d.ligne FROM d
        WHERE s.source_type = d.source_type AND s.bubble_id = d.bubble_id
          AND s.ligne IS DISTINCT FROM d.ligne
     )
     INSERT INTO migration.sources_brutes (source_type, bubble_id, ligne)
     SELECT d.source_type, d.bubble_id, d.ligne FROM d
      WHERE NOT EXISTS (
        SELECT 1 FROM migration.sources_brutes s
         WHERE s.source_type = d.source_type AND s.bubble_id = d.bubble_id)`,
    [charge],
  );
}

/** Écrit la table de correspondance ; rend les lignes importées par un passage antérieur et absentes du plan. */
export async function ecrireCorrespondances(
  client: Requeteur,
  correspondances: Correspondance[],
  rejets: Rejet[],
): Promise<{ inserees: number; modifiees: number; disparues: number }> {
  const charge = JSON.stringify(
    correspondances.map((c) => ({
      source_type: c.sourceType,
      bubble_id: c.bubbleId,
      target_table: c.table,
      target_id: c.cibleId,
      fusionne: c.fusionne,
    })),
  );
  const d = `SELECT * FROM jsonb_populate_recordset(NULL::migration.id_map, $1::jsonb)`;
  const { rows } = await client.query(
    `WITH d AS (${d}), maj AS (
       UPDATE migration.id_map m
          SET target_table = d.target_table, target_id = d.target_id, fusionne = d.fusionne
         FROM d
        WHERE m.source_type = d.source_type AND m.bubble_id = d.bubble_id
          AND (m.target_table, m.target_id, m.fusionne)
              IS DISTINCT FROM (d.target_table, d.target_id, d.fusionne)
       RETURNING 1
     ), ins AS (
       INSERT INTO migration.id_map
       SELECT d.* FROM d
        WHERE NOT EXISTS (SELECT 1 FROM migration.id_map m
                           WHERE m.source_type = d.source_type AND m.bubble_id = d.bubble_id)
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM ins)::int AS inserees,
            (SELECT count(*) FROM maj)::int AS modifiees,
            (SELECT count(*) FROM migration.id_map m
              WHERE m.source_type <> 'prestataire'
                AND NOT EXISTS (SELECT 1 FROM d
                                 WHERE d.source_type = m.source_type
                                   AND d.bubble_id = m.bubble_id))::int AS disparues`,
    [charge],
  );
  await client.query('DELETE FROM migration.rejets');
  await client.query(
    `INSERT INTO migration.rejets (source_type, bubble_id, motif)
     SELECT DISTINCT ON (source_type, bubble_id) source_type, bubble_id, motif
       FROM jsonb_to_recordset($1::jsonb)
         AS x(source_type text, bubble_id text, motif text)`,
    [
      JSON.stringify(
        rejets.map((r) => ({
          source_type: r.sourceType,
          bubble_id: r.bubbleId,
          motif: r.motif,
        })),
      ),
    ],
  );
  return rows[0] as { inserees: number; modifiees: number; disparues: number };
}

// ── Déclencheurs ─────────────────────────────────────────────────────────────

type Declencheur = { table: TableCible; nom: string; raison: string };

/**
 * Coupés pendant l'import, par leur nom, puis rétablis dans la même transaction.
 * Chacun agirait à tort sur des lignes d'historique : débit de pack, alerte,
 * ordre au prestataire, document, ou recalcul fait une fois par le script.
 */
export const DECLENCHEURS_COUPES: Declencheur[] = [
  {
    table: 'collectes',
    nom: 'trg_pack_debit_programmation',
    raison:
      'débiterait le pack actif à chaque collecte anti-gaspi importée « programmée » ; les crédits sont recomptés par le script',
  },
  {
    table: 'collectes',
    nom: 'trg_pack_debit_realisee',
    raison: 'lèverait l’alerte « réalisée sans pack » sur tout l’historique',
  },
  {
    table: 'collectes',
    nom: 'trg_pack_debit_annulation_tardive',
    raison: 'jugerait une annulation ancienne à l’heure de l’import',
  },
  {
    table: 'collectes',
    nom: 'trg_pack_recredit',
    raison: 'rendrait des crédits déjà recomptés par le script',
  },
  {
    table: 'collectes',
    nom: 'trg_marquer_annulation_tardive',
    raison:
      'recalculerait « annulation tardive » à l’heure de l’import ; la valeur est posée par le script',
  },
  {
    table: 'collectes',
    nom: 'trg_co2_ag_cloture',
    raison:
      'CO₂ calculé une fois par le script, par la même fonction de la base',
  },
  {
    table: 'collectes',
    nom: 'trg_co2_zd_cloture',
    raison:
      'CO₂ et taux de recyclage calculés une fois par le script, par la même fonction de la base',
  },
  {
    table: 'collectes',
    nom: 'trg_set_collectes_dirty_tms',
    raison:
      'marquerait des collectes d’historique « à renvoyer au prestataire »',
  },
  {
    table: 'collectes',
    nom: 'trg_sync_statut_collecte_from_tms',
    raison: 'réalignerait le statut sur un état prestataire qui n’existe pas',
  },
  {
    table: 'collectes',
    nom: 'trg_controle_acces_cascade',
    raison:
      'écrirait le journal d’audit à chaque collecte ; le contrôle d’accès du lieu est calculé par le script',
  },
  {
    table: 'collecte_flux',
    nom: 'trg_co2_zd_pesees',
    raison:
      'recalculerait le CO₂ à chaque ligne de pesée ; le script le calcule une fois par collecte',
  },
  {
    table: 'collecte_contacts',
    nom: 'trg_collecte_contacts_marque_collecte_modifiee',
    raison: 'marquerait la collecte « à renvoyer au prestataire »',
  },
  {
    table: 'attributions_antgaspi',
    nom: 'trg_calc_volume_repas_realise',
    raison:
      'écrirait le journal d’audit « poids saisi par l’équipe » ; les repas sont calculés par le script',
  },
  {
    table: 'attributions_antgaspi',
    nom: 'trg_co2_ag_repas',
    raison: 'CO₂ calculé une fois par le script',
  },
  {
    table: 'attributions_antgaspi',
    nom: 'trg_regenerer_attestation',
    raison: 'mettrait un document en file ; aucun rapport pour l’historique',
  },
  {
    table: 'lieux',
    nom: 'trg_lieu_champ_critique_e5',
    raison: 'écrirait un ordre « lieu modifié » pour le prestataire',
  },
];

/** Laissés actifs : recopies événement ↔ collecte, valeurs par défaut, gardes de format et de rôle. */
export const DECLENCHEURS_LAISSES: Record<TableCible, string[]> = {
  organisations: [
    'trg_block_org_gestionnaire_cols_update',
    'trg_block_org_staff_cols_insert',
    'trg_cerfa_debloque_siret',
    'trg_garde_format_logo',
    'trg_ops_immutable_cols',
  ],
  users: ['trg_users_block_role_escalation'],
  lieux: [],
  associations: ['trg_garde_format_logo', 'trg_ops_immutable_cols'],
  transporteurs: [
    'trg_transporteur_cols_immuables',
    'trg_transporteur_delete_sous_tournees',
    'trg_transporteur_prestataire_auto',
  ],
  entites_facturation: ['trg_no_entite_facturation_shadow'],
  organisations_domaines_email: [],
  contacts_traiteurs: [],
  packs_antgaspi: [],
  evenements: [
    'trg_evenement_marque_collectes_modifiees',
    'trg_garde_format_logo',
  ],
  collectes: [
    'trg_collecte_contacts_par_defaut',
    'trg_collectes_evenement_suit_n1',
    'trg_collectes_pax_par_defaut',
    'trg_collectes_type_evenement_par_defaut',
    'trg_horodater_annulation_demandee',
    'trg_set_date_evenement',
    'trg_set_pax_evenement',
    'trg_set_volume_estime_repas',
  ],
  collecte_contacts: ['trg_collecte_contacts_evenement_suit_n1'],
  collecte_flux: [],
  attributions_antgaspi: ['trg_mode_validation_immutable'],
};

async function declencheursPresents(
  client: Requeteur,
): Promise<{ table: string; nom: string; actif: boolean }[]> {
  const { rows } = await client.query(
    `SELECT c.relname AS "table", t.tgname AS nom, t.tgenabled = 'O' AS actif
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'plateforme'
        AND c.relname = ANY($1)`,
    [[...TABLES_CIBLES]],
  );
  return rows as { table: string; nom: string; actif: boolean }[];
}

/**
 * Le schéma bouge : un déclencheur que cette liste ne connaît pas, ou qui a
 * disparu, arrête l'import. Il faut alors le classer (coupé ou laissé actif).
 */
export async function verifierInventaireDeclencheurs(
  client: Requeteur,
): Promise<void> {
  const connus = new Set([
    ...DECLENCHEURS_COUPES.map((d) => `${d.table}.${d.nom}`),
    ...Object.entries(DECLENCHEURS_LAISSES).flatMap(([table, noms]) =>
      noms.map((nom) => `${table}.${nom}`),
    ),
  ]);
  const presents = new Set(
    (await declencheursPresents(client)).map((d) => `${d.table}.${d.nom}`),
  );
  const inconnus = [...presents].filter((d) => !connus.has(d)).sort();
  const disparus = [...connus].filter((d) => !presents.has(d)).sort();
  if (inconnus.length > 0 || disparus.length > 0)
    throw new Error(
      'Inventaire des déclencheurs à refaire avant tout import.\n' +
        (inconnus.length ? `  Non classés : ${inconnus.join(', ')}\n` : '') +
        (disparus.length ? `  Disparus : ${disparus.join(', ')}\n` : ''),
    );
}

export async function basculerDeclencheurs(
  client: Requeteur,
  etat: 'DISABLE' | 'ENABLE',
): Promise<void> {
  for (const d of DECLENCHEURS_COUPES)
    await client.query(
      `ALTER TABLE plateforme.${d.table} ${etat} TRIGGER ${d.nom}`,
    );
}

/** Contrôle de fin : aucun déclencheur des tables cibles ne reste coupé. */
export async function exigerDeclencheursActifs(
  client: Requeteur,
): Promise<void> {
  const coupes = (await declencheursPresents(client)).filter((d) => !d.actif);
  if (coupes.length > 0)
    throw new Error(
      `Déclencheurs restés coupés : ${coupes.map((d) => `${d.table}.${d.nom}`).join(', ')}`,
    );
}
