/**
 * Catalogue des exports Bubble attendus et choix du fichier à charger.
 *
 * Un export peut exister en plusieurs versions dans le dossier (vues réduites,
 * anciens tirages). On prend, parmi les fichiers qui portent TOUTES les
 * colonnes dont l'import se sert, le plus récent ; si aucun ne les porte, on
 * s'arrête en nommant les colonnes manquantes de chaque fichier.
 *
 * Chauffeurs et images de rapports ne sont pas chargés : données abandonnées
 * (07 - Donnees abandonnees, items 1 et 16-17). D'un export chargé, seules les
 * colonnes du catalogue sont gardées.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { lireCsv, type Ligne } from './csv';

export type TypeSource =
  | 'collectes_ag'
  | 'collectes_zd'
  | 'poids_zd'
  | 'entreprises'
  | 'agences'
  | 'utilisateurs'
  | 'lieux'
  | 'contacts'
  | 'packs'
  | 'abonnements'
  | 'points_depot'
  | 'transporteurs';

const COLONNES_COLLECTES = [
  'Agence',
  "besoin de l'immatriculation",
  'Commentaires_interne',
  'Contact 1',
  'Contact 2',
  'Everest_mission_ref',
  'formule',
  'Heure du pickup',
  'Identifiant',
  'Instruction lieu',
  'Lieu',
  'mail du commercial',
  'MTS_1_tour_or_customer_order_id',
  'Nom du client',
  'Nom du lieu',
  'Nombre de convives',
  'numero du commercial',
  'pack lié',
  "Pas d'excédents",
  'Poids déchets',
  'Poids total',
  'Point de dépot',
  'Statut',
  'Transporteur',
  'Type',
  'User',
  'User entreprise',
  'Creation Date',
  'Modified Date',
  'unique id',
];

export const CATALOGUE: Record<
  TypeSource,
  { motif: RegExp; colonnes: string[] }
> = {
  collectes_ag: {
    motif: /^export_-+Collectes-Nourritures.*\.csv$/,
    colonnes: COLONNES_COLLECTES,
  },
  collectes_zd: {
    motif: /^export_-+Collectes-D-chets.*\.csv$/,
    colonnes: COLONNES_COLLECTES,
  },
  poids_zd: {
    motif: /^export_All-Poids-collecte-d-chets.*\.csv$/,
    colonnes: [
      'Biodéchets (kg)',
      'Carton (kg)',
      'DIB (kg)',
      'Plastique (kg)',
      'Verre (kg)',
      'unique id',
    ],
  },
  entreprises: {
    motif: /^export_All-Entreprises.*\.csv$/,
    colonnes: [
      'Adresse du siège',
      'Email de contact',
      'Identifiant',
      'logo',
      'Raison sociale',
      'SIRET',
      'Creation Date',
      'Modified Date',
      'unique id',
    ],
  },
  agences: {
    motif: /^export_All-Agences.*\.csv$/,
    colonnes: ['Nom', 'Creation Date', 'unique id'],
  },
  utilisateurs: {
    motif: /^export_All-Users.*\.csv$/,
    colonnes: ['email', 'Entreprise', 'unique id'],
  },
  lieux: {
    motif: /^export_All-Lieu--v-nementiels.*\.csv$/,
    colonnes: [
      'adresse',
      "besoin de la plaque d'immatriculation",
      'Entreprise',
      'instruction du lieu',
      'Nom du lieu',
      'Creation Date',
      'Modified Date',
      'unique id',
    ],
  },
  contacts: {
    motif: /^export_All-Contacts.*\.csv$/,
    colonnes: [
      'Entreprise liée',
      'linked_user',
      'Numero',
      'PrenomNom',
      'Creation Date',
      'unique id',
    ],
  },
  packs: {
    motif: /^export_All-Packs.*\.csv$/,
    colonnes: [
      'Collectes liées',
      'Status',
      'Type',
      'User',
      'Creation Date',
      'unique id',
    ],
  },
  abonnements: {
    motif: /^export_All-Abonnements.*\.csv$/,
    colonnes: [
      'Date début',
      'Date fin',
      'en_cours',
      'Nombre de collectes',
      'User',
      'Creation Date',
      'unique id',
    ],
  },
  points_depot: {
    motif: /^export_All-Point-de-d-pots.*\.csv$/,
    colonnes: [
      'Adresse',
      'description_pour_rapport_impact',
      'internal_usage_comment',
      'Lundi',
      'Mardi',
      'Mercredi',
      'Jeudi',
      'Vendredi',
      'Samedi',
      'Dimanche',
      'Logo',
      'mailing_list',
      'MTS_1_delivery_place_id',
      'Nb_bénéficiaires',
      'Nom',
      'Nom prenom contact',
      'Numero contact',
      'Print_name',
      'SIREN',
      'Type',
      'Creation Date',
      'Modified Date',
      'unique id',
    ],
  },
  transporteurs: {
    motif: /^export_All-Transporteurs.*\.csv$/,
    colonnes: [
      'Adresse',
      'internal_usage_comment',
      'Mail de contact',
      'Nom',
      'Nom de contact',
      'Numéro de contact',
      'process',
      'TmsType',
      'Véhicules utilisés',
      'Creation Date',
      'unique id',
    ],
  },
};

export class ExportInattendu extends Error {}

export interface SourceChargee {
  fichier: string;
  colonnes: string[];
  lignes: Ligne[];
  /** Fichiers du même type écartés, avec le motif (colonnes manquantes ou plus ancien). */
  ecartes: { fichier: string; motif: string }[];
}

export type Sources = Record<TypeSource, SourceChargee>;

/** Horodatage du nom Bubble (`…_2026-06-07_19-13-16.csv`), comparable en texte. */
function horodatageDuNom(fichier: string): string {
  return (
    /_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.csv$/.exec(fichier)?.[1] ?? ''
  );
}

export function choisirExport(
  type: TypeSource,
  candidats: { fichier: string; colonnes: string[] }[],
): { retenu: string; ecartes: { fichier: string; motif: string }[] } {
  const { colonnes: attendues } = CATALOGUE[type];
  const complets: string[] = [];
  const ecartes: { fichier: string; motif: string }[] = [];
  for (const c of candidats) {
    const manquantes = attendues.filter((a) => !c.colonnes.includes(a));
    if (manquantes.length === 0) complets.push(c.fichier);
    else
      ecartes.push({
        fichier: c.fichier,
        motif: `colonnes manquantes : ${manquantes.join(', ')}`,
      });
  }
  if (complets.length === 0) {
    const detail = ecartes.length
      ? ecartes.map((e) => `  - ${e.fichier} — ${e.motif}`).join('\n')
      : '  (aucun fichier de ce type dans le dossier)';
    throw new ExportInattendu(
      `Export « ${type} » : aucun fichier au format attendu.\n${detail}\n` +
        `Colonnes attendues : ${attendues.join(', ')}`,
    );
  }
  complets.sort((a, b) =>
    horodatageDuNom(a) === horodatageDuNom(b)
      ? a.localeCompare(b)
      : horodatageDuNom(a).localeCompare(horodatageDuNom(b)),
  );
  const retenu = complets.at(-1)!;
  for (const f of complets.slice(0, -1))
    ecartes.push({ fichier: f, motif: 'complet mais plus ancien' });
  return { retenu, ecartes };
}

/**
 * Ne garde d'une ligne d'export que les colonnes dont l'import se sert. Le
 * reste (journal Bubble, chauffeur, liens de photos, téléphone personnel d'un
 * utilisateur…) n'entre ni en mémoire ni dans le staging de la base.
 */
export function garderColonnesUtiles(
  type: TypeSource,
  lignes: Ligne[],
): Ligne[] {
  const { colonnes } = CATALOGUE[type];
  return lignes.map((l) =>
    Object.fromEntries(colonnes.map((c) => [c, l[c] ?? ''])),
  );
}

export function chargerSources(dossier: string): Sources {
  const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.csv'));
  const sources = {} as Sources;
  for (const type of Object.keys(CATALOGUE) as TypeSource[]) {
    const lus = fichiers
      .filter((f) => CATALOGUE[type].motif.test(f))
      .map((f) => ({
        fichier: f,
        ...lireCsv(readFileSync(join(dossier, f), 'utf8')),
      }));
    const { retenu, ecartes } = choisirExport(type, lus);
    const choisi = lus.find((l) => l.fichier === retenu)!;
    const sansIdentifiant = choisi.lignes.filter(
      (l) => !(l['unique id'] ?? '').trim(),
    ).length;
    if (sansIdentifiant > 0)
      throw new ExportInattendu(
        `Export « ${type} » (${retenu}) : ${sansIdentifiant} ligne(s) sans « unique id ».`,
      );
    sources[type] = {
      fichier: retenu,
      colonnes: CATALOGUE[type].colonnes,
      lignes: garderColonnesUtiles(type, choisi.lignes),
      ecartes,
    };
  }
  return sources;
}
