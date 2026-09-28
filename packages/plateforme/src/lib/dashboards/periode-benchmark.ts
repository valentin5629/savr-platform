import { jourParis } from '@savr/shared/src/temps/index.js';

// Période du repère parc — FIXE, 24 derniers mois glissants, sur toutes les vues
// benchmark (dashboards traiteur/gestionnaire/agence, fiche collecte, Dashboard
// Client Admin, rapport PDF). Décision Val 2026-09-28 : le choix de période est
// retiré de l'UI (ex-défaut CDC 12 mois + raccourcis 24 mois / année civile).
export const MOIS_PERIODE_BENCHMARK = 24;

export function periodeBenchmark(now: Date = new Date()): {
  debut: string;
  fin: string;
} {
  const debut = new Date(now);
  debut.setMonth(debut.getMonth() - MOIS_PERIODE_BENCHMARK);
  return { debut: jourParis(debut), fin: jourParis(now) };
}
