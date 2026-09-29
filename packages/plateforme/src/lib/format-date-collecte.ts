import { instantParis } from '@savr/shared/src/temps/index.js';

// Formatage date + créneau des listes Collectes (toutes les Data Tables).

// Créneau non renseigné (null ou chaîne vide) → minuit. Même garde que
// estAnnulationTardive (lib/notifications/traiteur-operationnel) : `?? '00:00:00'`
// laissait passer la chaîne vide, et instantParis('2026-07-08', '') rend une date
// invalide — la collecte n'aurait alors jamais été urgente.
export function heureOuMinuit(heure: string | null | undefined): string {
  return heure && heure.length ? heure : '00:00:00';
}

// Format CDC §06.06 §3 : "Dim 06 juil · 21h30".
export function formatDateHeure(
  date: string,
  heure: string | null,
): {
  jour: string;
  heure: string;
} {
  const d = instantParis(date, heureOuMinuit(heure));
  const jour = d
    .toLocaleDateString('fr-FR', {
      timeZone: 'Europe/Paris',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    })
    .replace(/\./g, '')
    // Majuscule en tête de MOT (après début ou espace) : `\b` est ASCII et
    // voyait une frontière autour du « û » d'« août » → « AoÛT ».
    .replace(
      /(^|\s)(\p{L})/gu,
      (_, sep: string, c: string) => sep + c.toUpperCase(),
    );
  const h = (heure ?? '').slice(0, 5).replace(':', 'h');
  return { jour, heure: h };
}

// Libellé d'une ligne de liste : "Dim 06 juil · 21h30" (créneau omis si vide).
export function libelleDateHeure(date: string, heure: string | null): string {
  const f = formatDateHeure(date, heure);
  return f.heure ? `${f.jour} · ${f.heure}` : f.jour;
}
