/**
 * Pax porté par la collecte (décision Val 2026-10-20) — listes de collectes.
 *
 * Le pax de l'événement est désormais la somme des jours (règle du jour) : une ligne
 * de collecte qui l'affiche montrerait 1 400 pour une soirée à 700. Chaque route
 * de liste demande donc le pax sur la collecte, jamais dans l'embed de
 * l'événement. Les mocks PostgREST ne filtrent pas les colonnes : seul le texte
 * du select le prouve.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const ROUTES = [
  'admin',
  'traiteur',
  'agence',
  'gestionnaire',
  'organisateur',
] as const;

/** Colonnes de la collecte et contenu de l'embed `evenements!inner(…)`. */
function selectDeLaListe(espace: (typeof ROUTES)[number]): {
  collecte: string;
  evenement: string;
} {
  const source = readFileSync(
    new URL(
      `../../src/app/api/v1/${espace}/collectes/route.ts`,
      import.meta.url,
    ),
    'utf8',
  );
  const embed = 'evenements!inner(';
  const debutEmbed = source.indexOf(embed);
  expect(debutEmbed, `${espace} : embed ${embed} introuvable`).toBeGreaterThan(
    0,
  );
  expect(
    source.indexOf(embed, debutEmbed + 1),
    `${espace} : embed en double`,
  ).toBe(-1);
  const debutSelect = source.lastIndexOf('`', debutEmbed);
  // Parenthèse fermante de l'embed (les embeds imbriqués en ouvrent d'autres).
  let profondeur = 1;
  let fin = debutEmbed + embed.length;
  for (; fin < source.length && profondeur > 0; fin++) {
    if (source[fin] === '(') profondeur++;
    else if (source[fin] === ')') profondeur--;
  }
  return {
    collecte: source.slice(debutSelect, debutEmbed),
    evenement: source.slice(debutEmbed + embed.length, fin - 1),
  };
}

describe('M1.2/pax_par_collecte — listes de collectes : le pax de la collecte, jamais celui de l’événement', () => {
  it.each(ROUTES)(
    'liste %s : pax demandé sur la collecte, absent de l’embed de l’événement',
    (espace) => {
      const { collecte, evenement } = selectDeLaListe(espace);
      expect(collecte).toMatch(/\bpax\b/);
      expect(evenement).not.toMatch(/\bpax\b/);
    },
  );
});
