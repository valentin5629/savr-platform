// Scénario 1 — Charge nominale (BLOQUANT avant la production).
// CDC `08 - Performance/04 - Scenarios de charge.md` : 50 utilisateurs
// simultanés, montée en 2 min, 30 min de charge, 70 % lecture / 25 % écriture /
// 5 % batch. Succès = tous les p95 du `02 - SLA par endpoint`, erreurs < 0,1 %.
// Le critère « connexions DB < 80 % » se lit à côté : `echantillonner-base.sh`.
//
// Lancement : voir tests/load/README.md.

import { lireConfig, dureeEnMs, entier } from './lib/config.js';
import { seuilsK6 } from './lib/seuils.js';
import { compteDuVu, COMPTES_TRAITEUR } from './lib/comptes.js';
import {
  iteration,
  nettoyer,
  nouvelEtat,
  POIDS_EQUIPE,
  POIDS_TRAITEUR,
} from './lib/parcours.js';

const cfg = lireConfig(__ENV);
const VUS = entier(__ENV.VUS, 50, 'VUS');
const NB_EQUIPE = entier(__ENV.NB_EQUIPE, 6, 'NB_EQUIPE');
const DUREE = __ENV.DUREE || '30m';
const MONTEE = __ENV.MONTEE || '2m';
dureeEnMs(DUREE);
dureeEnMs(MONTEE);

export const options = {
  scenarios: {
    nominal: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: MONTEE, target: VUS },
        { duration: DUREE, target: VUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '60s',
    },
  },
  thresholds: seuilsK6({
    // Exposés dans le résumé pour lire le mix réel des requêtes.
    'requetes_par_nature{nature:lecture}': ['count>=0'],
    'requetes_par_nature{nature:ecriture}': ['count>=0'],
    'requetes_par_nature{nature:batch}': ['count>=0'],
  }),
  // Le nettoyage parcourt 16 comptes : plus que les 60 s par défaut.
  teardownTimeout: '5m',
};

let etat;

export default function () {
  if (!etat) etat = nouvelEtat(cfg, compteDuVu(__VU, NB_EQUIPE));
  iteration(
    etat,
    etat.compte.profil === 'equipe' ? POIDS_EQUIPE : POIDS_TRAITEUR,
  );
}

export function teardown() {
  const n = nettoyer(cfg, COMPTES_TRAITEUR);
  console.log(
    `Nettoyage : ${n} brouillon(s) de charge restant(s) supprimé(s).`,
  );
}
