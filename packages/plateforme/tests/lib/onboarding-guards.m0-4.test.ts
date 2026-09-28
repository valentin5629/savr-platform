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

// Mock supabase minimal : .from().select().eq().order().limit().maybeSingle(),
// chaque maillon enregistré pour prouver QUELS filtres la garde pose.
function fakeSupabase(entite: { id: string } | null) {
  const appels: { maillon: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) {
    chain[m] = (...args: unknown[]) => {
      appels.push({ maillon: m, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve({ data: entite, error: null });
  return { client: { from: () => chain } as never, appels };
}

describe('M0.4 — requireCompletedOrganisation (BL-P1-ONB-05)', () => {
  it('orga avec entité de facturation active → ok + id d’entité remonté', async () => {
    const { client } = fakeSupabase({ id: 'ef-1' });
    const res = await requireCompletedOrganisation(client, 'org-1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entiteFacturationId).toBe('ef-1');
  });

  it('SIRET non bloquant (décision Val 2026-09-28) : aucun filtre sur siret_verification', async () => {
    const { client, appels } = fakeSupabase({ id: 'ef-en-attente' });
    await requireCompletedOrganisation(client, 'org-1');
    const colonnesFiltrees = appels
      .filter((a) => a.maillon === 'eq')
      .map((a) => a.args[0]);
    expect(colonnesFiltrees).toEqual(['organisation_id', 'actif']);
    expect(appels).toContainEqual({ maillon: 'eq', args: ['actif', true] });
    // Orga à plusieurs entités : une seule ligne demandée (sinon maybeSingle échoue).
    expect(appels).toContainEqual({ maillon: 'limit', args: [1] });
  });

  it('orga sans aucune entité de facturation active → bloquée 422', async () => {
    const { client } = fakeSupabase(null);
    const res = await requireCompletedOrganisation(client, 'org-1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.status).toBe(422);
      const json = (await res.error.json()) as { error: string };
      expect(json.error).not.toMatch(/SIRET/);
    }
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
