/**
 * M0.4 / BL-P1-ONB-05 — middlewares onboarding (CDC §09 §5).
 * Factorisation des gates « profil entreprise complet » (requireCompletedOrganisation,
 * gate programmation) et « orga validée » (requireValidatedOrganisation, gate push Pennylane).
 */
import { describe, it, expect } from 'vitest';
import {
  requireCompletedOrganisation,
  requireValidatedOrganisation,
} from '@/lib/onboarding-guards.js';

// Mock supabase minimal : .from().select().eq().eq().maybeSingle()
function fakeSupabase(entite: { id: string } | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: entite, error: null }),
  };
  return { from: () => chain } as never;
}

describe('M0.4 — requireCompletedOrganisation (BL-P1-ONB-05)', () => {
  it('orga avec entité SIRET vérifiée → ok + id d’entité remonté', async () => {
    const res = await requireCompletedOrganisation(
      fakeSupabase({ id: 'ef-1' }),
      'org-1',
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entiteFacturationId).toBe('ef-1');
  });

  it('orga incomplète (aucune entité SIRET vérifiée) → bloquée 422', async () => {
    const res = await requireCompletedOrganisation(fakeSupabase(null), 'org-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(422);
  });
});

describe('M0.4 — requireValidatedOrganisation (BL-P1-ONB-05)', () => {
  it('entité SIRET vérifiée → push Pennylane autorisé', () => {
    expect(
      requireValidatedOrganisation({ siret_verification: 'verifie' }),
    ).toEqual({ ok: true });
  });

  it('entité non vérifiée → push Pennylane bloqué', () => {
    const r = requireValidatedOrganisation({
      siret_verification: 'en_attente',
    });
    expect(r.ok).toBe(false);
  });

  it('entité absente (null) → push Pennylane bloqué', () => {
    const r = requireValidatedOrganisation(null);
    expect(r.ok).toBe(false);
  });
});
