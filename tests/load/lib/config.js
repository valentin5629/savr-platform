// Configuration d'un run de charge et ses gardes. Module pur (aucun import k6) :
// testé par Vitest (`config.test.ts`), importé par les scénarios k6.
//
// Cible : dev uniquement, jamais la prod (CDC §08 Performance/04, « Spec
// d'implémentation »). La garde est une LISTE BLANCHE d'hôtes, pas une liste
// noire : la prod répond aussi sous des adresses `*.vercel.app` (alias de la
// branche `main`), qu'une liste noire laisserait passer.

const HOTES_AUTORISES = new Set([
  'dev.app.gosavr.io',
  'savr-platform-git-dev-savr-s-projects.vercel.app',
  'localhost',
  '127.0.0.1',
]);

// Aperçu d'une branche autre que `main` : servi sur la base de dev.
const APERCU_BRANCHE =
  /^savr-platform-git-(?!main-)[a-z0-9-]+-savr-s-projects\.vercel\.app$/;

export function hoteAutorise(hote) {
  return HOTES_AUTORISES.has(hote) || APERCU_BRANCHE.test(hote);
}

function hoteLocal(hote) {
  return hote === 'localhost' || hote === '127.0.0.1';
}

// `env` = `__ENV` de k6. Lève une erreur lisible au lieu de lancer un run faux.
export function lireConfig(env) {
  const brute = env.BASE_URL;
  if (!brute) {
    throw new Error(
      'BASE_URL manquante (ex. https://dev.app.gosavr.io). Aucune cible par défaut.',
    );
  }
  let url;
  try {
    url = new URL(brute);
  } catch {
    throw new Error(`BASE_URL illisible : ${brute}`);
  }
  if (!hoteAutorise(url.hostname)) {
    throw new Error(
      `Hôte refusé : ${url.hostname}. Les tests de charge ne visent que dev, un aperçu de branche ou un serveur local, jamais la production.`,
    );
  }
  if (!env.MOT_DE_PASSE) {
    throw new Error(
      'MOT_DE_PASSE manquant : mot de passe des comptes de test (SEED_PASSWORD du seed).',
    );
  }
  const bypass = env.PROTECTION_BYPASS || '';
  if (!hoteLocal(url.hostname) && !bypass) {
    throw new Error(
      'PROTECTION_BYPASS manquant : sans lui, Vercel répond par sa page de connexion et le run mesurerait cette page.',
    );
  }
  const pause = lirePause(env.PAUSE_MIN_S, env.PAUSE_MAX_S);
  return {
    baseUrl: url.origin,
    motDePasse: env.MOT_DE_PASSE,
    bypass,
    pauseMinS: pause.min,
    pauseMaxS: pause.max,
  };
}

// Temps de réflexion entre deux écrans, en secondes. 15 à 30 s par défaut : à
// ce rythme, 44 utilisateurs traiteurs répartis sur 8 organisations restent sous
// le frein de débit (100 écritures par organisation sur 10 min), cf. README.
function lirePause(min, max) {
  const pMin = min === undefined ? 15 : Number(min);
  const pMax = max === undefined ? 30 : Number(max);
  if (!(pMin >= 0) || !(pMax >= pMin)) {
    throw new Error(`Pause invalide : PAUSE_MIN_S=${min}, PAUSE_MAX_S=${max}`);
  }
  return { min: pMin, max: pMax };
}

// Durée au format k6 (`90s`, `30m`, `24h`) en millisecondes.
export function dureeEnMs(texte) {
  const m = /^(\d+)(s|m|h)$/.exec(String(texte));
  if (!m)
    throw new Error(`Durée illisible : ${texte} (attendu : 90s, 30m, 24h)`);
  const unite = { s: 1000, m: 60 * 1000, h: 3600 * 1000 }[m[2]];
  return Number(m[1]) * unite;
}

// Entier positif lu dans l'environnement, avec sa valeur par défaut.
export function entier(valeur, defaut, nom) {
  if (valeur === undefined || valeur === '') return defaut;
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`${nom} invalide : ${valeur}`);
  return n;
}

// En-têtes communs. Le contournement de la protection Vercel passe par en-tête,
// jamais par l'URL (il finirait dans les journaux).
export function entetes(cfg, json = false) {
  const h = {};
  if (cfg.bypass) h['x-vercel-protection-bypass'] = cfg.bypass;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
