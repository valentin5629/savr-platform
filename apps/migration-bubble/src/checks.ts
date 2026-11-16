/**
 * Checks de réconciliation (05 - Checks reconciliation). Chaque requête rend
 * les anomalies : 0 ligne = vert.
 *
 * Les attendus côté source sont relus en SQL dans le staging brut
 * (`migration.sources_brutes`), sans passer par le code TypeScript : un défaut
 * de lecture d'un nombre ou d'un statut dans le script se voit ici.
 *
 * `bloquant` : un rouge arrête la bascule. `gate_go_live` : complétion attendue
 * de l'Admin avant l'ouverture (rouge normal en répétition).
 */
import type { Requeteur } from './base';
import { TYPE_TMS_CAMION } from './referentiel-tms';
import { EMAIL_COMPTE_SYSTEME } from './transformations/organisations';
import {
  EMAIL_A_COMPLETER,
  SIREN_A_COMPLETER,
} from './transformations/referentiels';

export interface Check {
  code: string;
  libelle: string;
  nature: 'bloquant' | 'gate_go_live';
  sql: string;
}

const COLLECTES_SRC = `(SELECT s.bubble_id, s.ligne FROM migration.sources_brutes s
   WHERE s.source_type IN ('collectes_ag', 'collectes_zd')
     AND NOT EXISTS (SELECT 1 FROM migration.rejets r
                      WHERE r.source_type = 'collecte' AND r.bubble_id = s.bubble_id))`;
const IMPORTEES = (table: string) =>
  `(SELECT t.* FROM plateforme.${table} t
     WHERE EXISTS (SELECT 1 FROM migration.id_map m
                    WHERE m.target_table = '${table}' AND m.target_id = t.id))`;
/** Don attendu : anti-gaspi « Terminée », sans la mention « pas d'excédents », au poids strictement positif. */
const DON_SRC = `(s.ligne ->> 'Type' = 'NOURRITURE' AND s.ligne ->> 'Statut' = 'Terminée'
     AND lower(btrim(coalesce(s.ligne ->> 'Pas d''excédents', ''))) <> 'oui'
     AND coalesce(migration.nombre(s.ligne ->> 'Poids total'), 0) > 0)`;
const FICHE_HISTORIQUE = (cle: string, colonne: string) =>
  `JOIN migration.id_map h ON h.source_type = 'systeme' AND h.bubble_id = '${cle}'
                           AND h.target_id = ${colonne}`;
const DEBITEES = `('programmee','validee','en_cours','realisee','realisee_sans_collecte','cloturee','annulee')`;
/** Pesées attendues : collectes de déchets « Terminée » × 5 flux, poids strictement positif. */
const PESEES_SRC = `(SELECT c.bubble_id, migration.nombre(p.ligne ->> f.colonne) AS poids
   FROM ${COLLECTES_SRC} c
   JOIN migration.sources_brutes p
     ON p.source_type = 'poids_zd' AND p.bubble_id = btrim(c.ligne ->> 'Poids déchets')
  CROSS JOIN (VALUES ('Biodéchets (kg)'), ('Carton (kg)'), ('DIB (kg)'),
                     ('Plastique (kg)'), ('Verre (kg)')) AS f(colonne)
  WHERE c.ligne ->> 'Type' = 'DECHET' AND c.ligne ->> 'Statut' = 'Terminée'
    AND migration.nombre(p.ligne ->> f.colonne) > 0)`;

export const CHECKS: Check[] = [
  {
    code: 'A1',
    libelle:
      'Collectes importées = collectes de l’export moins les rejets tracés',
    nature: 'bloquant',
    sql: `SELECT cible, source FROM (SELECT
            (SELECT count(*) FROM ${IMPORTEES('collectes')} c) AS cible,
            (SELECT count(*) FROM ${COLLECTES_SRC} s) AS source) x WHERE cible <> source`,
  },
  {
    code: 'A2',
    libelle: 'Répartition anti-gaspi / zéro déchet identique à l’export',
    nature: 'bloquant',
    sql: `SELECT * FROM (
            SELECT t.type,
                   (SELECT count(*) FROM ${IMPORTEES('collectes')} c WHERE c.type::text = t.type) AS cible,
                   (SELECT count(*) FROM ${COLLECTES_SRC} s WHERE s.ligne ->> 'Type' = t.bubble) AS source
              FROM (VALUES ('anti_gaspi', 'NOURRITURE'), ('zero_dechet', 'DECHET')) AS t(type, bubble)
          ) x WHERE cible <> source`,
  },
  {
    code: 'A3',
    libelle: 'Un événement par collecte, tous au nom du compte système',
    nature: 'bloquant',
    sql: `SELECT evenements, collectes FROM (SELECT
            (SELECT count(*) FROM ${IMPORTEES('evenements')} e
              WHERE e.created_by = (SELECT id FROM plateforme.users WHERE email = '${EMAIL_COMPTE_SYSTEME}')) AS evenements,
            (SELECT count(*) FROM ${IMPORTEES('collectes')} c) AS collectes) x
          WHERE evenements <> collectes
          UNION ALL
          SELECT count(*), 1 FROM ${IMPORTEES('collectes')} c
           GROUP BY c.evenement_id HAVING count(*) <> 1`,
  },
  {
    code: 'A4',
    libelle:
      'Clients : chaque entreprise ou agence de l’export est importée, regroupée ou rejetée',
    nature: 'bloquant',
    sql: `SELECT s.source_type, s.bubble_id FROM migration.sources_brutes s
           WHERE s.source_type IN ('entreprises', 'agences')
             AND NOT EXISTS (SELECT 1 FROM migration.id_map m
                              JOIN plateforme.organisations o ON o.id = m.target_id
                             WHERE m.source_type = rtrim(s.source_type, 's') AND m.bubble_id = s.bubble_id)
             AND NOT EXISTS (SELECT 1 FROM migration.rejets r
                              WHERE r.source_type = rtrim(s.source_type, 's') AND r.bubble_id = s.bubble_id)`,
  },
  {
    code: 'A5',
    libelle:
      'Aucun utilisateur importé hors le compte système ; domaines importés tous vérifiés',
    nature: 'bloquant',
    sql: `SELECT 'comptes importés : ' || count(*) FROM ${IMPORTEES('users')} u HAVING count(*) <> 1
          UNION ALL
          SELECT 'domaine non vérifié : ' || d.domaine FROM ${IMPORTEES('organisations_domaines_email')} d
           WHERE d.verifie_at IS NULL`,
  },
  {
    code: 'A6',
    libelle:
      'Référentiels : chaque ligne de l’export est importée, regroupée ou rejetée (associations, transporteurs, packs, lieux, contacts)',
    nature: 'bloquant',
    sql: `SELECT s.source_type, count(*) AS sans_suite
            FROM migration.sources_brutes s
            JOIN (VALUES ('points_depot', 'point_depot'), ('transporteurs', 'transporteur'),
                         ('packs', 'pack'), ('abonnements', 'abonnement'),
                         ('lieux', 'lieu'), ('contacts', 'contact')) AS t(source, cle)
              ON t.source = s.source_type
           WHERE NOT EXISTS (SELECT 1 FROM migration.id_map m
                              WHERE m.source_type = t.cle AND m.bubble_id = s.bubble_id)
             AND NOT EXISTS (SELECT 1 FROM migration.rejets r
                              WHERE r.source_type = t.cle AND r.bubble_id = s.bubble_id)
           GROUP BY s.source_type`,
  },
  {
    code: 'A7',
    libelle:
      'Lignes de pesée importées = pesées positives des collectes de déchets terminées',
    nature: 'bloquant',
    sql: `SELECT cible, source FROM (SELECT
            (SELECT count(*) FROM ${IMPORTEES('collecte_flux')} f) AS cible,
            (SELECT count(*) FROM ${PESEES_SRC} p) AS source) x WHERE cible <> source`,
  },
  {
    code: 'A8',
    libelle:
      'Anti-gaspi terminée : clôturée si l’export porte un poids sans la mention « pas d’excédents », « réalisée sans collecte » sinon',
    nature: 'bloquant',
    sql: `SELECT s.bubble_id, c.statut FROM ${COLLECTES_SRC} s
            JOIN migration.id_map m ON m.source_type = 'collecte' AND m.bubble_id = s.bubble_id
            JOIN plateforme.collectes c ON c.id = m.target_id
           WHERE s.ligne ->> 'Type' = 'NOURRITURE' AND s.ligne ->> 'Statut' = 'Terminée'
             AND c.statut::text <> CASE WHEN ${DON_SRC} THEN 'cloturee' ELSE 'realisee_sans_collecte' END`,
  },
  {
    code: 'B1',
    libelle:
      'Crédits initiaux des packs = tailles de packs et d’abonnements de l’export',
    nature: 'bloquant',
    sql: `SELECT cible, source FROM (SELECT
            (SELECT coalesce(sum(p.credits_initiaux), 0) FROM ${IMPORTEES('packs_antgaspi')} p) AS cible,
            (SELECT coalesce(sum(migration.nombre(
                      CASE s.source_type WHEN 'packs' THEN s.ligne ->> 'Type'
                                         ELSE s.ligne ->> 'Nombre de collectes' END)), 0)
               FROM migration.sources_brutes s
              WHERE s.source_type IN ('packs', 'abonnements')
                AND NOT EXISTS (SELECT 1 FROM migration.rejets r
                                 WHERE r.source_type = rtrim(s.source_type, 's')
                                   AND r.bubble_id = s.bubble_id)) AS source) x
          WHERE cible <> source`,
  },
  {
    code: 'B2',
    libelle:
      'Crédits consommés = collectes rattachées et débitées, bornées aux crédits initiaux (un abonnement sans collecte rattachée, épuisé par convention, n’est pas jugé)',
    nature: 'bloquant',
    sql: `SELECT p.id, p.credits_consommes, n.rattachees
            FROM ${IMPORTEES('packs_antgaspi')} p
            JOIN migration.id_map m ON m.target_table = 'packs_antgaspi' AND m.target_id = p.id
           CROSS JOIN LATERAL (SELECT count(*) AS rattachees FROM plateforme.collectes c
                                WHERE c.pack_antgaspi_id = p.id AND c.statut::text IN ${DEBITEES}) n
           WHERE (m.source_type = 'pack' OR n.rattachees > 0)
             AND p.credits_consommes <> least(p.credits_initiaux, n.rattachees)`,
  },
  {
    code: 'B3',
    libelle: 'Aucun pack sur-consommé',
    nature: 'bloquant',
    sql: `SELECT id FROM plateforme.packs_antgaspi WHERE credits_restants < 0`,
  },
  {
    code: 'B4',
    libelle: 'Un seul pack actif par organisation',
    nature: 'bloquant',
    sql: `SELECT organisation_id FROM plateforme.packs_antgaspi WHERE statut = 'actif'
           GROUP BY organisation_id HAVING count(*) > 1`,
  },
  {
    code: 'B5',
    libelle: 'Poids de déchets importés = poids de l’export (à 0,1 kg près)',
    nature: 'bloquant',
    sql: `SELECT cible, source FROM (SELECT
            (SELECT coalesce(sum(f.poids_reel_kg), 0) FROM ${IMPORTEES('collecte_flux')} f) AS cible,
            (SELECT coalesce(sum(p.poids), 0) FROM ${PESEES_SRC} p) AS source) x
          WHERE abs(cible - source) > 0.1`,
  },
  {
    code: 'B6',
    libelle:
      'Poids des dons importés = « Poids total » de tous les dons de l’export (à 0,1 kg près)',
    nature: 'bloquant',
    sql: `SELECT cible, source FROM (SELECT
            (SELECT coalesce(sum(a.poids_repas_kg), 0) FROM ${IMPORTEES('attributions_antgaspi')} a) AS cible,
            (SELECT coalesce(sum(migration.nombre(s.ligne ->> 'Poids total')), 0)
               FROM ${COLLECTES_SRC} s WHERE ${DON_SRC}) AS source) x
          WHERE abs(cible - source) > 0.1`,
  },
  {
    code: 'B7',
    libelle:
      'Repas = poids du don divisé par le poids d’un repas, arrondi au supérieur',
    nature: 'bloquant',
    sql: `SELECT a.id FROM ${IMPORTEES('attributions_antgaspi')} a
           WHERE a.volume_repas_realise IS DISTINCT FROM
                 ceil(a.poids_repas_kg / (SELECT (valeur #>> '{}')::numeric
                                            FROM plateforme.parametres_algo
                                           WHERE cle = 'poids_par_repas_kg'))::int`,
  },
  {
    code: 'C1',
    libelle:
      'Intégrité : événements → organisation, lieu, entité de facturation ; collectes → événement ; pesées et attributions → collecte',
    nature: 'bloquant',
    sql: `SELECT 'evenement sans organisation', e.id FROM plateforme.evenements e
            LEFT JOIN plateforme.organisations o ON o.id = e.organisation_id WHERE o.id IS NULL
          UNION ALL SELECT 'evenement sans lieu', e.id FROM plateforme.evenements e
            LEFT JOIN plateforme.lieux l ON l.id = e.lieu_id WHERE l.id IS NULL
          UNION ALL SELECT 'evenement sans entite', e.id FROM plateforme.evenements e
            LEFT JOIN plateforme.entites_facturation f ON f.id = e.entite_facturation_id WHERE f.id IS NULL
          UNION ALL SELECT 'collecte sans evenement', c.id FROM plateforme.collectes c
            LEFT JOIN plateforme.evenements e ON e.id = c.evenement_id WHERE e.id IS NULL
          UNION ALL SELECT 'pesee sans collecte', f.id FROM plateforme.collecte_flux f
            LEFT JOIN plateforme.collectes c ON c.id = f.collecte_id WHERE c.id IS NULL
          UNION ALL SELECT 'attribution sans collecte', a.id FROM plateforme.attributions_antgaspi a
            LEFT JOIN plateforme.collectes c ON c.id = a.collecte_id WHERE c.id IS NULL
          UNION ALL SELECT 'utilisateur sans organisation', u.id FROM plateforme.users u
            LEFT JOIN plateforme.organisations o ON o.id = u.organisation_id WHERE o.id IS NULL
          UNION ALL SELECT 'collecte sans contacts', c.id FROM ${IMPORTEES('collectes')} c
            LEFT JOIN plateforme.collecte_contacts k ON k.collecte_id = c.id WHERE k.collecte_id IS NULL`,
  },
  {
    code: 'C8',
    libelle:
      'Toute collecte de déchets clôturée non « historique partiel » a au moins une pesée',
    nature: 'bloquant',
    sql: `SELECT c.id FROM plateforme.collectes c
           WHERE c.type = 'zero_dechet' AND c.statut = 'cloturee' AND NOT c.historique_partiel
             AND NOT EXISTS (SELECT 1 FROM plateforme.collecte_flux f WHERE f.collecte_id = c.id)`,
  },
  {
    code: 'C9',
    libelle:
      'Toute collecte anti-gaspi clôturée a son attribution, avec un poids',
    nature: 'bloquant',
    sql: `SELECT c.id FROM ${IMPORTEES('collectes')} c
           WHERE c.type = 'anti_gaspi' AND c.statut = 'cloturee'
             AND NOT EXISTS (SELECT 1 FROM plateforme.attributions_antgaspi a
                              WHERE a.collecte_id = c.id AND a.poids_repas_kg > 0)`,
  },
  {
    code: 'E1',
    libelle:
      'Chaque collecte est rattachée au client que l’export désigne (raison sociale, sinon compte créateur), ou à l’organisation d’accueil',
    nature: 'bloquant',
    sql: `WITH clients AS (
            SELECT DISTINCT lower(btrim(s.ligne ->> 'Raison sociale')) AS nom, m.target_id AS organisation
              FROM migration.sources_brutes s
              JOIN migration.id_map m ON m.source_type = 'entreprise' AND m.bubble_id = s.bubble_id
             WHERE s.source_type = 'entreprises'
          ), attendu AS (
            SELECT c.bubble_id,
                   coalesce(par_nom.organisation, par_compte.organisation,
                            (SELECT m.target_id FROM migration.id_map m
                              WHERE m.source_type = 'systeme' AND m.bubble_id = 'organisation-sans-client')) AS organisation
              FROM ${COLLECTES_SRC} c
              LEFT JOIN clients par_nom ON par_nom.nom = lower(btrim(c.ligne ->> 'User entreprise'))
              LEFT JOIN migration.sources_brutes u
                ON u.source_type = 'utilisateurs'
               AND lower(btrim(u.ligne ->> 'email')) = lower(btrim(c.ligne ->> 'User'))
              LEFT JOIN clients par_compte ON par_compte.nom = lower(btrim(u.ligne ->> 'Entreprise'))
          )
          SELECT a.bubble_id FROM attendu a
            JOIN migration.id_map m ON m.source_type = 'evenement' AND m.bubble_id = a.bubble_id
            JOIN plateforme.evenements e ON e.id = m.target_id
           WHERE e.traiteur_operationnel_organisation_id IS DISTINCT FROM a.organisation`,
  },
  {
    code: 'E2',
    libelle:
      'CO₂ et taux de recyclage présents sur toute collecte de déchets clôturée qui a des pesées',
    nature: 'bloquant',
    sql: `SELECT c.id FROM ${IMPORTEES('collectes')} c
           WHERE c.type = 'zero_dechet' AND c.statut = 'cloturee'
             AND EXISTS (SELECT 1 FROM plateforme.collecte_flux f WHERE f.collecte_id = c.id)
             AND (c.taux_recyclage IS NULL OR c.caps_appliques IS NULL
                  OR c.co2_induit_kg IS NULL OR c.co2_evite_kg IS NULL OR c.co2_facteurs_snapshot IS NULL)`,
  },
  {
    code: 'E3',
    libelle: 'Aucune collecte hors de la plage 2019-2027',
    nature: 'bloquant',
    sql: `SELECT c.id FROM ${IMPORTEES('collectes')} c
           WHERE c.date_collecte NOT BETWEEN DATE '2019-01-01' AND DATE '2027-12-31'`,
  },
  {
    code: 'E4',
    libelle: 'Nombre de convives à 0 toujours marqué « historique partiel »',
    nature: 'bloquant',
    sql: `SELECT c.id FROM ${IMPORTEES('collectes')} c
            JOIN plateforme.evenements e ON e.id = c.evenement_id
           WHERE (c.pax = 0 OR e.pax = 0) AND NOT c.historique_partiel`,
  },
  {
    code: 'E5',
    libelle: '« Réalisée sans collecte » réservé à l’anti-gaspi',
    nature: 'bloquant',
    sql: `SELECT id FROM plateforme.collectes
           WHERE statut = 'realisee_sans_collecte' AND type <> 'anti_gaspi'`,
  },
  {
    code: 'E7',
    libelle:
      'CO₂ évité présent sur toute collecte anti-gaspi clôturée ; égal aux repas × facteur',
    nature: 'bloquant',
    sql: `SELECT c.id FROM ${IMPORTEES('collectes')} c
            LEFT JOIN plateforme.attributions_antgaspi a ON a.collecte_id = c.id
           WHERE c.type = 'anti_gaspi' AND c.statut = 'cloturee'
             AND (c.co2_evite_kg IS NULL
                  OR c.co2_evite_kg <> coalesce(a.volume_repas_realise, 0)
                       * (c.co2_facteurs_snapshot ->> 'facteur_co2_evite_par_repas_kg')::numeric)`,
  },
  {
    code: 'E8',
    libelle:
      'Collectes de plus de 5 ans : aucun nom de contact sur place, aucune consigne libre',
    nature: 'bloquant',
    sql: `SELECT c.id FROM ${IMPORTEES('collectes')} c
            JOIN plateforme.evenements e ON e.id = c.evenement_id
            JOIN plateforme.collecte_contacts k ON k.collecte_id = c.id
           WHERE c.date_collecte < ((now() AT TIME ZONE 'Europe/Paris')::date - INTERVAL '5 years')
             AND (e.contact_principal_nom <> '—' OR e.contact_secours_nom IS NOT NULL
                  OR k.contact_principal_nom <> '—' OR k.contact_secours_nom IS NOT NULL
                  OR c.informations_supplementaires IS NOT NULL
                  OR e.notes_internes <> 'Migration Bubble')`,
  },
  {
    code: 'E9',
    libelle:
      'Historique jamais transmis à un prestataire : statut prestataire « non envoyé », aucun prestataire, aucune collecte à venir avec une référence de l’ancien logiciel',
    nature: 'bloquant',
    sql: `SELECT c.id FROM ${IMPORTEES('collectes')} c
           WHERE c.statut_tms <> 'non_envoye' OR c.prestataire_logistique_id IS NOT NULL
              OR c.dirty_tms OR (c.statut = 'programmee' AND c.tms_reference IS NOT NULL)`,
  },
  {
    code: 'E10',
    libelle:
      'Marquage : toute collecte importée porte l’origine « migration_bubble », et aucune autre collecte ne la porte',
    nature: 'bloquant',
    sql: `SELECT c.id FROM plateforme.collectes c
           WHERE (c.origine = 'migration_bubble') IS DISTINCT FROM
                 EXISTS (SELECT 1 FROM migration.id_map m
                          WHERE m.target_table = 'collectes' AND m.target_id = c.id)`,
  },
  {
    code: 'E11',
    libelle:
      'Fiches « historique non renseigné » : inactives, sans logiciel de transport, et jamais à la place d’une association ou d’un transporteur que l’export désigne',
    nature: 'bloquant',
    sql: `SELECT 'association historique active' AS anomalie, a.id FROM plateforme.associations a
            ${FICHE_HISTORIQUE('association-historique', 'a.id')} WHERE a.actif
          UNION ALL
          SELECT 'transporteur historique actif ou relié à un logiciel', t.id FROM plateforme.transporteurs t
            ${FICHE_HISTORIQUE('transporteur-historique', 't.id')}
           WHERE t.actif OR t.type_tms::text <> 'autre' OR t.prestataire_logistique_id IS NOT NULL
          UNION ALL
          SELECT 'association connue remplacée par la fiche historique', a.id
            FROM plateforme.attributions_antgaspi a
            ${FICHE_HISTORIQUE('association-historique', 'a.association_id')}
            JOIN migration.id_map m ON m.source_type = 'attribution' AND m.target_id = a.id
            JOIN migration.sources_brutes s ON s.source_type = 'collectes_ag' AND s.bubble_id = m.bubble_id
           WHERE EXISTS (SELECT 1 FROM migration.sources_brutes p
                           JOIN migration.id_map mp ON mp.source_type = 'point_depot' AND mp.bubble_id = p.bubble_id
                          WHERE p.source_type = 'points_depot'
                            AND btrim(p.ligne ->> 'Nom') = btrim(s.ligne ->> 'Point de dépot'))
          UNION ALL
          SELECT 'transporteur connu remplacé par la fiche historique', a.id
            FROM plateforme.attributions_antgaspi a
            ${FICHE_HISTORIQUE('transporteur-historique', 'a.transporteur_id')}
            JOIN migration.id_map m ON m.source_type = 'attribution' AND m.target_id = a.id
            JOIN migration.sources_brutes s ON s.source_type = 'collectes_ag' AND s.bubble_id = m.bubble_id
           WHERE EXISTS (SELECT 1 FROM migration.id_map mt
                          WHERE mt.source_type = 'transporteur'
                            AND mt.bubble_id = btrim(s.ligne ->> 'Transporteur'))`,
  },
  {
    code: 'D1',
    libelle: 'Transporteur actif avec SIREN, email ou téléphone à compléter',
    nature: 'gate_go_live',
    sql: `SELECT id FROM plateforme.transporteurs
           WHERE actif AND (siren = '${SIREN_A_COMPLETER}' OR contact_email = '${EMAIL_A_COMPLETER}' OR contact_telephone = '-')`,
  },
  {
    code: 'D2',
    libelle:
      'Transporteur actif relié au logiciel de transport des camions sans son code',
    nature: 'gate_go_live',
    sql: `SELECT id FROM plateforme.transporteurs
           WHERE actif AND type_tms::text = '${TYPE_TMS_CAMION}' AND code_transporteur_mts1 IS NULL`,
  },
  {
    code: 'D3',
    libelle: 'Association active avec email de contact à compléter',
    nature: 'gate_go_live',
    sql: `SELECT id FROM plateforme.associations WHERE actif AND contact_email = '${EMAIL_A_COMPLETER}'`,
  },
  {
    code: 'D4',
    libelle:
      'Organisation active dont l’entité de facturation n’a pas de SIRET',
    nature: 'gate_go_live',
    sql: `SELECT f.id FROM plateforme.entites_facturation f
            JOIN plateforme.organisations o ON o.id = f.organisation_id
           WHERE o.actif AND f.siret = ''`,
  },
  {
    code: 'D6',
    libelle: 'Collecte à venir non encore renvoyée au prestataire par l’équipe',
    nature: 'gate_go_live',
    sql: `SELECT id FROM plateforme.collectes
           WHERE statut = 'programmee' AND statut_tms = 'non_envoye'
             AND date_collecte >= (now() AT TIME ZONE 'Europe/Paris')::date`,
  },
];

export interface ResultatCheck {
  code: string;
  libelle: string;
  nature: Check['nature'];
  anomalies: number;
  exemples: Record<string, unknown>[];
}

export async function jouerChecks(client: Requeteur): Promise<ResultatCheck[]> {
  const resultats: ResultatCheck[] = [];
  for (const c of CHECKS) {
    const { rows } = await client.query(c.sql);
    resultats.push({
      code: c.code,
      libelle: c.libelle,
      nature: c.nature,
      anomalies: rows.length,
      exemples: rows.slice(0, 5),
    });
  }
  return resultats;
}
