/**
 * M0.4 / BL-P1-ONB-05 — middlewares onboarding (CDC §09 §5).
 * Factorisation des gates « profil entreprise complet » (requireCompletedOrganisation,
 * gate programmation) et « orga validée » (requireValidatedOrganisation, gate push Pennylane).
 */
import { describe, it, expect } from 'vitest';
import {
  lireEntiteFacturation,
  requireCompletedOrganisation,
  requireValidatedOrganisation,
} from '@/lib/onboarding-guards.js';

// Mock supabase minimal : chaque maillon est enregistré (table incluse) pour
// prouver QUELS filtres la garde pose et CE qu'elle insère. Les lectures
// (maybeSingle) et l'insert (single) sont servis dans l'ordre depuis des files.
function fakeSupabase(opts: {
  lectures: (
    | { id: string }
    | { nom: string; raison_sociale?: string | null }
    | null
  )[];
  erreurLecture?: { message: string };
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
    Promise.resolve({
      data: lectures.shift() ?? null,
      error: opts.erreurLecture ?? null,
    });
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

  it('raison sociale légale de l’orga reprise en priorité sur le nom commercial', async () => {
    const { client, appels } = fakeSupabase({
      lectures: [null, { nom: 'AREP', raison_sociale: 'AREP GROUPE SAS' }],
      insert: { data: { id: 'ef-creee' }, error: null },
    });
    await requireCompletedOrganisation(client, 'org-arep');
    const insert = appels.find((a) => a.maillon === 'insert');
    expect(insert?.args[0]).toMatchObject({
      raison_sociale: 'AREP GROUPE SAS',
    });
  });

  it('lecture en échec → 500, et SURTOUT aucune entité créée sur une panne', async () => {
    const { client, appels } = fakeSupabase({
      lectures: [null],
      erreurLecture: { message: 'connexion perdue' },
    });
    const res = await requireCompletedOrganisation(client, 'org-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(500);
    expect(appels.some((a) => a.maillon === 'insert')).toBe(false);
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

// Lecture et création séparées : la route de programmation lit l'entité avant
// ses gardes, et ne la crée qu'après son frein de débit (décision Val 2026-10-13).
describe('M0.4 — lireEntiteFacturation, puis création après coup', () => {
  it('lireEntiteFacturation ne crée jamais : entité rendue, ou null quand l’organisation n’en a pas', async () => {
    const avec = fakeSupabase({ lectures: [{ id: 'ef-1' }] });
    expect(await lireEntiteFacturation(avec.client, 'org-1')).toEqual({
      ok: true,
      entiteFacturationId: 'ef-1',
    });

    const sans = fakeSupabase({ lectures: [null] });
    expect(await lireEntiteFacturation(sans.client, 'org-1')).toEqual({
      ok: true,
      entiteFacturationId: null,
    });
    for (const { appels } of [avec, sans]) {
      expect(appels.some((a) => a.maillon === 'insert')).toBe(false);
      expect(new Set(appels.map((a) => a.table))).toEqual(
        new Set(['entites_facturation']),
      );
    }
  });

  it('lireEntiteFacturation : lecture en échec → erreur 500, jamais « aucune entité »', async () => {
    const { client } = fakeSupabase({
      lectures: [null],
      erreurLecture: { message: 'timeout' },
    });
    const res = await lireEntiteFacturation(client, 'org-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(500);
  });

  it('entité déjà lue et présente : rendue telle quelle, aucune requête', async () => {
    const { client, appels } = fakeSupabase({ lectures: [] });
    const res = await requireCompletedOrganisation(client, 'org-1', {
      entiteFacturationId: 'ef-1',
    });
    expect(res).toEqual({ ok: true, entiteFacturationId: 'ef-1' });
    expect(appels).toEqual([]);
  });

  it('entité déjà lue et absente : créée sans relire l’entité', async () => {
    const { client, appels } = fakeSupabase({
      lectures: [{ nom: 'Traiteur Dupont' }],
      insert: { data: { id: 'ef-creee' }, error: null },
    });
    const res = await requireCompletedOrganisation(client, 'org-1', {
      entiteFacturationId: null,
    });
    expect(res).toEqual({ ok: true, entiteFacturationId: 'ef-creee' });
    // Première requête : l'organisation, pas une seconde lecture de l'entité.
    expect(appels[0]).toMatchObject({ table: 'organisations' });
    expect(
      appels.filter(
        (a) => a.table === 'entites_facturation' && a.maillon === 'insert',
      ),
    ).toHaveLength(1);
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
