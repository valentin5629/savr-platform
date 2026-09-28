import { formatJour } from '@savr/shared/src/temps/index.js';

// Conversions jour ISO `YYYY-MM-DD` ⇄ `Date` LOCALE (minuit local), pour les
// sélecteurs de date du DS (react-day-picker manipule des `Date`, l'app et les
// routes des chaînes ISO). Jamais `new Date('YYYY-MM-DD')` : il lit l'UTC et
// décale d'un jour à l'ouest de Greenwich.

export function isoVersDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function dateVersIso(d: Date | null | undefined): string {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** « 23 septembre 2026 ». */
export function formatJourLong(d: Date): string {
  return formatJour(dateVersIso(d), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** « 23 sept. 2026 ». */
export function formatJourCourt(d: Date): string {
  return formatJour(dateVersIso(d), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
