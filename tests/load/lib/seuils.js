// Seuils de succès des runs, recopiés du CDC. Module pur, testé par Vitest.
//
// Source : `specs/cdc/01 - Cahier des charges App/08 - Performance/02 - SLA par
// endpoint.md` (p95 bloquant, p99 plafond) et `04 - Scenarios de charge.md`
// (erreurs < 0,1 %). Chaque requête porte un tag `sla` : la catégorie ci-dessous
// dont elle relève. k6 sort en échec (code ≠ 0) si un seuil est dépassé.
//
// Mesure prise depuis le poste qui lance k6 : elle inclut l'aller-retour réseau
// jusqu'à Vercel (Paris), que le CDC ne compte pas (mesure serveur). Écart de
// l'ordre de 10 à 30 ms, au désavantage du run.

export const SLA = {
  // §6 Auth
  connexion: { p95: 500, ligne: 'Login' },
  // §1 Lecture
  liste: {
    p95: 200,
    p99: 500,
    ligne: 'Liste événements (paginée)',
  },
  fiche: { p95: 250, p99: 600, ligne: 'Fiche événement (détail)' },
  recherche: {
    p95: 400,
    p99: 1000,
    ligne: 'Recherche (orgas, lieux, collectes)',
  },
  tableau_de_bord_client: {
    p95: 500,
    p99: 1200,
    ligne: 'Dashboard traiteur / lieux / agence',
  },
  tableau_de_bord_admin: {
    p95: 800,
    p99: 2000,
    ligne: 'Dashboard Admin global',
  },
  registre: { p95: 600, p99: 1500, ligne: 'Registre réglementaire ZD (vue)' },
  export: {
    p95: 5000,
    p99: 15000,
    ligne: 'Export CSV / Excel (≤ 10 k lignes)',
  },
  // §2 Écriture
  programmation: {
    p95: 600,
    p99: 1500,
    ligne: 'Soumission formulaire programmation collecte',
  },
  modification: {
    p95: 500,
    p99: 1200,
    ligne: 'Modification collecte (→ PATCH outbox E2)',
  },
  // Suppression d'un brouillon : aucune ligne du CDC ne la nomme. Rapprochée de
  // « Annulation collecte », l'écriture la plus proche (une ligne, sans calcul).
  suppression: {
    p95: 400,
    p99: 1000,
    ligne: 'Annulation collecte (rapprochée)',
  },
};

// Taux d'erreur global maximal (scénario 1 : « < 0,1 % »).
export const TAUX_ERREUR_MAX = 0.001;

// Résumé court par catégorie (`metriques` = `data.metrics` de handleSummary),
// pour un scénario qui remplace le résumé par défaut de k6.
export function resumeSla(metriques) {
  const ms = (x) => (x === undefined ? '—' : `${Math.round(x)} ms`);
  const lignes = [];
  for (const [categorie, s] of Object.entries(SLA)) {
    const m = metriques[`http_req_duration{sla:${categorie}}`];
    if (!m || !m.values || !m.values.count) continue;
    const p95 = m.values['p(95)'];
    const ok = p95 < s.p95;
    lignes.push(
      `  ${ok ? 'ok  ' : 'KO  '} ${categorie} : p95 ${ms(p95)} (seuil ${s.p95} ms), ${m.values.count} requêtes`,
    );
  }
  const erreurs = metriques.http_req_failed;
  if (erreurs && erreurs.values) {
    const taux = erreurs.values.rate;
    lignes.push(
      `  ${taux < TAUX_ERREUR_MAX ? 'ok  ' : 'KO  '} erreurs : ${(taux * 100).toFixed(3)} % (seuil ${TAUX_ERREUR_MAX * 100} %)`,
    );
  }
  return lignes;
}

// Objet `thresholds` de k6. `extra` ajoute des seuils propres au scénario.
export function seuilsK6(extra = {}) {
  const t = {
    http_req_failed: [`rate<${TAUX_ERREUR_MAX}`],
    checks: [`rate>${1 - TAUX_ERREUR_MAX}`],
    // Réponses 429 du frein de débit : le profil a dépassé ce qu'un client a le
    // droit d'écrire. Le run ne mesure plus alors ce qu'il prétend mesurer.
    reponses_429: ['count<1'],
  };
  for (const [categorie, s] of Object.entries(SLA)) {
    const conditions = [`p(95)<${s.p95}`];
    if (s.p99) conditions.push(`p(99)<${s.p99}`);
    t[`http_req_duration{sla:${categorie}}`] = conditions;
  }
  return { ...t, ...extra };
}
