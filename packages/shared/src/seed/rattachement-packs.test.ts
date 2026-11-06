/**
 * Rattachement des collectes Anti-Gaspi aux packs du jeu de démo (constat du
 * 2026-11-02 : 61 collectes sur un pack qui comptait 6 crédits utilisés, dont
 * certaines antérieures à son achat).
 */
import { describe, it, expect } from 'vitest';
import {
  rattacherCollectesAuxPacks,
  type CollecteARattacher,
  type PackARattacher,
} from './rattachement-packs.js';

const ORG = 'org-kaspia';
const AUTRE = 'org-caromy';

/** Une collecte par mois, du 15, à partir de 2025-01. */
function collectes(n: number, org = ORG): CollecteARattacher[] {
  return Array.from({ length: n }, (_, i) => {
    const annee = 2025 + Math.floor(i / 12);
    const mois = String((i % 12) + 1).padStart(2, '0');
    return {
      id: `${org}-c${i}`,
      organisationId: org,
      date: `${annee}-${mois}-15`,
    };
  });
}

function pack(
  id: string,
  statut: PackARattacher['statut'],
  dateAchat: string,
  creditsUtilises: number,
  organisationId = ORG,
): PackARattacher {
  return { id, organisationId, statut, dateAchat, creditsUtilises };
}

/** Collectes d'un pack, dans l'ordre des dates. */
function de(r: ReturnType<typeof rattacherCollectesAuxPacks>, packId: string) {
  return [...r.packParCollecte]
    .filter(([, p]) => p === packId)
    .map(([c]) => c)
    .sort((a, b) => Number(a.split('-c')[1]) - Number(b.split('-c')[1]));
}

describe('seed — rattachement des collectes aux packs', () => {
  it('seed_packs_credits_egaux_collectes — chaque pack porte autant de collectes que de crédits utilisés, jamais avant son achat', () => {
    const r = rattacherCollectesAuxPacks(collectes(30), [
      pack('p1', 'epuise', '2025-03-01', 10),
      pack('p2', 'epuise', '2026-01-01', 10),
      pack('actif', 'actif', '2026-01-01', 4),
    ]);
    // Épuisé 1 : les 10 premières collectes après son achat (mars 2025 →).
    expect(de(r, 'p1')).toEqual(
      Array.from({ length: 10 }, (_, i) => `${ORG}-c${i + 2}`),
    );
    // Actif : les 4 plus récentes, et sa date d'achat est celle de la première.
    expect(de(r, 'actif')).toEqual([26, 27, 28, 29].map((i) => `${ORG}-c${i}`));
    expect(r.packs.get('actif')).toEqual({
      creditsUtilises: 4,
      dateAchat: '2027-03-15',
    });
    for (const [id, { creditsUtilises }] of r.packs)
      expect(de(r, id), id).toHaveLength(creditsUtilises);
  });

  it('seed_packs_epuise_borne_par_le_suivant — un épuisé ne déborde pas sur l’achat du pack suivant ; les collectes hors pack restent à l’unité', () => {
    const r = rattacherCollectesAuxPacks(collectes(24), [
      pack('p1', 'epuise', '2025-01-01', 10),
      pack('p2', 'epuise', '2025-06-01', 10),
      pack('actif', 'actif', '2026-01-01', 2),
    ]);
    // p1 n'a que janvier → mai avant l'achat de p2 : 5 collectes, pas 10.
    expect(de(r, 'p1')).toHaveLength(5);
    expect(r.packs.get('p1')!.creditsUtilises).toBe(5);
    expect(de(r, 'p2')).toHaveLength(10);
    // Juin 2025 → … : 10 pour p2, 2 pour l'actif, le reste sans pack.
    expect(r.packParCollecte.size).toBe(17);
  });

  it('seed_packs_organisation_programmatrice — un pack ne prend jamais la collecte d’une autre organisation', () => {
    const r = rattacherCollectesAuxPacks(
      [...collectes(6), ...collectes(6, AUTRE)],
      [pack('actif', 'actif', '2025-01-01', 20)],
    );
    expect(de(r, 'actif')).toHaveLength(6);
    for (const c of de(r, 'actif')) expect(c.startsWith(ORG)).toBe(true);
    expect(r.packs.get('actif')!.creditsUtilises).toBe(6);
  });
});
