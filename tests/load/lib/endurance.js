// Calculs du scénario 4 (endurance). Module pur, testé par Vitest.
//
// Critère du CDC : « pas de dégradation progressive des p95 (delta < 20 %
// entre h+1 et h+24) ». Chaque requête porte un tag `tranche` ; le résumé
// compare, par catégorie de SLA, le p95 de la 2e heure à celui de la dernière.
// Pour un run raccourci (DUREE=2h), les tranches suivent la même proportion :
// 2e vingt-quatrième contre dernier vingt-quatrième de la durée.

export const DEGRADATION_MAX = 0.2;

export function tranche(ecouleMs, dureeMs) {
  const part = dureeMs / 24;
  if (ecouleMs >= part && ecouleMs < 2 * part) return 'premiere_heure';
  if (ecouleMs >= 23 * part) return 'derniere_heure';
  return 'milieu';
}

// Seuils neutres (toujours vrais) : ils ne jugent rien, ils obligent k6 à
// garder ces sous-métriques dans le résumé, où `verdictDegradation` les lit.
export function seuilsTranches(categories) {
  const t = {};
  for (const c of categories) {
    for (const tr of ['premiere_heure', 'derniere_heure']) {
      t[`http_req_duration{sla:${c},tranche:${tr}}`] = ['p(95)>=0'];
    }
  }
  return t;
}

// `metriques` = `data.metrics` de handleSummary. Rend une ligne par catégorie
// mesurée dans les deux tranches, et `ok` global.
export function verdictDegradation(metriques, categories) {
  const lignes = [];
  for (const c of categories) {
    const p95 = (tr) => {
      const m = metriques[`http_req_duration{sla:${c},tranche:${tr}}`];
      return m && m.values && m.values.count > 0 ? m.values['p(95)'] : null;
    };
    const debut = p95('premiere_heure');
    const fin = p95('derniere_heure');
    if (debut === null || fin === null || debut === 0) continue;
    const delta = (fin - debut) / debut;
    lignes.push({
      categorie: c,
      debut,
      fin,
      delta,
      ok: delta < DEGRADATION_MAX,
    });
  }
  return { ok: lignes.length > 0 && lignes.every((l) => l.ok), lignes };
}
