/**
 * État actif / inactif d'un enregistrement (colonne booléenne `actif`) —
 * R-UI-2 C6. Arbitrage Q2 OUVERT : libellé unique « Inactif » ; les comptes
 * utilisateurs disaient « Suspendu » (Admin fiche client + Utilisateurs Savr,
 * traiteur Mon organisation) ou « Désactivé » (gestionnaire Mon organisation)
 * pour le même état (`users.actif = false`, aucun état « suspendu » distinct en
 * DB). Les associations accordent au féminin (« Active » / « Inactive »).
 */
import type { VarianteBadge as Variant } from './types';

export type SujetActif = 'defaut' | 'association';

export const LIBELLE_ACTIF: Record<
  SujetActif,
  { actif: string; inactif: string }
> = {
  defaut: { actif: 'Actif', inactif: 'Inactif' },
  association: { actif: 'Active', inactif: 'Inactive' },
};

/** Options du filtre « Statut » des référentiels (valeurs d'URL `true`/`false`). */
export const OPTIONS_FILTRE_ACTIF = [
  { id: 'true', nom: 'Actifs' },
  { id: 'false', nom: 'Inactifs' },
];

export function libelleActif(
  actif: boolean,
  sujet: SujetActif = 'defaut',
): string {
  const l = LIBELLE_ACTIF[sujet];
  return actif ? l.actif : l.inactif;
}

export function variantActif(actif: boolean): Variant {
  return actif ? 'success' : 'neutral';
}
