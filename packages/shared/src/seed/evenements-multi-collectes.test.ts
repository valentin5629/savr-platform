/**
 * Événements multi-collectes de seed_demo — chaque événement porte plusieurs
 * collectes terminées, et chaque cas du bilan consolidé de la page Événements
 * (`packages/plateforme/src/lib/evenements-gestionnaire.ts`) y est représenté.
 *
 * Deux niveaux : le générateur (pur), puis les lignes que `seedDemo` écrit
 * réellement, lues sur un client pg factice (cf. attestations-attribution.test).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { seedDemo } from './demo.js';
import { seedUuid } from './uuid.js';
import { genererEvenementsMultiCollectes } from './evenements-multi-collectes.js';
import { decalerJour } from '../temps/index.js';

// Ancre où l'index des alertes de pesée (cf. SEED-EMC-10) tomberait sur un
// événement multi-collectes si elles n'en étaient pas exclues (mesuré).
const ANCRE = '2026-10-25';
const { evenements, collectes } = genererEvenementsMultiCollectes(ANCRE);
const de = (slug: string) => collectes.filter((c) => c.evenement === slug);
const REALISEES = new Set(['cloturee', 'realisee_sans_collecte']);

describe('événements multi-collectes — générateur', () => {
  it('SEED-EMC-1 — même ancre, même jeu ; slugs uniques', () => {
    expect(genererEvenementsMultiCollectes(ANCRE)).toEqual({
      evenements,
      collectes,
    });
    expect(new Set(evenements.map((e) => e.slug)).size).toBe(evenements.length);
    expect(new Set(collectes.map((c) => c.slug)).size).toBe(collectes.length);
  });

  it('SEED-EMC-2 — chaque événement porte au moins 2 collectes, toutes terminées, dont au moins une réalisée (« Terminé »)', () => {
    for (const e of evenements) {
      const siennes = de(e.slug);
      expect(siennes.length, e.slug).toBeGreaterThanOrEqual(2);
      for (const c of siennes)
        expect([...REALISEES, 'annulee'], c.slug).toContain(c.statut);
      expect(
        siennes.some((c) => c.statut === 'cloturee'),
        e.slug,
      ).toBe(true);
    }
  });

  it('SEED-EMC-3 — toutes passées d’au moins 8 jours : clôturées comme l’historique comblé', () => {
    for (const c of collectes)
      expect(c.date <= decalerJour(ANCRE, -8), c.slug).toBe(true);
  });

  it('SEED-EMC-4 — la date de l’événement est celle de sa première collecte non annulée (fn_set_date_evenement)', () => {
    for (const e of evenements) {
      const dates = de(e.slug)
        .filter((c) => c.statut !== 'annulee')
        .map((c) => c.date)
        .sort();
      expect(e.date, e.slug).toBe(dates[0]);
    }
  });

  it('SEED-EMC-5 — les collectes héritent du traiteur et du lieu de leur événement', () => {
    for (const e of evenements)
      for (const c of de(e.slug)) {
        expect(c.traiteur, c.slug).toBe(e.traiteur);
        expect(c.lieu, c.slug).toBe(e.lieu);
        // Une AG prend le pax de l'événement (fn_set_volume_estime_repas).
        if (c.type === 'anti_gaspi') expect(c.pax, c.slug).toBe(e.pax);
      }
  });

  it('SEED-EMC-6 — chaque cas du bilan consolidé est couvert', () => {
    const cas = evenements.map((e) => {
      const s = de(e.slug);
      const zd = s.filter((c) => c.type === 'zero_dechet');
      const ag = s.filter((c) => c.type === 'anti_gaspi');
      const assos = ag
        .filter((c) => c.statut === 'cloturee')
        .map((c) => c.association);
      return {
        e,
        zd: zd.length,
        ag: ag.length,
        jours: new Set(s.map((c) => c.date)).size,
        assoRepetee: assos.length > new Set(assos).size,
        assosDistinctes: new Set(assos).size,
        sansExcedent: s.some((c) => c.statut === 'realisee_sans_collecte'),
        annulee: s.some((c) => c.statut === 'annulee'),
      };
    });
    // ZD et AG mêlées, plusieurs de chaque.
    expect(cas.some((c) => c.zd >= 2 && c.ag >= 2)).toBe(true);
    // ZD seul, AG seul (onglets Zéro Déchet / Anti-Gaspi).
    expect(cas.some((c) => c.zd >= 2 && c.ag === 0)).toBe(true);
    expect(cas.some((c) => c.ag >= 2 && c.zd === 0)).toBe(true);
    // Sur plusieurs jours (première / dernière collecte).
    expect(cas.some((c) => c.jours >= 3)).toBe(true);
    // Une association servie deux fois → une ligne, repas additionnés.
    expect(cas.some((c) => c.assoRepetee)).toBe(true);
    // Plusieurs associations distinctes.
    expect(cas.some((c) => c.assosDistinctes >= 3)).toBe(true);
    // AG sans excédent et collecte annulée.
    expect(cas.some((c) => c.sansExcedent)).toBe(true);
    expect(cas.some((c) => c.annulee)).toBe(true);
    // Programmé par une agence ; sans client organisateur.
    expect(cas.some((c) => c.e.parAgence)).toBe(true);
    expect(cas.some((c) => c.e.client === null)).toBe(true);
  });

  it('SEED-EMC-6b — les ZD réalisées d’un même événement n’ont pas le même pax (taux pondéré ≠ moyenne simple)', () => {
    for (const e of evenements) {
      const pax = de(e.slug)
        .filter((c) => c.type === 'zero_dechet' && c.statut === 'cloturee')
        .map((c) => c.pax);
      expect(new Set(pax).size, e.slug).toBe(pax.length);
    }
  });

  it('SEED-EMC-7 — une AG porte son association et ses repas ; une AG sans excédent a 0 repas et un motif', () => {
    for (const c of collectes.filter((x) => x.type === 'anti_gaspi')) {
      expect(c.association, c.slug).toMatch(/^asso_/);
      if (c.statut === 'realisee_sans_collecte') {
        expect(c.repas, c.slug).toBe(0);
        expect(c.motifAucunRepas, c.slug).toBeTruthy();
      } else expect(c.repas, c.slug).toBeGreaterThan(0);
    }
  });
});

// ── Ce que seedDemo écrit en base ───────────────────────────────────────────
type Ligne = Record<string, unknown>;
const TABLES = [
  'plateforme.evenements',
  'plateforme.collectes',
  'plateforme.collecte_flux',
  'plateforme.attributions_antgaspi',
  'plateforme.attestations_don',
];

/** Lignes que `seedDemo` écrirait à cette ancre, lues sur un client factice. */
async function ecrireSeedDemo(ancre: string): Promise<Map<string, Ligne[]>> {
  const ecrites = new Map<string, Ligne[]>(TABLES.map((t) => [t, []]));
  vi.stubEnv('SEED_TODAY', ancre);
  const referentiel: [RegExp, Record<string, string>[]][] = [
    [/grilles_tarifaires_zd/, [{ id: 'grille', nom: 'Grille standard V1' }]],
    [
      /from plateforme\.flux_dechets/,
      ['biodechet', 'carton', 'emballage', 'verre', 'dechet_residuel'].map(
        (code) => ({ code, id: `flux_${code}` }),
      ),
    ],
    [
      /from plateforme\.types_evenements/,
      [
        { code: 'cocktail_repas_complet', id: 'type_zd' },
        { code: 'repas_assis', id: 'type_ag' },
      ],
    ],
  ];
  // Arrêt dès les attestations écrites : la suite (tournées, factures…) est
  // hors sujet et lit d'autres référentiels.
  class AttestationsEcrites extends Error {}
  const client = {
    query: (sql: string, params: unknown[] = []) => {
      const insert =
        /^INSERT INTO (\S+) \(([^)]+)\) VALUES (.+) ON CONFLICT/.exec(sql);
      const cible = insert ? ecrites.get(insert[1]!) : undefined;
      if (cible) {
        const colonnes = insert![2]!.split(', ');
        // Valeur lue par son numéro de paramètre (`$12`), pas par position.
        for (const [, ligne] of insert![3]!.matchAll(/\(([^)]*)\)/g)) {
          const valeurs = ligne!.split(', ').map((valeur) => {
            const numero = /^\$(\d+)/.exec(valeur)?.[1];
            return numero ? params[Number(numero) - 1] : undefined;
          });
          cible.push(
            Object.fromEntries(colonnes.map((c, k) => [c, valeurs[k]])),
          );
        }
      } else if (ecrites.get('plateforme.attestations_don')!.length > 0) {
        return Promise.reject(new AttestationsEcrites());
      }
      const rows = referentiel.find(([re]) => re.test(sql))?.[1] ?? [];
      return Promise.resolve({ rows });
    },
  };
  await expect(seedDemo(client as unknown as pg.Client)).rejects.toBeInstanceOf(
    AttestationsEcrites,
  );
  return ecrites;
}

let ecrites = new Map<string, Ligne[]>();
const lignes = (t: string) => ecrites.get(`plateforme.${t}`)!;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  ecrites = await ecrireSeedDemo(ANCRE);
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('événements multi-collectes — ce que seed_demo écrit en base', () => {
  it('SEED-EMC-8 — chaque événement est écrit une seule fois, avec son nom, son pax et sa date', () => {
    const ids = lignes('evenements').map((e) => e['id']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of evenements) {
      const ecrit = lignes('evenements').filter(
        (l) => l['id'] === seedUuid('ev_' + e.slug),
      );
      expect(ecrit, e.slug).toHaveLength(1);
      expect(ecrit[0]!['nom_evenement']).toBe(e.nom);
      expect(ecrit[0]!['pax']).toBe(e.pax);
      expect(ecrit[0]!['date_evenement']).toBe(e.date);
      expect(ecrit[0]!['organisation_id']).toBe(
        seedUuid(e.parAgence ? 'org_ag_caromy' : e.traiteur),
      );
    }
  });

  it('SEED-EMC-9 — leurs collectes sont rattachées à l’événement, avec leur statut', () => {
    for (const c of collectes) {
      const ecrite = lignes('collectes').find(
        (l) => l['id'] === seedUuid(c.slug),
      );
      expect(ecrite, c.slug).toBeDefined();
      expect(ecrite!['evenement_id'], c.slug).toBe(
        seedUuid('ev_' + c.evenement),
      );
      expect(ecrite!['statut'], c.slug).toBe(c.statut);
      if (c.type === 'anti_gaspi')
        expect(ecrite!['volume_estime_repas'], c.slug).toBe(
          Math.round(0.1 * evenements.find((e) => e.slug === c.evenement)!.pax),
        );
    }
  });

  it('SEED-EMC-10 — chaque ZD réalisée a ses pesées, sans alerte injectée ; une ZD annulée n’en a aucune', () => {
    const fluxDe = (slug: string) =>
      lignes('collecte_flux').filter(
        (f) => f['collecte_id'] === seedUuid(slug),
      );
    for (const c of collectes.filter((x) => x.type === 'zero_dechet')) {
      if (c.statut === 'cloturee') {
        expect(fluxDe(c.slug), c.slug).toHaveLength(5);
        // Ni le verre MIN (1,5 kg) ni le résiduel MAX (5 300 kg) du seed.
        for (const f of fluxDe(c.slug))
          expect([1.5, 5300], c.slug).not.toContain(f['poids_reel_kg']);
      } else expect(fluxDe(c.slug), c.slug).toHaveLength(0);
    }
  });

  it('SEED-EMC-10b — à l’ancre où l’alerte verre MIN tomberait sur un événement multi-collectes, elle n’y tombe pas', async () => {
    // Mesuré : au 2026-11-02, l'index de l'alerte verre (1,5 kg) désignerait
    // une collecte ZD du Gala Fondation Horizon.
    const flux = (await ecrireSeedDemo('2026-11-02')).get(
      'plateforme.collecte_flux',
    )!;
    const multi = new Set(collectes.map((c) => seedUuid(c.slug)));
    const pesees = flux.filter((f) => multi.has(f['collecte_id'] as string));
    expect(pesees.length).toBeGreaterThan(0);
    for (const f of pesees)
      expect([1.5, 5300]).not.toContain(f['poids_reel_kg']);
  });

  it('SEED-EMC-11 — chaque AG clôturée a l’attribution et l’attestation définies (association, repas)', () => {
    for (const c of collectes.filter(
      (x) => x.type === 'anti_gaspi' && x.statut === 'cloturee',
    )) {
      const id = seedUuid(c.slug);
      const attribution = lignes('attributions_antgaspi').find(
        (a) => a['collecte_id'] === id,
      );
      const attestation = lignes('attestations_don').find(
        (a) => a['collecte_id'] === id,
      );
      expect(attribution?.['association_id'], c.slug).toBe(
        seedUuid(c.association!),
      );
      expect(attribution?.['volume_repas_realise'], c.slug).toBe(c.repas);
      expect(attestation?.['nb_repas'], c.slug).toBe(c.repas);
    }
  });

  it('SEED-EMC-12 — une AG sans excédent porte motif et photo, ni pack ni attestation', () => {
    const sansExcedent = collectes.filter(
      (x) => x.statut === 'realisee_sans_collecte',
    );
    expect(sansExcedent.length).toBeGreaterThan(0);
    for (const c of sansExcedent) {
      const ecrite = lignes('collectes').find(
        (l) => l['id'] === seedUuid(c.slug),
      )!;
      expect(ecrite['aucun_repas_motif'], c.slug).toBe(c.motifAucunRepas);
      expect(ecrite['aucun_repas_photo_url'], c.slug).toBeTruthy();
      expect(ecrite['pack_antgaspi_id'], c.slug).toBeNull();
      expect(
        lignes('attestations_don').some(
          (a) => a['collecte_id'] === seedUuid(c.slug),
        ),
        c.slug,
      ).toBe(false);
    }
  });
});
