import { decalerJour, jourParis } from '@savr/shared/src/temps/index.js';

// BL-P3-10 — Preset « 30 derniers jours » de la barre de filtres du registre
// (CDC §06.03). Renvoie la fenêtre [aujourd'hui − 30 jours ; aujourd'hui] au
// format YYYY-MM-DD attendu par les <input type="date">.
//
// Jours PARISIENS : le preset s'exécute dans le navigateur, mais la fenêtre qu'il
// pose part filtrer des dates métier côté serveur. Les getters locaux la
// rendaient dépendante du poste — décalée d'un jour pour un utilisateur hors du
// fuseau, et calculée en UTC lors du rendu serveur du composant.
export function preset30JoursRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const to = jourParis(now);
  return { from: decalerJour(to, -30), to };
}
