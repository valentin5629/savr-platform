// Scénario 4 — Endurance 24 h (BLOQUANT avant la production).
// CDC `08 - Performance/04 - Scenarios de charge.md` : charge nominale
// atténuée soutenue 24 h. Succès = SLA p95 tenus, pas de dégradation des p95
// de plus de 20 % entre la 2e et la dernière heure, connexions DB et file
// `jobs_pdf` stables (ces deux-là se lisent avec `echantillonner-base.sh`).
//
// ⚠ Le critère de dégradation est calculé dans le résumé de fin, qui ne peut
// pas changer le code de sortie de k6 : lire la ligne « Dégradation » (et
// `resultats/s4-degradation.json`). Les seuils SLA, eux, font échouer le run.
//
// Lancement : voir tests/load/README.md.

import { lireConfig, dureeEnMs, entier } from './lib/config.js';
import { resumeSla, SLA, seuilsK6 } from './lib/seuils.js';
import { compteDuVu, COMPTES_TRAITEUR } from './lib/comptes.js';
import {
  seuilsTranches,
  tranche,
  verdictDegradation,
} from './lib/endurance.js';
import {
  iteration,
  nettoyer,
  nouvelEtat,
  POIDS_EQUIPE,
  POIDS_TRAITEUR,
} from './lib/parcours.js';

const cfg = lireConfig(__ENV);
const VUS = entier(__ENV.VUS, 25, 'VUS');
const NB_EQUIPE = entier(__ENV.NB_EQUIPE, 3, 'NB_EQUIPE');
const DUREE = __ENV.DUREE || '24h';
const MONTEE = __ENV.MONTEE || '2m';
const DUREE_MS = dureeEnMs(DUREE);
const MONTEE_MS = dureeEnMs(MONTEE);
const CATEGORIES = Object.keys(SLA);

export const options = {
  scenarios: {
    endurance: {
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
  thresholds: seuilsK6(seuilsTranches(CATEGORIES)),
  teardownTimeout: '5m',
  // Sans elle, k6 vide les cookies à chaque itération : la session de
  // l'utilisateur simulé disparaîtrait dès sa 2e action (401, mesuré).
  noCookiesReset: true,
};

export function setup() {
  return { debut: Date.now() };
}

let etat;

export default function (data) {
  if (!etat) {
    // L'horloge des tranches part de la fin de la montée en charge.
    const zero = data.debut + MONTEE_MS;
    etat = nouvelEtat(cfg, compteDuVu(__VU, NB_EQUIPE), () => ({
      tranche: tranche(Date.now() - zero, DUREE_MS),
    }));
  }
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

export function handleSummary(data) {
  const v = verdictDegradation(data.metrics, CATEGORIES);
  const pct = (x) => `${Math.round(x * 100)} %`;
  const ms = (x) => `${Math.round(x)} ms`;
  const lignes = v.lignes.map(
    (l) =>
      `  ${l.ok ? 'ok  ' : 'KO  '} ${l.categorie} : ${ms(l.debut)} → ${ms(l.fin)} (${pct(l.delta)})`,
  );
  const texte = [
    '',
    'SLA sur toute la durée (les seuils font échouer le run) :',
    ...resumeSla(data.metrics),
    '',
    `Dégradation des p95 (2e heure → dernière heure, limite 20 %) : ${
      v.lignes.length === 0
        ? 'NON MESURÉE (tranches vides)'
        : v.ok
          ? 'OK'
          : 'ÉCHEC'
    }`,
    ...lignes,
    '',
  ].join('\n');
  return {
    stdout: texte,
    'resultats/s4-degradation.json': JSON.stringify(v, null, 2),
    'resultats/s4-resume.json': JSON.stringify(data, null, 2),
  };
}
