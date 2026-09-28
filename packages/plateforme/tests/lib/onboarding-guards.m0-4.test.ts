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

// Mock supabase minimal : chaque maillon est enregistré (table incluse) pour
// prouver QUELS filtres la garde pose et CE qu'elle insère. Les lectures
// (maybeSingle) et l'insert (single) sont servis dans l'ordre depuis des files.
function fakeSupabase(opts: {
  lectures: ({ id: string } | { nom: string } | null)[];
  insert?: { data: { id: string } | null; error: { code: string } | null };
}) {
  const appels: { table: string; maillon: string; args: unknown[] }[] = [];
  const lectures = [...opts.lectures];
  let table = '';
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'insert']) {
    chain[m] = (...args: unknown[]) => {
      appels.push({ table, maillon: m, args });
      return chain;
    };
  }
  chain.maybeSingle = () =>
    Promise.resolve({ data: lectures.shift() ?? null, error: null });
  chain.single = () =>
    Promise.resolve(opts.insert ?? { data: null, error: { code: 'XX000' } });
  const client = {
    from: (t: string) => {
      table = t;
      return chain;
    },
  } as never;
  return { client, appels };
}

describe('M0.4 — requireCompletedOrganisation (BL-P1-ONB-05)', () => {
  it('orga avec entité de facturation active → ok + id d’entité remonté, rien créé', async () => {
    const { client, appels } = fakeSupabase({ lectures: [{ id: 'ef-1' }] });
    const res = await requireCompletedOrganisation(client, 'org-1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entiteFacturationId).toBe('ef-1');
    expect(appels.some((a) => a.maillon === 'insert')).toBe(false);
  });

  it('SIRET non bloquant (décision Val 2026-09-28) : aucun filtre sur siret_verification', async () => {
    const { client, appels } = fakeSupabase({
      lectures: [{ id: 'ef-en-attente' }],
    });
    await requireCompletedOrganisation(client, 'org-1');
    const colonnesFiltrees = appels
      .filter((a) => a.maillon === 'eq')
      .map((a) => a.args[0]);
    expect(colonnesFiltrees).toEqual(['organisation_id', 'actif']);
    expect(appels).toContainEqual({
      table: 'entites_facturation',
      maillon: 'eq',
      args: ['actif', true],
    });
    // Orga à plusieurs entités : une seule ligne demandée (sinon maybeSingle échoue).
    expect(appels).toContainEqual({
      table: 'entites_facturation',
      maillon: 'limit',
      args: [1],
    });
  });

  it('orga SANS entité active → entité par défaut créée à la volée (SIRET en_attente), programmation non bloquée', async () => {
    const { client, appels } = fakeSupabase({
      lectures: [null, { nom: 'Agence AREP' }],
      insert: { data: { id: 'ef-creee' }, error: null },
    });
    const res = await requireCompletedOrganisation(client, 'org-arep');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entiteFacturationId).toBe('ef-creee');
    const inserts = appels.filter((a) => a.maillon === 'insert');
    expect(inserts).toEqual([
      {
        table: 'entites_facturation',
        maillon: 'insert',
        args: [
          {
            organisation_id: 'org-arep',
            raison_sociale: 'Agence AREP',
            siret: '',
            adresse_facturation: '',
            code_postal: '',
            ville: '',
            entite_par_defaut: true,
            siret_verification: 'en_attente',
            tva_verification: 'non_applicable',
          },
        ],
      },
    ]);
  });

  it('course : l’INSERT perd sur l’index unique (23505) → relit l’entité gagnante', async () => {
    const { client } = fakeSupabase({
      lectures: [null, { nom: 'Agence AREP' }, { id: 'ef-gagnante' }],
      insert: { data: null, error: { code: '23505' } },
    });
    const res = await requireCompletedOrganisation(client, 'org-arep');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entiteFacturationId).toBe('ef-gagnante');
  });

  it('création impossible (orga introuvable) → erreur 500, jamais le motif SIRET', async () => {
    const { client } = fakeSupabase({ lectures: [null, null] });
    const res = await requireCompletedOrganisation(client, 'org-x');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.status).toBe(500);
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
