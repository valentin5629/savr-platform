// Helper CSV partagé — transverse D (exports tabulaires, §12 §2).
//
// Format canonique Savr (non négociable, §12 §2) :
//   - UTF-8 avec BOM (compat Excel FR)
//   - séparateur « ; »
//   - fin de ligne CRLF
//   - échappement RFC 4180 (champ quoté si ; " \r \n, guillemets internes doublés)
//   - en-têtes en français
//   - dates DD/MM/YYYY HH:MM (Europe/Paris)
//   - poids/nombres en kg avec virgule décimale
//
// Logique PURE (string in / string out) — aucune dépendance Next/Supabase, pour
// rester testable et réutilisable côté serveur. Le wrapper NextResponse vit côté
// `plateforme` (lib/csv.ts).

export const CSV_SEP = ';';
export const CSV_EOL = '\r\n';
export const CSV_BOM = '﻿';

export interface CsvColumn<T> {
  /** En-tête FR affiché en première ligne. */
  header: string;
  /** Extrait la valeur brute de la ligne. Le formatage (date/poids) est fait par l'appelant. */
  value: (row: T) => string | number | null | undefined;
}

/**
 * Neutralise l'injection de formules tableur (CSV injection) : une cellule
 * commençant par = + - @ (ou tab/CR) est interprétée comme formule par
 * Excel/Sheets. On préfixe une apostrophe — SAUF si la valeur est un nombre
 * légitime (les nombres FR utilisent la virgule décimale, ex. « -5,2 »), pour
 * ne pas casser les colonnes numériques (montants négatifs, CO2 net, etc.).
 */
function neutraliserFormule(s: string): string {
  if (!/^[=+\-@\t\r]/.test(s)) return s;
  if (!Number.isNaN(Number(s.replace(',', '.')))) return s; // nombre légitime
  return `'${s}`;
}

/**
 * Échappement RFC 4180 : un champ est quoté seulement s'il contient le
 * séparateur, un guillemet ou un saut de ligne ; les guillemets internes
 * sont doublés. Neutralise au passage l'injection de formules tableur.
 */
export function escapeCsvField(
  input: string | number | null | undefined,
): string {
  if (input == null) return '';
  const raw = String(input);
  if (raw.length === 0) return '';
  const s = neutraliserFormule(raw);
  if (
    s.includes(CSV_SEP) ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r')
  ) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Sérialise des lignes en CSV canonique Savr (avec BOM, en-têtes FR, CRLF).
 * Un fichier sans ligne de données contient quand même l'en-tête.
 */
export function toCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): string {
  const headerLine = columns.map((c) => escapeCsvField(c.header)).join(CSV_SEP);
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCsvField(c.value(row))).join(CSV_SEP),
  );
  return CSV_BOM + [headerLine, ...dataLines].join(CSV_EOL);
}

/**
 * Formate une date/horodatage en DD/MM/YYYY (date pure) ou DD/MM/YYYY HH:MM
 * (horodatage, fuseau Europe/Paris). Renvoie '' si vide, la valeur brute si
 * non parsable (jamais d'exception).
 */
export function formatDateFr(input: string | Date | null | undefined): string {
  if (input == null || input === '') return '';

  // Date pure « YYYY-MM-DD » : pas de composante horaire → pas de décalage TZ.
  if (typeof input === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }

  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);

  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/**
 * Formate un nombre en notation FR (virgule décimale, pas de séparateur de
 * milliers pour rester propre en CSV). Arrondi à `decimals` décimales (2 par
 * défaut), zéros de fin supprimés. Renvoie '' si null/non numérique.
 */
export function formatNombreFr(
  input: number | string | null | undefined,
  decimals = 2,
): string {
  if (input == null || input === '') return '';
  const n = typeof input === 'number' ? input : Number(input);
  if (Number.isNaN(n)) return '';
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return String(rounded).replace('.', ',');
}

/** Poids en kg, virgule décimale (alias sémantique de formatNombreFr). */
export function formatPoidsKg(kg: number | string | null | undefined): string {
  return formatNombreFr(kg, 2);
}

/**
 * Nom de fichier d'export daté : `<prefixe>-savr-YYYYMMDD.csv`.
 * La date doit être fournie par l'appelant (pas de Date.now() implicite ici,
 * pour rester pur et testable).
 */
export function csvFilename(prefixe: string, now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${prefixe}-savr-${y}${m}${d}.csv`;
}
