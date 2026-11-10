/**
 * Catalogue de cas du seed_demo : chaque cas de figure à tester est bien posé
 * (demande Val 2026-11-02), et le lot reste cohérent avec les règles du seed.
 */
import { describe, expect, it } from 'vitest';
import { instantParis } from '../temps/index.js';
import { genererCatalogueCas, LIEUX_PROVINCE } from './catalogue-cas.js';

const ANCRE = '2026-11-02';
const lot = genererCatalogueCas(ANCRE);

describe('catalogue-cas — forme', () => {
  it('SEED-CAS-1 — déterministe et slugs uniques', () => {
    expect(genererCatalogueCas(ANCRE)).toEqual(lot);
    expect(new Set(lot.map((c) => c.slug)).size).toBe(lot.length);
  });

  it('SEED-CAS-2 — chaque événement est nommé « Cas — … », sans doublon', () => {
    for (const c of lot) expect(c.nomEvenement).toMatch(/^Cas — /);
    expect(new Set(lot.map((c) => c.nomEvenement)).size).toBe(lot.length);
  });

  it('SEED-CAS-3 — le compte Nomad reste vide', () => {
    expect(lot.some((c) => c.traiteur === 'org_tr_nomad')).toBe(false);
  });

  it('SEED-CAS-4 — aucune collecte servie par A Toute! (Everest)', () => {
    expect(JSON.stringify(lot)).not.toContain('a_toutes');
  });
});

describe('catalogue-cas — couverture', () => {
  it.each([
    'brouillon',
    'programmee',
    'validee',
    'en_cours',
    'realisee',
    'realisee_sans_collecte',
    'cloturee',
    'annulation_demandee',
    'annulee',
    'rejetee_par_prestataire',
  ])('SEED-CAS-5 — statut %s', (statut) => {
    expect(lot.some((c) => c.statut === statut)).toBe(true);
  });

  it.each([
    'non_envoye',
    'attribuee_en_attente_acceptation',
    'acceptee',
    'en_attente_execution',
    'rejetee_par_prestataire',
    'annulee_par_traiteur',
  ])('SEED-CAS-6 — statut TMS %s', (statutTms) => {
    expect(lot.some((c) => c.statutTms === statutTms)).toBe(true);
  });

  it('SEED-CAS-7 — ZD et AG, à venir et passées, dans chaque type', () => {
    for (const type of ['zero_dechet', 'anti_gaspi']) {
      const duType = lot.filter((c) => c.type === type);
      expect(duType.some((c) => c.date > ANCRE)).toBe(true);
      expect(duType.some((c) => c.date < ANCRE)).toBe(true);
    }
  });

  it('SEED-CAS-8 — créneaux du petit matin au milieu de la nuit', () => {
    const heures = lot.map((c) => c.heure);
    expect(heures.some((h) => h < '07:00')).toBe(true);
    expect(heures.some((h) => h >= '11:00' && h < '15:00')).toBe(true);
    expect(heures.some((h) => h >= '23:00')).toBe(true);
    expect(heures.some((h) => h < '02:00')).toBe(true);
    expect(new Set(heures).size).toBeGreaterThanOrEqual(15);
  });

  it('SEED-CAS-9 — province hors Rouen, ZD et AG', () => {
    const province = lot.filter((c) => LIEUX_PROVINCE.has(c.lieu));
    expect(new Set(province.map((c) => c.lieu)).size).toBeGreaterThanOrEqual(5);
    expect(province.some((c) => c.type === 'zero_dechet')).toBe(true);
    expect(province.some((c) => c.type === 'anti_gaspi')).toBe(true);
  });

  it('SEED-CAS-10 — pax : très petit, seuils 600 et 1 500, très gros multi-camions', () => {
    const pax = lot.map((c) => c.pax);
    expect(Math.min(...pax)).toBeLessThan(20);
    for (const seuil of [600, 601, 1499, 1500]) expect(pax).toContain(seuil);
    expect(Math.max(...pax)).toBeGreaterThanOrEqual(10000);
    expect(lot.some((c) => c.camions >= 3)).toBe(true);
    for (const c of lot) expect(c.pax).toBeLessThanOrEqual(100000);
  });

  it('SEED-CAS-11 — files Admin : modifiées sans renvoi, infos incomplètes, contrôle d’accès, agence', () => {
    expect(lot.some((c) => c.dirtyTms && c.statut === 'validee')).toBe(true);
    expect(lot.some((c) => c.dirtyTms && c.statut === 'en_cours')).toBe(true);
    expect(lot.some((c) => !c.informationsCompletes)).toBe(true);
    expect(lot.some((c) => c.controleAcces && !c.infosAccesEnvoyeesAt)).toBe(
      true,
    );
    expect(lot.some((c) => c.controleAcces && c.infosAccesEnvoyeesAt)).toBe(
      true,
    );
    expect(lot.filter((c) => c.parAgence).length).toBeGreaterThanOrEqual(2);
  });

  it('SEED-CAS-12 — urgences du jour et du lendemain non validées', () => {
    const urgentes = lot.filter(
      (c) =>
        c.statut === 'programmee' &&
        (c.date === ANCRE || c.date === '2026-11-03'),
    );
    expect(urgentes.some((c) => c.type === 'zero_dechet')).toBe(true);
    expect(urgentes.some((c) => c.type === 'anti_gaspi')).toBe(true);
  });

  it('SEED-CAS-13 — annulation demandée tardive (< 4 h) et à temps', () => {
    const delaiHeures = (c: (typeof lot)[number]) =>
      (instantParis(c.date, c.heure).getTime() -
        new Date(c.annulationDemandeeAt!).getTime()) /
      3_600_000;
    const demandees = lot.filter((c) => c.statut === 'annulation_demandee');
    expect(demandees.some((c) => delaiHeures(c) < 4)).toBe(true);
    expect(demandees.some((c) => delaiHeures(c) >= 4)).toBe(true);
    expect(lot.some((c) => c.annuleeCoteSavrMotif)).toBe(true);
  });
});

describe('catalogue-cas — cohérence', () => {
  it('SEED-CAS-14 — une collecte sans prestataire n’est pas acceptée par le TMS', () => {
    for (const c of lot.filter((x) => x.sansPrestataire)) {
      expect(['non_envoye', 'rejetee_par_prestataire']).toContain(c.statutTms);
    }
  });

  it('SEED-CAS-15 — seules les AG portent association, repas ou motif sans excédent', () => {
    for (const c of lot.filter((x) => x.type === 'zero_dechet')) {
      expect(c.association).toBeUndefined();
      expect(c.repas).toBeUndefined();
      expect(c.motifAucunRepas).toBeUndefined();
      expect(c.attributionValidee).toBeUndefined();
    }
  });

  it('SEED-CAS-16 — une AG de province va à l’association de province', () => {
    for (const c of lot.filter(
      (x) =>
        x.type === 'anti_gaspi' &&
        LIEUX_PROVINCE.has(x.lieu) &&
        !x.sansAttribution,
    )) {
      expect(c.association).toBe('asso_echo');
    }
  });
});
