/**
 * R12 — libellés de statut collecte (UX, décision Val 2026-06-30).
 * Vérifie le mapping admin (granulaire, brouillon→Créée) et client (collapse).
 */
import { describe, it, expect } from 'vitest';
import { statutCollecteDisplay } from './statut-collecte-labels';

describe('R12 statutCollecteDisplay — vue admin', () => {
  const cas: [string, string][] = [
    ['brouillon', 'Créée'],
    ['programmee', 'Programmée'],
    ['validee', 'Validée'],
    ['en_cours', 'En cours'],
    ['realisee', 'Réalisée'],
    ['realisee_sans_collecte', 'Sans excédents'],
    ['cloturee', 'Clôturée'],
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
