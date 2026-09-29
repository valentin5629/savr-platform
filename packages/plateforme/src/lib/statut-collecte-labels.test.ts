/**
 * R12 — libellés de statut collecte (UX, décision Val 2026-06-30).
 * Vérifie le mapping admin (granulaire, brouillon→Créée) et client (collapse).
 */
import { describe, it, expect } from 'vitest';
import {
  friseStatutClient,
  statutCollecteDisplay,
} from './statut-collecte-labels';

describe('R12 statutCollecteDisplay — vue admin', () => {
  const cas: [string, string][] = [
    ['brouillon', 'Créée'],
    ['programmee', 'Programmée'],
    ['validee', 'Validée'],
    ['en_cours', 'En cours'],
    ['realisee', 'Réalisée'],
    ['realisee_sans_collecte', 'Sans excédents'],
    ['cloturee', 'Clôturée'],
    ['annulation_demandee', 'Annulation demandée'],
    ['annulee', 'Annulée'],
    ['rejetee_par_prestataire', 'Rejetée'],
  ];
  for (const [statut, label] of cas) {
    it(`admin ${statut} → ${label}`, () => {
      expect(statutCollecteDisplay(statut, 'admin').label).toBe(label);
    });
  }
});

describe('R12 statutCollecteDisplay — vue client (collapse Val)', () => {
  const cas: [string, string][] = [
    ['brouillon', 'Créée'],
    ['programmee', 'Créée'], // jamais « Programmée » côté client
    ['validee', 'Validée'],
    ['en_cours', 'En cours'],
    ['realisee', 'En cours'], // « Réalisée » réservé à cloturee
    ['realisee_sans_collecte', 'Sans excédents'],
    ['cloturee', 'Réalisée'],
    ['annulation_demandee', 'Annulée'],
    ['annulee', 'Annulée'],
    ['rejetee_par_prestataire', 'Créée'], // rejet masqué (interne Ops)
  ];
  for (const [statut, label] of cas) {
    it(`client ${statut} → ${label}`, () => {
      expect(statutCollecteDisplay(statut, 'client').label).toBe(label);
    });
  }

  it('client ne montre jamais « Programmée »', () => {
    const labels = [
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
    ].map((s) => statutCollecteDisplay(s, 'client').label);
    expect(labels).not.toContain('Programmée');
  });

  it('client : « Réalisée » uniquement pour cloturee', () => {
    const realisee = [
      'brouillon',
      'programmee',
      'validee',
      'en_cours',
      'realisee',
      'realisee_sans_collecte',
      'cloturee',
      'annulee',
      'rejetee_par_prestataire',
    ].filter((s) => statutCollecteDisplay(s, 'client').label === 'Réalisée');
    expect(realisee).toEqual(['cloturee']);
  });
});

// ── Frise de statut de la fiche collecte CLIENT (§06.04 refonte 2026-09-29, Q1) ──
describe('M3.1 / frise de statut client', () => {
  const labels = (s: string) => friseStatutClient(s).map((e) => e.label);
  const courante = (s: string) =>
    friseStatutClient(s).find((e) => e.etat === 'courante')?.label;

  it('M3.1/frise_client_vocabulaire — Créée · Validée · En cours · Réalisée, jamais Programmée ni Clôturée', () => {
    for (const s of [
      'brouillon',
      'programmee',
      'validee',
      'en_cours',
      'realisee',
      'cloturee',
      'rejetee_par_prestataire',
    ]) {
      expect(labels(s)).toEqual(['Créée', 'Validée', 'En cours', 'Réalisée']);
    }
    expect(courante('programmee')).toBe('Créée');
    expect(courante('rejetee_par_prestataire')).toBe('Créée');
    expect(courante('validee')).toBe('Validée');
    // `realisee` DB = « En cours » côté client (mapping canonique 2026-06-30).
    expect(courante('realisee')).toBe('En cours');
    expect(courante('cloturee')).toBe('Réalisée');
  });

  it('M3.1/frise_client_sans_excedents — AG sans excédents : dernière étape « Sans excédents »', () => {
    expect(labels('realisee_sans_collecte')).toEqual([
      'Créée',
      'Validée',
      'En cours',
      'Sans excédents',
    ]);
    expect(courante('realisee_sans_collecte')).toBe('Sans excédents');
  });

  it('M3.1/frise_client_annulee — Créée · Annulée (demande comprise)', () => {
    for (const s of ['annulee', 'annulation_demandee']) {
      expect(friseStatutClient(s)).toEqual([
        { label: 'Créée', etat: 'passee' },
        { label: 'Annulée', etat: 'courante' },
      ]);
    }
  });

  it('M3.1/frise_client_etats — étapes passées / courante / à venir', () => {
    expect(friseStatutClient('en_cours').map((e) => e.etat)).toEqual([
      'passee',
      'passee',
      'courante',
      'a_venir',
    ]);
  });
});
