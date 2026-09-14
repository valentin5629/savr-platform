/**
 * Lot « pipeline vivant » du seed_demo — déterminisme, fenêtre et couverture
 * des états. Le générateur est pur : on l'épingle sur une ancre fixe et on
 * vérifie ce que la revue E2E a besoin de trouver en base.
 */

import { describe, it, expect } from 'vitest';
import {
  genererPipelineVivant,
  FIN_MATRICE,
  HORIZON_JOURS,
  type CollecteVivante,
} from './pipeline-vivant.js';
import { decalerJour } from '../temps/index.js';

const ANCRE = '2026-09-14';
const lot = genererPipelineVivant(ANCRE);
const statuts = (s: string): CollecteVivante[] =>
  lot.filter((c) => c.statut === s);

describe('pipeline-vivant — déterminisme', () => {
  it('SEED-PV-1 — deux appels sur la même ancre donnent le même dataset', () => {
    expect(genererPipelineVivant(ANCRE)).toEqual(genererPipelineVivant(ANCRE));
  });

  it('SEED-PV-2 — deux ancres différentes donnent des datasets différents', () => {
    const autre = genererPipelineVivant('2026-09-15');
    expect(autre.map((c) => c.slug)).not.toEqual(lot.map((c) => c.slug));
  });

  it('SEED-PV-3 — les slugs sont uniques', () => {
    expect(new Set(lot.map((c) => c.slug)).size).toBe(lot.length);
  });
});

describe('pipeline-vivant — fenêtre temporelle', () => {
  it('SEED-PV-4 — démarre après la dernière ligne de la matrice figée', () => {
    const min = lot.reduce((a, c) => (c.date < a ? c.date : a), lot[0]!.date);
    expect(min > FIN_MATRICE).toBe(true);
  });

  it("SEED-PV-5 — ne dépasse pas l'horizon de programmation", () => {
    const max = lot.reduce((a, c) => (c.date > a ? c.date : a), lot[0]!.date);
    expect(max <= decalerJour(ANCRE, HORIZON_JOURS)).toBe(true);
  });

  it('SEED-PV-6 — comble le trou jusqu’à aujourd’hui, sans trou > 21 jours', () => {
    const jours = [...new Set(lot.map((c) => c.date))].sort();
    let pire = 0;
    for (let i = 1; i < jours.length; i++) {
      // Écart en jours entre deux dates de collecte consécutives.
      let n = 0;
      let cur = jours[i - 1]!;
      while (cur < jours[i]!) {
        cur = decalerJour(cur, 1);
        n++;
      }
      pire = Math.max(pire, n);
    }
    expect(pire).toBeLessThanOrEqual(21);
  });

  it('SEED-PV-7 — contient du passé récent ET du futur', () => {
    expect(lot.some((c) => c.date < ANCRE)).toBe(true);
    expect(lot.some((c) => c.date > ANCRE)).toBe(true);
  });
});

describe('pipeline-vivant — couverture des états de revue', () => {
  it.each([
    'cloturee',
    'realisee',
    'realisee_sans_collecte',
    'rejetee_par_prestataire',
    'en_cours',
    'programmee',
    'validee',
    'brouillon',
  ])('SEED-PV-8 — au moins une collecte %s', (statut) => {
    expect(statuts(statut).length).toBeGreaterThanOrEqual(1);
  });

  it('SEED-PV-9 — les collectes à venir ne sont jamais réalisées', () => {
    const futures = lot.filter((c) => c.date > ANCRE);
    expect(futures.length).toBeGreaterThan(0);
    for (const c of futures) {
      expect(['programmee', 'validee', 'brouillon']).toContain(c.statut);
    }
  });

  it('SEED-PV-10 — tout ce qui est clôturé est dans le passé', () => {
    for (const c of statuts('cloturee')) expect(c.date < ANCRE).toBe(true);
  });

  it('SEED-PV-11 — une urgence < 48 h non validée alimente le chip Admin', () => {
    const urgentes = lot.filter(
      (c) =>
        c.statut === 'programmee' &&
        c.date > ANCRE &&
        c.date <= decalerJour(ANCRE, 2),
    );
    expect(urgentes.length).toBeGreaterThanOrEqual(1);
  });

  it('SEED-PV-12 — des collectes restent non dispatchées et des AG à attribuer', () => {
    expect(lot.some((c) => c.sansPrestataire)).toBe(true);
    expect(lot.some((c) => c.type === 'anti_gaspi' && c.sansAttribution)).toBe(
      true,
    );
  });

  it('SEED-PV-13 — `realisee_sans_collecte` porte un motif (AG only, §05)', () => {
    for (const c of statuts('realisee_sans_collecte')) {
      expect(c.type).toBe('anti_gaspi');
      expect(c.motifAucunRepas).toBeTruthy();
    }
  });

  it('SEED-PV-14 — le compte Nomad reste vide (fixture « nouveau client »)', () => {
    expect(lot.some((c) => c.traiteur === 'org_tr_nomad')).toBe(false);
  });

  it('SEED-PV-15 — Cirette est le seul traiteur de Rouen, et réciproquement', () => {
    for (const c of lot) {
      if (c.lieu === 'lieu_rouen_normandie')
        expect(c.traiteur).toBe('org_tr_cirette');
      if (c.traiteur === 'org_tr_cirette')
        expect(c.lieu).toBe('lieu_rouen_normandie');
    }
  });

  it('SEED-PV-16 — un gros salon déclenche le multi-camions', () => {
    expect(lot.some((c) => c.camions >= 2)).toBe(true);
    for (const c of lot) {
      if (c.pax > 1500) expect(c.camions).toBeGreaterThanOrEqual(2);
      else expect(c.camions).toBe(1);
    }
  });
});
