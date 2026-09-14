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

/**
 * Composantes [année, mois 1-12, jour] d'un « YYYY-MM-DD », ou null.
 *
 * La forme ne suffit pas : « 2026-02-30 » la respecte mais n'existe pas au
 * calendrier, et `Date.UTC` la reporte silencieusement au 2 mars — un jour faux
 * se propagerait alors sans erreur dans une fenêtre de filtre ou une date
 * stockée. On rejette donc ce qui ne survit pas à l'aller-retour.
 */
function partiesJour(jour: string): [number, number, number] | null {
  const m = JOUR_SEUL.exec(jour);
  if (!m) return null;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mo - 1, j));
  if (
    d.getUTCFullYear() !== a ||
    d.getUTCMonth() !== mo - 1 ||
    d.getUTCDate() !== j
  )
    return null;
  return [a, mo, j];
}

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
  if (typeof input === 'string' && JOUR_SEUL.test(input)) {
    // Forme date-seule : rendue telle quelle si le jour existe, '' sinon. Ne PAS
    // retomber sur `new Date` ici — V8 y reporte « 2026-02-30 » au 2 mars.
    return partiesJour(input) ? input : '';
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

/**
 * Année civile à Paris (séquences annuelles : numéros de bordereau BSAV et
 * d'attestation de don). `new Date().getFullYear()` rendrait l'année PRÉCÉDENTE
 * le 1er janvier entre minuit et 1h/2h du matin sur un process en UTC.
 */
export function anneeParis(input: Entree = new Date()): number {
  const jour = jourParis(input);
  return jour ? Number(jour.slice(0, 4)) : NaN;
}

/** « JJ/MM/AAAA » à Paris. '' si vide, valeur brute si non parsable. */
export function formatDateParis(input: Entree): string {
  if (input == null || input === '') return '';
  if (typeof input === 'string' && JOUR_SEUL.test(input)) {
    const p = partiesJour(input);
    // Jour inexistant → valeur brute, jamais le report de `new Date` au mois suivant.
    return p
      ? `${input.slice(8)}/${input.slice(5, 7)}/${input.slice(0, 4)}`
      : input;
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

/** Décalage d'Europe/Paris par rapport à UTC, en ms, à l'instant `d` (DST inclus). */
function decalageParis(d: Date): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSEAU_SAVR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const v = (t: string): number => Number(p.find((x) => x.type === t)?.value);
  const heure = v('hour') === 24 ? 0 : v('hour'); // en-US rend parfois « 24 » à minuit
  const commeUtc = Date.UTC(
    v('year'),
    v('month') - 1,
    v('day'),
    heure,
    v('minute'),
    v('second'),
  );
  // `formatToParts` s'arrête à la seconde : comparer `commeUtc` à l'instant BRUT
  // amputerait l'offset de la partie fractionnaire de `d` (et instantParis, qui
  // applique deux fois le résultat, dériverait du double). On compare donc à la
  // même seconde, millisecondes remises à zéro des deux côtés.
  return commeUtc - (d.getTime() - d.getUTCMilliseconds());
}

/**
 * Instant réel correspondant à une heure MURALE parisienne — `instantParis(
 * '2026-07-14', '23:30')` = le 14/07 à 23h30 à Paris, où que tourne le code.
 *
 * Remplace `new Date(\`${jour}T${heure}\`)`, qui interprète l'heure dans le fuseau
 * du process : sur Vercel (UTC) le créneau d'une collecte était décalé de 1 à 2h,
 * donc le seuil « moins de 12h avant la collecte » ne tombait pas au même moment
 * côté API et côté SQL (trigger de débit du pack AG, ancré Europe/Paris).
 *
 * L'heure accepte « HH:MM » ou « HH:MM:SS ». Entrée invalide → date invalide.
 */
export function instantParis(jour: string, heure = '00:00'): Date {
  const hms = heure.length === 5 ? `${heure}:00` : heure;
  // Le `Z` force la lecture en UTC (pas le fuseau du process) ; l'instant est
  // ensuite recalé sur Paris ci-dessous.
  // eslint-disable-next-line no-restricted-syntax -- cf. ci-dessus
  const naif = new Date(`${jour}T${hms}Z`);
  if (Number.isNaN(naif.getTime())) return naif;
  const premier = new Date(naif.getTime() - decalageParis(naif));
  const decale = decalageParis(premier);
  // Près d'une bascule DST, le décalage de l'instant visé diffère de l'estimation.
  return decale === decalageParis(naif)
    ? premier
    : new Date(naif.getTime() - decale);
}

// ── Calendrier pur : arithmétique sur des jours « YYYY-MM-DD » ────────────────
// Une valeur date-seule n'est PAS un instant. La convertir en Date pour ajouter
// des jours ou lire un jour de semaine fait entrer le fuseau du process dans un
// calcul qui n'en a pas besoin — et `getDay()` d'un minuit parisien rend le jour
// PRÉCÉDENT sur une machine en UTC. Ces helpers ne construisent aucun instant.

/** Décale un jour « YYYY-MM-DD » de `jours` (négatif = passé). '' si invalide. */
export function decalerJour(jour: string, jours: number): string {
  const p = partiesJour(jour);
  // `jours` non fini donnerait un instant invalide, dont `toISOString` LÈVE une
  // RangeError — le contrat de ce module est de rendre '' sur entrée invalide,
  // jamais de faire tomber l'appelant.
  if (!p || !Number.isFinite(jours)) return '';
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + jours * 86_400_000);
  // Décalage assez grand pour sortir de la plage représentable (± ~273 000 ans).
  if (Number.isNaN(d.getTime())) return '';
  // Calendrier pur : construit en UTC et relu en UTC, aucun fuseau n'intervient.
  // eslint-disable-next-line no-restricted-syntax -- cf. ci-dessus
  return d.toISOString().slice(0, 10);
}

/** Jour de la semaine d'un jour « YYYY-MM-DD » : 0 = lundi … 6 = dimanche. */
export function jourDeSemaine(jour: string): number {
  const p = partiesJour(jour);
  if (!p) return -1;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return (d + 6) % 7;
}

/** Lundi de la semaine contenant ce jour « YYYY-MM-DD ». Le jour même si invalide. */
export function lundiDeLaSemaine(jour: string): string {
  const n = jourDeSemaine(jour);
  return n < 0 ? jour : decalerJour(jour, -n);
}

/** 1er jour du mois d'un jour « YYYY-MM-DD ». Le jour même si invalide. */
export function premierDuMois(jour: string): string {
  const p = partiesJour(jour);
  return p ? `${jour.slice(0, 7)}-01` : jour;
}

/**
 * Formate un jour « YYYY-MM-DD » avec les options d'`Intl` voulues (ex. `{ day:
 * '2-digit', month: 'short' }` → « 14 juil. »).
 *
 * Seul endroit du code où un jour est transformé en instant : on l'ancre à midi
 * UTC et on formate EN UTC. Les deux bouts sont dans le même fuseau, donc aucun
 * décalage n'est possible — ni ici, ni selon la machine ou le navigateur. C'est
 * la raison d'être de cette fonction : que personne n'ait à refaire ce montage
 * (et à se tromper) dans un écran.
 */
export function formatJour(
  jour: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const p = partiesJour(jour);
  if (!p) return jour;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
  // Jour ancré à midi UTC et rendu en UTC : paire cohérente, insensible au
  // fuseau de la machine (cf. docstring) — seul endroit du code où c'est le cas.
  return new Intl.DateTimeFormat('fr-FR', {
    // eslint-disable-next-line no-restricted-syntax -- cf. ci-dessus
    timeZone: 'UTC',
    ...options,
  }).format(d);
}
