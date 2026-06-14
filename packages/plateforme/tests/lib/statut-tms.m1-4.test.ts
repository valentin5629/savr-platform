/**
 * M1.4 — Tests mapping statut MTS-1 → statut_tms Savr + dérive collecte.statut
 * Couvre §08 §3bis.6 + miroir trigger fn_sync_statut_collecte_from_tms.
 */
import { describe, it, expect } from 'vitest';
import {
  mapMts1ToStatutTms,
  deriveStatutFromStatutTms,
  MTS1_TERMINAL_STATUSES,
  MTS1_SUCCESS_STATUSES,
  MTS1_REJECTION_STATUSES,
} from '../../src/lib/statut-tms.js';

// ── mapMts1ToStatutTms ─────────────────────────────────────────────────────

describe('M1.4/statut-tms — mapMts1ToStatutTms', () => {
  it('M1.4/statut-tms — PLANNED sans dispatch accepté → attribuee_en_attente_acceptation', () => {
    expect(mapMts1ToStatutTms('PLANNED', false)).toBe(
      'attribuee_en_attente_acceptation',
    );
  });

  it('M1.4/statut-tms — VALIDATED sans dispatch accepté → attribuee_en_attente_acceptation', () => {
    expect(mapMts1ToStatutTms('VALIDATED', false)).toBe(
      'attribuee_en_attente_acceptation',
    );
  });

  it('M1.4/statut-tms — PLANNED + dispatch ACCEPTED → acceptee (signal positif)', () => {
    expect(mapMts1ToStatutTms('PLANNED', true)).toBe('acceptee');
  });

  it('M1.4/statut-tms — VALIDATED + dispatch ACCEPTED → acceptee (signal positif)', () => {
    expect(mapMts1ToStatutTms('VALIDATED', true)).toBe('acceptee');
  });

  it('M1.4/statut-tms — IN_PROGRESSION → acceptee (statut collecte = en_cours via M1.5c)', () => {
    expect(mapMts1ToStatutTms('IN_PROGRESSION', false)).toBe('acceptee');
  });

  it('M1.4/statut-tms — OK → acceptee (agrégation M1.5c → realisee)', () => {
    expect(mapMts1ToStatutTms('OK', false)).toBe('acceptee');
  });

  it('M1.4/statut-tms — PARTIAL → acceptee (agrégation M1.5c → realisee avec pesées partielles)', () => {
    expect(mapMts1ToStatutTms('PARTIAL', false)).toBe('acceptee');
  });

  it('M1.4/statut-tms — CANCELED → rejetee_par_prestataire', () => {
    expect(mapMts1ToStatutTms('CANCELED', false)).toBe(
      'rejetee_par_prestataire',
    );
  });

  it('M1.4/statut-tms — KO → rejetee_par_prestataire', () => {
    expect(mapMts1ToStatutTms('KO', false)).toBe('rejetee_par_prestataire');
  });

  it('M1.4/statut-tms — CANCELED avec dispatch accepté → rejetee_par_prestataire (refus prioritaire)', () => {
    expect(mapMts1ToStatutTms('CANCELED', true)).toBe(
      'rejetee_par_prestataire',
    );
  });
});

// ── deriveStatutFromStatutTms ──────────────────────────────────────────────

describe('M1.4/statut-tms — deriveStatutFromStatutTms (miroir trigger DB)', () => {
  it('M1.4/statut-tms — acceptee + programmee → validee (validation acceptation)', () => {
    expect(deriveStatutFromStatutTms('acceptee', 'programmee')).toBe('validee');
  });

  it('M1.4/statut-tms — en_attente_execution + programmee → validee', () => {
    expect(
      deriveStatutFromStatutTms('en_attente_execution', 'programmee'),
    ).toBe('validee');
  });

  it('M1.4/statut-tms — non_envoye + validee → programmee (reset)', () => {
    expect(deriveStatutFromStatutTms('non_envoye', 'validee')).toBe(
      'programmee',
    );
  });

  it('M1.4/statut-tms — a_attribuer + validee → programmee', () => {
    expect(deriveStatutFromStatutTms('a_attribuer', 'validee')).toBe(
      'programmee',
    );
  });

  it('M1.4/statut-tms — attribuee_en_attente_acceptation + validee → programmee', () => {
    expect(
      deriveStatutFromStatutTms('attribuee_en_attente_acceptation', 'validee'),
    ).toBe('programmee');
  });

  it('M1.4/statut-tms — acceptee + validee → null (déjà validée, pas de doublon)', () => {
    expect(deriveStatutFromStatutTms('acceptee', 'validee')).toBeNull();
  });

  it('M1.4/statut-tms — acceptee + en_cours → null (en_cours géré par M1.5c)', () => {
    expect(deriveStatutFromStatutTms('acceptee', 'en_cours')).toBeNull();
  });

  it('M1.4/statut-tms — rejetee_par_prestataire + programmee → null (pas de transition trigger)', () => {
    expect(
      deriveStatutFromStatutTms('rejetee_par_prestataire', 'programmee'),
    ).toBeNull();
  });

  it('M1.4/statut-tms — non_envoye + programmee → null (déjà programmée)', () => {
    expect(deriveStatutFromStatutTms('non_envoye', 'programmee')).toBeNull();
  });
});

// ── Sets constants ─────────────────────────────────────────────────────────

describe('M1.4/statut-tms — constantes ensembles MTS-1', () => {
  it('M1.4/statut-tms — MTS1_TERMINAL_STATUSES : OK, PARTIAL, CANCELED, KO', () => {
    expect(MTS1_TERMINAL_STATUSES.has('OK')).toBe(true);
    expect(MTS1_TERMINAL_STATUSES.has('PARTIAL')).toBe(true);
    expect(MTS1_TERMINAL_STATUSES.has('CANCELED')).toBe(true);
    expect(MTS1_TERMINAL_STATUSES.has('KO')).toBe(true);
    expect(MTS1_TERMINAL_STATUSES.has('PLANNED')).toBe(false);
    expect(MTS1_TERMINAL_STATUSES.has('IN_PROGRESSION')).toBe(false);
  });

  it('M1.4/statut-tms — MTS1_SUCCESS_STATUSES ⊂ MTS1_TERMINAL_STATUSES', () => {
    for (const s of MTS1_SUCCESS_STATUSES) {
      expect(MTS1_TERMINAL_STATUSES.has(s)).toBe(true);
    }
  });

  it('M1.4/statut-tms — MTS1_REJECTION_STATUSES ⊂ MTS1_TERMINAL_STATUSES', () => {
    for (const s of MTS1_REJECTION_STATUSES) {
      expect(MTS1_TERMINAL_STATUSES.has(s)).toBe(true);
    }
  });

  it('M1.4/statut-tms — SUCCESS et REJECTION sont disjoints', () => {
    for (const s of MTS1_SUCCESS_STATUSES) {
      expect(MTS1_REJECTION_STATUSES.has(s)).toBe(false);
    }
  });
});
