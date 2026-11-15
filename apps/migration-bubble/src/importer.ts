/**
 * Un passage d'import, du dossier d'exports à la base (03 - Ordre d'execution).
 *
 * Tout ce qui touche `plateforme.*` tient dans UNE transaction : un échec, quel
 * qu'il soit, laisse la base et ses déclencheurs dans l'état d'avant.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  basculerDeclencheurs,
  chargerStaging,
  connecter,
  ecrireCorrespondances,
  ecrireTable,
  exigerDeclencheursActifs,
  verifierInventaireDeclencheurs,
  type BilanEcriture,
  type Requeteur,
} from './base';
import { construirePlan } from './construire-plan';
import { ecrireCsv, lireCsv } from './csv';
import { situerAdresses } from './geocodage';
import { identifiantCible } from './identifiants';
import {
  TABLES_CIBLES,
  type CodeFlux,
  type Contexte,
  type LigneCible,
  type Plan,
} from './plan';
import { chargerSources, type TypeSource } from './sources';
import { adressesASituer } from './transformations/lieux';

export interface OptionsImport {
  adresseBase: string | undefined;
  dossierExports: string;
  dossierSortie: string;
  /** Dossier des fichiers validés par Val (par défaut : le dossier de sortie du passage précédent). */
  dossierDecisions: string;
  fichierCache: string;
  appliquerTypesProposes: boolean;
  /** `false` : aucun appel au service d'adresses, seules les réponses en cache servent. */
  situerLesLieux: boolean;
}

/** Tables où l'import ne doit RIEN écrire : ordres aux prestataires, documents, emails, alertes, journal. */
export const TABLES_SANS_EFFET = [
  'plateforme.outbox_events',
  'plateforme.jobs_pdf',
  'plateforme.emails_envoyes',
  'plateforme.alertes_admin',
  'plateforme.attestations_don',
  'plateforme.bordereaux_savr',
  'plateforme.factures',
  'plateforme.audit_log',
  'plateforme.integrations_inbox',
  'shared.fichiers',
];

export interface BilanPassage {
  horodatage: string;
  jourReference: string;
  exports: Record<
    string,
    {
      fichier: string;
      lignes: number;
      ecartes: { fichier: string; motif: string }[];
    }
  >;
  geocodage: {
    adresses: number;
    appels: number;
    echecs: number;
    duCache: number;
  };
  ecritures: Omit<BilanEcriture, 'touchees'>[];
  correspondances: { inserees: number; modifiees: number; disparues: number };
  rejets: Record<string, number>;
  listings: Record<string, number>;
  co2: { antiGaspi: number; zeroDechet: number };
  auteurs: MesuresAuteurs;
  comptes: Record<string, { avant: number; apres: number }>;
  dureesMs: Record<string, number>;
}

async function compter(
  client: Requeteur,
  tables: string[],
): Promise<Record<string, number>> {
  const comptes: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
    comptes[t] = rows[0]!.n as number;
  }
  return comptes;
}

function lireDecisions(
  dossier: string,
  fichier: string,
  cle: string,
  valeur: string,
): Map<string, string> {
  const chemin = join(dossier, fichier);
  const decisions = new Map<string, string>();
  if (!existsSync(chemin)) return decisions;
  for (const l of lireCsv(readFileSync(chemin, 'utf8')).lignes)
    if ((l[valeur] ?? '').trim() !== '')
      decisions.set(l[cle]!, l[valeur]!.trim());
  return decisions;
}

async function lireContexte(
  client: Requeteur,
  options: OptionsImport,
  geocodes: Contexte['geocodes'],
): Promise<Contexte> {
  const une = async (sql: string) => (await client.query(sql)).rows;
  const [temps] = await une(
    `SELECT to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS jour,
            to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') || '+00' AS instant`,
  );
  const [autre] = await une(
    `SELECT id FROM plateforme.types_evenements WHERE code = 'autre'`,
  );
  if (!autre)
    throw new Error('Référentiel types_evenements : code « autre » absent.');
  const flux = Object.fromEntries(
    (await une(`SELECT code, id FROM plateforme.flux_dechets`)).map((r) => [
      r.code,
      r.id,
    ]),
  ) as Record<CodeFlux, string>;
  for (const code of [
    'biodechet',
    'carton',
    'dechet_residuel',
    'emballage',
    'verre',
  ] as const)
    if (!flux[code])
      throw new Error(`Référentiel flux_dechets : code « ${code} » absent.`);
  const [poids] = await une(
    `SELECT (valeur #>> '{}')::float8 AS kg FROM plateforme.parametres_algo WHERE cle = 'poids_par_repas_kg'`,
  );
  const publics = (
    await une(`SELECT domaine FROM plateforme.domaines_email_publics`)
  ).map((r) => r.domaine as string);
  const jetables = createRequire(import.meta.url)(
    'disposable-email-domains',
  ) as string[];
  const { rows: savr } = await client.query(
    `SELECT o.id FROM plateforme.organisations o
      WHERE o.nom = 'Savr' AND o.id <> $1
        -- Une entreprise Bubble peut porter ce nom : seule une organisation que l'import n'a pas créée compte.
        AND NOT EXISTS (SELECT 1 FROM migration.id_map m WHERE m.target_id = o.id)
      ORDER BY o.created_at LIMIT 1`,
    [identifiantCible('organisation', 'savr')],
  );
  const d = options.dossierDecisions;
  return {
    jourReference: temps!.jour as string,
    instantImport: temps!.instant as string,
    domainesExclus: new Set([...publics, ...jetables, 'gosavr.io']),
    geocodes,
    decisions: {
      lieux: lireDecisions(d, 'lieux-a-valider.csv', 'cle', 'groupe_decide'),
      clients: lireDecisions(
        d,
        'clients-a-valider.csv',
        'bubble_id',
        'groupe_decide',
      ),
      types: lireDecisions(d, 'type_overrides.csv', 'bubble_id', 'type_valide'),
      exclusions: new Set(
        [...lireDecisions(d, 'exclusions.csv', 'bubble_id', 'exclure')]
          .filter(([, v]) => v.toLowerCase() === 'oui')
          .map(([cle]) => cle),
      ),
    },
    appliquerTypesProposes: options.appliquerTypesProposes,
    typeEvenementAutreId: autre.id as string,
    fluxParCode: flux,
    poidsParRepasKg: (poids?.kg as number | undefined) ?? 0.45,
    organisationSavrId: (savr[0]?.id as string | undefined) ?? null,
  };
}

/** Comptes sur les emails gardés pour rendre son historique au commercial — jamais les emails eux-mêmes. */
export interface MesuresAuteurs {
  evenements: number;
  avecEmailCommercial: number;
  avecEmailContactSeul: number;
  sansEmail: number;
  emailsDistincts: number;
  emailsSurDomainePublic: number;
  /** Emails dont le domaine n'est celui d'aucune organisation de l'événement (porteuse ou traiteur). */
  emailsHorsDomaineOrganisation: number;
  evenementsHorsDomaineOrganisation: number;
}

export async function mesurerAuteurs(
  client: Requeteur,
): Promise<MesuresAuteurs> {
  const { rows } = await client.query(
    `WITH evenements AS (
       SELECT e.id, e.organisation_id, e.traiteur_operationnel_organisation_id
         FROM plateforme.evenements e
        WHERE EXISTS (SELECT 1 FROM migration.id_map m
                       WHERE m.target_table = 'evenements' AND m.target_id = e.id)
     ), gardes AS (
       SELECT a.email, a.provenance, split_part(a.email, '@', 2) AS domaine,
              EXISTS (SELECT 1 FROM plateforme.organisations_domaines_email d
                       WHERE d.organisation_id IN (e.organisation_id, e.traiteur_operationnel_organisation_id)
                         AND d.domaine = split_part(a.email, '@', 2)) AS domaine_connu
         FROM migration.auteurs_evenements a
         JOIN evenements e ON e.id = a.evenement_id
     )
     SELECT (SELECT count(*) FROM evenements)::int AS "evenements",
            count(*) FILTER (WHERE provenance = 'commercial')::int AS "avecEmailCommercial",
            count(*) FILTER (WHERE provenance = 'contact_traiteur')::int AS "avecEmailContactSeul",
            ((SELECT count(*) FROM evenements) - count(*))::int AS "sansEmail",
            count(DISTINCT email)::int AS "emailsDistincts",
            count(DISTINCT email) FILTER (WHERE domaine IN (SELECT domaine FROM plateforme.domaines_email_publics))::int AS "emailsSurDomainePublic",
            count(DISTINCT email) FILTER (WHERE NOT domaine_connu)::int AS "emailsHorsDomaineOrganisation",
            count(*) FILTER (WHERE NOT domaine_connu)::int AS "evenementsHorsDomaineOrganisation"
       FROM gardes`,
  );
  return rows[0] as unknown as MesuresAuteurs;
}

/** Arrête l'import, avant toute écriture en base, tant qu'un point reste à trancher par Val. */
export function exigerAucunBlocage(plan: Plan): void {
  if (plan.blocages.length > 0)
    throw new Error(
      `Import arrêté avant toute écriture — ${plan.blocages.length} point(s) à trancher :\n` +
        plan.blocages.map((b) => `  - ${b}`).join('\n'),
    );
}

/** Écrit le plan dans la base, dans une transaction, déclencheurs à effets coupés. */
export async function ecrirePlan(
  client: Requeteur,
  plan: Plan,
): Promise<
  Pick<BilanPassage, 'correspondances' | 'co2'> & { ecritures: BilanEcriture[] }
> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '15s'`);
    await verifierInventaireDeclencheurs(client);
    const avant = await compter(client, TABLES_SANS_EFFET);
    await basculerDeclencheurs(client, 'DISABLE');
    const correspondances = await ecrireCorrespondances(
      client,
      plan.correspondances,
      plan.rejets,
    );
    await client.query(
      `DELETE FROM migration.auteurs_evenements a
        WHERE NOT (a.evenement_id = ANY($1::uuid[]))`,
      [plan.auteursEvenements.map((a) => a.evenement_id)],
    );
    await ecrireTable(
      client,
      'migration.auteurs_evenements',
      plan.auteursEvenements,
      { cle: 'evenement_id' },
    );

    const ecritures: BilanEcriture[] = [];
    for (const table of TABLES_CIBLES)
      ecritures.push(
        await ecrireTable(client, `plateforme.${table}`, plan.tables[table], {
          cle: table === 'collecte_contacts' ? 'collecte_id' : 'id',
          // Immuable après création (déclencheur de la base) : jamais dans une mise à jour.
          insertionSeule: table === 'transporteurs' ? ['type_tms'] : [],
        }),
      );
    // Fiches prestataires créées par le déclencheur des transporteurs : tracées pour la remise à zéro.
    await client.query(
      `INSERT INTO migration.id_map (source_type, bubble_id, target_table, target_id)
       SELECT 'prestataire', t.id::text, 'shared.prestataires', t.prestataire_logistique_id
         FROM plateforme.transporteurs t
         JOIN migration.id_map m ON m.target_table = 'transporteurs' AND m.target_id = t.id
        WHERE t.prestataire_logistique_id IS NOT NULL
       ON CONFLICT DO NOTHING`,
    );

    // CO₂ : calculé par les fonctions de la base, une fois par collecte touchée à ce passage.
    const touchees = (table: string) =>
      ecritures.find((e) => e.table === `plateforme.${table}`)!.touchees;
    const collecteDe = (table: 'collecte_flux' | 'attributions_antgaspi') => {
      const parId = new Map(
        plan.tables[table].map((l: LigneCible) => [
          l.id as string,
          l.collecte_id as string,
        ]),
      );
      return touchees(table).map((id) => parId.get(id)!);
    };
    const aRecalculer = [
      ...new Set([
        ...touchees('collectes'),
        ...collecteDe('collecte_flux'),
        ...collecteDe('attributions_antgaspi'),
      ]),
    ];
    const recalculer = async (fonction: string, type: string) =>
      (
        await client.query(
          `SELECT plateforme.${fonction}(c.id) FROM plateforme.collectes c
            WHERE c.id = ANY($1::uuid[]) AND c.type::text = $2 AND c.statut = 'cloturee'`,
          [aRecalculer, type],
        )
      ).rows.length;
    const co2 = {
      antiGaspi: await recalculer('fn_calculer_co2_ag', 'anti_gaspi'),
      zeroDechet: await recalculer('fn_calculer_co2_zd', 'zero_dechet'),
    };

    await basculerDeclencheurs(client, 'ENABLE');
    await exigerDeclencheursActifs(client);
    const apres = await compter(client, TABLES_SANS_EFFET);
    const effets = TABLES_SANS_EFFET.filter((t) => avant[t] !== apres[t]);
    if (effets.length > 0)
      throw new Error(
        `Effet de bord interdit : ${effets.map((t) => `${t} ${avant[t]} → ${apres[t]}`).join(', ')}.`,
      );
    await client.query('COMMIT');
    return { ecritures, correspondances, co2 };
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  }
}

export async function importer(options: OptionsImport): Promise<BilanPassage> {
  const dureesMs: Record<string, number> = {};
  const chrono = async <T>(
    etape: string,
    action: () => Promise<T> | T,
  ): Promise<T> => {
    const debut = performance.now();
    const resultat = await action();
    dureesMs[etape] = Math.round(performance.now() - debut);
    return resultat;
  };

  const client = await connecter(options.adresseBase);
  try {
    const sources = await chrono('lecture des exports', () =>
      chargerSources(options.dossierExports),
    );
    await chrono('staging', async () => {
      await client.query('BEGIN');
      for (const type of Object.keys(sources) as TypeSource[])
        await chargerStaging(client, type, sources[type].lignes);
      await client.query('COMMIT');
    });

    const aSituer = adressesASituer(
      sources.lieux.lignes,
      [...sources.collectes_ag.lignes, ...sources.collectes_zd.lignes].map(
        (l) => l['Lieu'] ?? '',
      ),
    );
    const position = await chrono('service d’adresses', () =>
      situerAdresses(aSituer, {
        fichierCache: options.fichierCache,
        appeler: options.situerLesLieux,
        pauseMs: 120,
      }),
    );

    const ctx = await lireContexte(client, options, position.geocodes);
    const plan = await chrono('transformations', () =>
      construirePlan(sources, ctx),
    );

    // Sorties hors dépôt : fichiers à valider, listes de complétion, bilan du passage.
    const sortie = options.dossierSortie;
    mkdirSync(join(sortie, 'listings'), { recursive: true });
    mkdirSync(join(sortie, 'passages'), { recursive: true });
    const ecrire = (chemin: string, lignes: LigneCible[]) => {
      if (lignes.length > 0)
        writeFileSync(
          join(sortie, chemin),
          ecrireCsv(Object.keys(lignes[0]!), lignes),
        );
    };
    ecrire('lieux-a-valider.csv', plan.aValider.lieux);
    ecrire('clients-a-valider.csv', plan.aValider.clients);
    ecrire('type_overrides.csv', plan.aValider.types);
    ecrire('exclusions.csv', plan.aValider.exclusions);
    for (const [nom, lignes] of Object.entries(plan.listings))
      ecrire(join('listings', `${nom}.csv`), lignes);
    // Les fichiers à valider sont écrits : Val a de quoi trancher. Rien n'entre en base d'ici là.
    exigerAucunBlocage(plan);

    const tablesComptees = [
      ...TABLES_CIBLES.map((t) => `plateforme.${t}`),
      'shared.prestataires',
      ...TABLES_SANS_EFFET,
    ];
    const avant = await compter(client, tablesComptees);
    const ecrit = await chrono('écriture', () => ecrirePlan(client, plan));
    const apres = await compter(client, tablesComptees);
    const [{ horodatage }] = (
      await client.query(
        `SELECT to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYYMMDD-HH24MISS') AS horodatage`,
      )
    ).rows as [{ horodatage: string }];

    const rejets: Record<string, number> = {};
    for (const r of plan.rejets) {
      // Les motifs qui citent une valeur de l'export (« type inconnu « X » ») sont regroupés.
      const cle = `${r.sourceType} — ${r.motif.replace(/«.*»/, '« … »')}`;
      rejets[cle] = (rejets[cle] ?? 0) + 1;
    }
    const bilan: BilanPassage = {
      horodatage,
      jourReference: ctx.jourReference,
      exports: Object.fromEntries(
        (Object.keys(sources) as TypeSource[]).map((t) => [
          t,
          {
            fichier: sources[t].fichier,
            lignes: sources[t].lignes.length,
            ecartes: sources[t].ecartes,
          },
        ]),
      ),
      geocodage: {
        adresses: aSituer.size,
        appels: position.appels,
        echecs: position.echecs,
        duCache: position.duCache,
      },
      ecritures: ecrit.ecritures.map(
        ({ touchees: _touchees, ...reste }) => reste,
      ),
      correspondances: ecrit.correspondances,
      rejets,
      listings: Object.fromEntries(
        Object.entries(plan.listings).map(([nom, l]) => [nom, l.length]),
      ),
      co2: ecrit.co2,
      auteurs: await mesurerAuteurs(client),
      comptes: Object.fromEntries(
        tablesComptees.map((t) => [t, { avant: avant[t]!, apres: apres[t]! }]),
      ),
      dureesMs,
    };

    writeFileSync(
      join(options.dossierSortie, 'passages', `passage-${horodatage}.json`),
      JSON.stringify(bilan, null, 2),
    );
    return bilan;
  } finally {
    await client.end();
  }
}
