/**
 * Présentation des alertes Admin in-app (lib/alertes-admin) — follow-up R22e.
 * Vérifie la sévérité par code (catalogue explicite + fallback mots-clés pour un
 * émetteur futur non catalogué) et les liens profonds vers l'entité.
 */
import { describe, it, expect } from 'vitest';
import {
  severiteParCode,
  entiteHref,
  SEVERITE_BADGE,
} from '../../src/lib/alertes-admin.js';

describe('severiteParCode — catalogue explicite', () => {
  it('codes critiques connus', () => {
    for (const c of [
      'pack_ag_epuise',
      'ag_realisee_sans_pack_actif',
      'pdf_job_dead',
      'pennylane_echec_final',
      'collecte_rejetee_prestataire',
      'pesee_divergence_post_cloture',
      'bordereau_pesees_manquantes_48h',
    ]) {
      expect(severiteParCode(c)).toBe('critique');
    }
  });

  it('codes « à traiter » connus', () => {
    for (const c of [
      'pack_ag_bas',
      'attribution_aucun_prestataire',
      'attribution_aucune_asso',
      'pesee_hors_seuil',
      'reduction_camions_bloquee',
      'collecte_partiellement_servie',
      'collecte_aucun_repas',
    ]) {
      expect(severiteParCode(c)).toBe('attention');
    }
  });

  it('codes informatifs connus', () => {
    for (const c of [
      'shadow_traiteur_cree',
      'shadow_siret_complete',
      'lieu_override_programmation',
    ]) {
      expect(severiteParCode(c)).toBe('info');
    }
  });
});

describe('severiteParCode — fallback mots-clés (code inconnu)', () => {
  it('mot-clé critique', () => {
    expect(severiteParCode('futur_job_dead')).toBe('critique');
    expect(severiteParCode('sync_echec_x')).toBe('critique');
  });
  it('mot-clé attention', () => {
    expect(severiteParCode('stock_bas_x')).toBe('attention');
    expect(severiteParCode('quota_bloque_y')).toBe('attention');
  });
  it('par défaut → info', () => {
    expect(severiteParCode('un_code_totalement_inconnu')).toBe('info');
  });
});

describe('SEVERITE_BADGE — mapping variante', () => {
  it('chaque sévérité mappe une variante Badge valide', () => {
    expect(SEVERITE_BADGE.critique.variant).toBe('error');
    expect(SEVERITE_BADGE.attention.variant).toBe('warning');
    expect(SEVERITE_BADGE.info.variant).toBe('neutral');
  });
});

describe('entiteHref — lien profond back-office', () => {
  it('collecte(s) → fiche collecte', () => {
    expect(entiteHref('collecte', 'c1')).toBe('/admin/collectes/c1');
    expect(entiteHref('collectes', 'c1')).toBe('/admin/collectes/c1');
  });
  it('organisations → fiche client', () => {
    expect(entiteHref('organisations', 'o1')).toBe('/admin/clients/o1');
  });
  it('factures / lieux → fiches dédiées', () => {
    expect(entiteHref('factures', 'f1')).toBe('/admin/factures/f1');
    expect(entiteHref('lieux', 'l1')).toBe('/admin/lieux/l1');
  });
  it('entité sans page dédiée (pack) ou id manquant → null', () => {
    expect(entiteHref('pack_antgaspi', 'p1')).toBeNull();
    expect(entiteHref('collecte', null)).toBeNull();
    expect(entiteHref(null, 'x')).toBeNull();
  });
});
