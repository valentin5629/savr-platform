/**
 * Cliquet — les crons à heure fixe visent l'heure MÉTIER (Europe/Paris).
 *
 * Vercel planifie en UTC et n'accepte aucun fuseau. Jusqu'au 2026-09-14 les
 * horaires étaient lus comme s'ils étaient parisiens : le batch J+1, spécifié à
 * 6h (§CDC), tournait en fait à 8h l'été. Les horaires UTC ci-dessous sont
 * choisis pour retomber sur l'heure métier pendant l'heure d'été (UTC+2).
 *
 * Dérive résiduelle assumée : l'hiver (UTC+1) tout tourne 1h PLUS TÔT qu'annoncé.
 * C'est le sens sûr — un document prêt à 5h plutôt qu'à 6h ne gêne personne,
 * l'inverse (8h) oui. Vercel ne permet pas de faire mieux sans un cron horaire
 * filtrant l'heure de Paris dans le code.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const vercel = JSON.parse(
  readFileSync(join(resolve(__dirname, '../..'), 'vercel.json'), 'utf8'),
) as { crons: Array<{ path: string; schedule: string }> };

/** Heure métier attendue à Paris, par cron à heure fixe. */
const HEURE_METIER_PARIS: Record<string, number> = {
  '/api/cron/batch-pdf-j1': 6, // batch J+1 6h (bordereaux, attestations)
  '/api/cron/batch-brouillons-j1': 6, // batch J+1 6h (brouillons de facture)
  '/api/cron/purge-logs': 4,
  '/api/cron/polling-pennylane': 3,
  '/api/cron/refresh-benchmark': 2,
};

/** Heure affichée à Paris pour une heure UTC donnée, un jour d'été. */
function heureAParis(heureUtc: number): number {
  const d = new Date(Date.UTC(2026, 6, 15, heureUtc, 0, 0)); // 15 juillet = UTC+2
  // formatToParts : `format()` en fr-FR renvoie « 06 h », pas « 06 ».
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  return Number(parts.find((p) => p.type === 'hour')?.value);
}

describe('crons Vercel — ancrés sur l’heure de Paris', () => {
  it('garde anti-vacuité : les crons sont lus depuis vercel.json', () => {
    expect(vercel.crons.length).toBeGreaterThanOrEqual(14);
  });

  it.each(Object.entries(HEURE_METIER_PARIS))(
    '%s tourne bien à %sh (Paris, été)',
    (path, heureParis) => {
      const cron = vercel.crons.find((c) => c.path === path);
      expect(cron, `${path} absent de vercel.json`).toBeDefined();
      const [minute, heureUtc] = cron!.schedule.split(' ');
      expect(minute).toBe('0');
      expect(heureAParis(Number(heureUtc))).toBe(heureParis);
    },
  );

  it('tout autre cron à heure fixe doit déclarer son heure métier ici', () => {
    const nonDeclares = vercel.crons
      .filter((c) => /^\d+ \d+ /.test(c.schedule))
      .map((c) => c.path)
      .filter((p) => !(p in HEURE_METIER_PARIS));
    // cloture-embargo tourne toutes les heures (`0 * * * *`) → insensible au fuseau.
    expect(nonDeclares).toEqual([]);
  });
});
