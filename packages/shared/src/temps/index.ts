/**
 * Fuseau métier unique de Savr (§16 — activité IDF).
 *
 * Tout calcul de « jour » et tout affichage de date/heure côté serveur DOIT passer
 * par ce module. Sinon le résultat dépend du fuseau du process : UTC sur Vercel,
 * sur Railway et en CI, Europe/Paris sur un poste de dev — d'où des bugs qui ne se
 * reproduisent jamais en local. `new Date().toISOString().slice(0, 10)` est le
 * piège principal : il renvoie le jour UTC, donc la VEILLE entre 22h et minuit
 * l'été (23h et minuit l'hiver).
 *
 * Ces helpers sont explicites : ils donnent le même résultat quel que soit le
 * fuseau de la machine, sans dépendre d'une variable d'environnement TZ.
 * Gate : règles `no-restricted-syntax` dans eslint.config.js.
 */
export const FUSEAU_SAVR = 'Europe/Paris';

type Entree = Date | string | number | null | undefined;

/** « YYYY-MM-DD » sans composante horaire → aucun décalage de fuseau possible. */
const JOUR_SEUL = /^(\d{4})-(\d{2})-(\d{2})$/;

function versDate(input: Entree): Date | null {
  if (input == null || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parties(
  d: Date,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: FUSEAU_SAVR,
    ...options,
  }).formatToParts(d);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/**
 * Jour calendaire à Paris, au format « YYYY-MM-DD » (celui des colonnes DATE et
 * des filtres PostgREST). Remplace `toISOString().slice(0, 10)`.
 *
 * Sans argument : aujourd'hui à Paris. Une chaîne « YYYY-MM-DD » est rendue telle
 * quelle (déjà un jour, pas un instant). Une entrée invalide renvoie ''.
 */
export function jourParis(input: Entree = new Date()): string {
  if (typeof input === 'string') {
    const jour = JOUR_SEUL.exec(input);
    if (jour) return input;
  }
  const d = versDate(input);
  if (!d) return '';
  const p = parties(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p['year']}-${p['month']}-${p['day']}`;
}

/** Jour à Paris décalé de `jours` (négatif = passé), format « YYYY-MM-DD ». */
export function jourParisDecale(
  jours: number,
  depuis: Entree = new Date(),
): string {
  const d = versDate(depuis);
  if (!d) return '';
  return jourParis(new Date(d.getTime() + jours * 86_400_000));
}

/** « JJ/MM/AAAA » à Paris. '' si vide, valeur brute si non parsable. */
export function formatDateParis(input: Entree): string {
  if (input == null || input === '') return '';
  if (typeof input === 'string') {
    const jour = JOUR_SEUL.exec(input);
    if (jour) return `${jour[3]}/${jour[2]}/${jour[1]}`;
  }
  const d = versDate(input);
  if (!d) return String(input);
  const p = parties(d, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p['day']}/${p['month']}/${p['year']}`;
}

/** « HH:MM » à Paris. '' si vide, valeur brute si non parsable. */
export function formatHeureParis(input: Entree): string {
  if (input == null || input === '') return '';
  const d = versDate(input);
  if (!d) return String(input);
  const p = parties(d, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${p['hour']}:${p['minute']}`;
}

/** « JJ/MM/AAAA HH:MM » à Paris. '' si vide, valeur brute si non parsable. */
export function formatDateHeureParis(input: Entree): string {
  if (input == null || input === '') return '';
  const d = versDate(input);
  if (!d) return String(input);
  return `${formatDateParis(d)} ${formatHeureParis(d)}`;
}
