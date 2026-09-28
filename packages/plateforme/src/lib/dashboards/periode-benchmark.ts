import { jourParis } from '@savr/shared/src/temps/index.js';

// Période du repère parc — FIXE, 24 derniers mois glissants, sur toutes les vues
// benchmark (dashboards traiteur/gestionnaire/agence, fiche collecte, Dashboard
// Client Admin, rapport PDF). Décision Val 2026-09-28 : le choix de période est
// retiré de l'UI (ex-défaut CDC 12 mois + raccourcis 24 mois / année civile).
export const MOIS_PERIODE_BENCHMARK = 24;

// Calcul sur le jour CIVIL de Paris (pas de setMonth dans le fuseau du process :
// serveur UTC et navigateur Paris divergeraient d'un jour près de minuit). 24 mois
// = même jour 2 ans plus tôt ; seul le 29 février n'existe pas → 28 février.
export function periodeBenchmark(now: Date = new Date()): {
  debut: string;
  fin: string;
} {
  const fin = jourParis(now);
  const [annee, mois, jour] = fin.split('-');
  const anneeDebut = Number(annee) - MOIS_PERIODE_BENCHMARK / 12;
  const jourDebut = mois === '02' && jour === '29' ? '28' : jour;
  return { debut: `${anneeDebut}-${mois}-${jourDebut}`, fin };
}
