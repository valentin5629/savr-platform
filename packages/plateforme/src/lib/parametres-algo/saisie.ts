/**
 * Saisie texte → valeur JSON typée selon `type_valeur`. Lève un message
 * lisible plutôt que d'envoyer une valeur qui casserait l'algo : une liste
 * `text[]` laissée en chaîne devenait un scalaire JSON en base et
 * `fn_calculer_algo_attribution_ag` levait sur toutes les collectes AG
 * (bug 2026-10-02). Le serveur re-valide de son côté.
 */
export function convertirSaisie(type_valeur: string, saisie: string): unknown {
  const brut = saisie.trim();
  if (type_valeur === 'bool') return brut === 'true';
  if (type_valeur === 'int') {
    if (!/^-?\d+$/.test(brut)) throw new Error('Nombre entier attendu.');
    return parseInt(brut, 10);
  }
  if (type_valeur === 'decimal') {
    // Forme stricte : `Number()` seul accepterait 0x10 ou 1e3.
    if (!/^-?\d+([.,]\d+)?$/.test(brut))
      throw new Error('Nombre décimal attendu (ex. 0.45).');
    return Number(brut.replace(',', '.'));
  }
  if (type_valeur === 'time') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(brut))
      throw new Error('Heure au format HH:MM attendue (ex. 07:00).');
    return brut;
  }
  if (type_valeur === 'text[]') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(brut);
    } catch {
      throw new Error('Liste JSON attendue, ex. ["75","92","93"].');
    }
    if (!(Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')))
      throw new Error('Liste de chaînes attendue, ex. ["75","92","93"].');
    return parsed;
  }
  // `string` (seul autre type admis par le CHECK de parametres_algo.type_valeur).
  return brut;
}
