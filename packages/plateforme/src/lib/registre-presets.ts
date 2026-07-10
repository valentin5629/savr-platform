// BL-P3-10 — Preset « 30 derniers jours » de la barre de filtres du registre
// (CDC §06.03). Renvoie la fenêtre [aujourd'hui − 30 jours ; aujourd'hui] au
// format YYYY-MM-DD attendu par les <input type="date">. Construction en date
// LOCALE (pas toISOString/UTC) pour éviter un décalage de jour près de minuit.
export function preset30JoursRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  return { from: iso(from), to: iso(to) };
}
