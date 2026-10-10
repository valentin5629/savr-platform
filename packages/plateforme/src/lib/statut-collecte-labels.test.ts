/**
 * R12 — libellés de statut collecte (UX, décision Val 2026-06-30).
 * Vérifie le mapping admin (granulaire ; « Créée » puis « Programmée » pour le
 * statut DB `programmee`, décision Val 2026-10-07) et client (collapse).
 */
import { describe, it, expect } from 'vitest';
import {
  ETAPES_STATUT_COLLECTE,
  friseStatutClient,
  LIBELLE_SANS_EXCEDENT,
  LIBELLE_STATUT_COLLECTE,
  RANG_STATUT_COLLECTE,
  statutCollecteDisplay,
} from './statut-collecte-labels';

describe('R12 statutCollecteDisplay — vue admin', () => {
  const cas: [string, string][] = [
    ['brouillon', 'Brouillon'],
    ['creee', 'Créée'],
    ['programmee', 'Programmée'],
    ['validee', 'Validée'],
    ['en_cours', 'En cours'],
    ['realisee', 'Réalisée'],
    ['realisee_sans_collecte', 'Réalisée'], // pas un statut à part (Val 2026-10-09)
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
    ['realisee', 'En cours'], // « Réalisée » attend la clôture
    ['realisee_sans_collecte', 'Réalisée'], // pas un statut à part (Val 2026-10-09)
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

  it('client : « Réalisée » pour cloturee et pour une AG sans excédent, jamais pour realisee', () => {
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
    expect(realisee).toEqual(['realisee_sans_collecte', 'cloturee']);
  });
});

// « Sans excédent » n'est pas un statut d'avancement (décision Val 2026-10-09) :
// c'est le résultat d'une collecte AG, affiché là où se lisent ses repas.
describe('M0.6 / M3.1 — « Sans excédent » n’est pas un statut', () => {
  const STATUTS = [
    'brouillon',
    'creee',
    'programmee',
    'validee',
    'en_cours',
    'realisee',
    'realisee_sans_collecte',
    'cloturee',
    'annulation_demandee',
    'annulee',
    'rejetee_par_prestataire',
  ];

  it('M0.6/statut_sans_excedent_affiche_realisee — aucun libellé de statut ne dit « Sans excédent », dans aucune vue', () => {
    for (const vue of ['admin', 'client'] as const)
      for (const s of STATUTS)
        expect(statutCollecteDisplay(s, vue).label).not.toMatch(/exc[ée]dent/i);
  });

  it('même badge que « Réalisée » : celui de `realisee` côté Admin, de `cloturee` côté client', () => {
    expect(statutCollecteDisplay('realisee_sans_collecte', 'admin')).toEqual(
      statutCollecteDisplay('realisee', 'admin'),
    );
    expect(statutCollecteDisplay('realisee_sans_collecte', 'client')).toEqual(
      statutCollecteDisplay('cloturee', 'client'),
    );
  });

  it('la mention de résultat est « Sans excédent », au singulier', () => {
    expect(LIBELLE_SANS_EXCEDENT).toBe('Sans excédent');
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

  it('M3.1/frise_client_sans_excedents — AG sans excédent : la frise de toutes les collectes, dernière étape « Réalisée »', () => {
    expect(labels('realisee_sans_collecte')).toEqual([
      'Créée',
      'Validée',
      'En cours',
      'Réalisée',
    ]);
    expect(courante('realisee_sans_collecte')).toBe('Réalisée');
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

describe('R-UI-2 C1 — source unique statut collecte (étapes, rangs, export)', () => {
  it('M0.6/statut_admin_frise_six_etapes — parcours nominal = 6 étapes, rang = position + 1', () => {
    expect(ETAPES_STATUT_COLLECTE).toEqual([
      'creee',
      'programmee',
      'validee',
      'en_cours',
      'realisee',
      'cloturee',
    ]);
    ETAPES_STATUT_COLLECTE.forEach((s, i) =>
      expect(RANG_STATUT_COLLECTE[s]).toBe(i + 1),
    );
  });

  it('hors parcours = rang 0, sans excédents = rang de « Réalisée »', () => {
    for (const s of [
      'brouillon',
      'annulation_demandee',
      'annulee',
      'rejetee_par_prestataire',
    ] as const)
      expect(RANG_STATUT_COLLECTE[s]).toBe(0);
    expect(RANG_STATUT_COLLECTE.realisee_sans_collecte).toBe(
      RANG_STATUT_COLLECTE.realisee,
    );
  });

  it('libellés export CSV = vue admin', () => {
    for (const [statut, label] of Object.entries(LIBELLE_STATUT_COLLECTE))
      expect(label).toBe(statutCollecteDisplay(statut, 'admin').label);
    expect(LIBELLE_STATUT_COLLECTE.brouillon).toBe('Brouillon');
    expect(LIBELLE_STATUT_COLLECTE.creee).toBe('Créée');
    expect(LIBELLE_STATUT_COLLECTE.realisee_sans_collecte).toBe('Réalisée');
    // Les 10 statuts DB + la clé d'affichage Admin « Créée ».
    expect(Object.keys(LIBELLE_STATUT_COLLECTE)).toHaveLength(11);
  });
});
