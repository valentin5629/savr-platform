import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLogistiqueProvider } from '../index.js';
import type { Transporteur } from '../index.js';
import { _setMts1Handlers, setupMts1Mock } from './mock.js';

// healthCheck ne touche la DB sur AUCUN des chemins testés (mock, config vide,
// non applicable) → un supabase factice suffit.
const supabase = {} as never;

const T_MTS1: Transporteur = {
  id: 'presta-001',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: 'presta-uuid-001',
};

describe('healthCheck / MTS-1', () => {
  afterEach(() => {
    _setMts1Handlers(null);
    vi.unstubAllEnvs();
  });

  it('renvoie etat=ok en mode mock (handlers injectés)', async () => {
    const restore = setupMts1Mock({});
    const r = await getLogistiqueProvider(T_MTS1, supabase).healthCheck();
    expect(r).toMatchObject({ ok: true, etat: 'ok', statutHttp: 200 });
    restore();
  });

  it('signale la config manquante hors mock (MTS1_BASE_URL / MTS1_API_KEY vides)', async () => {
    _setMts1Handlers(null);
    vi.stubEnv('MTS1_BASE_URL', '');
    vi.stubEnv('MTS1_API_KEY', '');
    const r = await getLogistiqueProvider(T_MTS1, supabase).healthCheck();
    expect(r.ok).toBe(false);
    expect(r.etat).toBe('ko');
    expect(r.message).toContain('MTS1_BASE_URL');
    expect(r.message).toContain('MTS1_API_KEY');
  });
});

describe('healthCheck / non applicable', () => {
  it('Everest (a_toutes) = non_applicable, ok=true', async () => {
    const r = await getLogistiqueProvider(
      { id: 'e1', type_tms: 'a_toutes', prestataire_logistique_id: 'p' },
      supabase,
    ).healthCheck();
    expect(r.ok).toBe(true);
    expect(r.etat).toBe('non_applicable');
  });

  it('Provider manuel (autre) = non_applicable, ok=true', async () => {
    const r = await getLogistiqueProvider(
      { id: 'm1', type_tms: 'autre', prestataire_logistique_id: 'p' },
      supabase,
    ).healthCheck();
    expect(r.ok).toBe(true);
    expect(r.etat).toBe('non_applicable');
  });
});
