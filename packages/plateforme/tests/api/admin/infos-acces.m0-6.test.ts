/**
 * M0.6 — PATCH /api/v1/admin/collectes/[id]/infos-acces (saisie manuelle Admin
 * des infos accès chauffeur). Vérifie : garde staff, 404 collecte, 422 body vide /
 * tournee_id hors périmètre, écriture + déclenchement de l'email de complétude.
 * Mock keyé par table + mock du helper d'envoi (décision Val 2026-07-15).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

type Ecriture = {
  table: string;
  op: 'insert' | 'upsert' | 'update' | 'delete';
  payload?: unknown;
  opts?: unknown;
  filtres: Record<string, unknown>;
};

function makeClient() {
  const results: Record<string, Result> = {};
  // Résultat spécifique d'une écriture (ex. 23505 sur l'INSERT du lien) ; une
  // fonction reçoit le numéro d'appel (1, 2, …) de cette écriture sur la table.
  const resultsEcriture: Partial<
    Record<`${string}.${Ecriture['op']}`, Result | ((n: number) => Result)>
  > = {};
  const compteurs: Record<string, number> = {};
  const ecritures: Ecriture[] = [];
  function chain(table: string): Record<string, unknown> {
    let courante: Ecriture | null = null;
    let numero = 0;
    const res = (): Result => {
      if (courante) {
        const specifique = resultsEcriture[`${table}.${courante.op}`];
        if (typeof specifique === 'function') return specifique(numero);
        if (specifique) return specifique;
      }
      return results[table] ?? { data: null, error: null };
    };
    const ecrire =
      (op: Ecriture['op']) =>
      (payload?: unknown, opts?: unknown): Record<string, unknown> => {
        courante = { table, op, payload, opts, filtres: {} };
        const k = `${table}.${op}`;
        compteurs[k] = (compteurs[k] ?? 0) + 1;
        numero = compteurs[k];
        ecritures.push(courante);
        return c;
      };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (col: string, val: unknown) => {
        if (courante) courante.filtres[col] = val;
        return c;
      },
      order: () => c,
      insert: ecrire('insert'),
      upsert: ecrire('upsert'),
      update: ecrire('update'),
      delete: ecrire('delete'),
      maybeSingle: () => Promise.resolve(res()),
      single: () => Promise.resolve(res()),
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  return { from: (t: string) => chain(t), results, resultsEcriture, ecritures };
}

let admin = makeClient();
const mockRequireStaff = vi.fn();
const mockEvaluer = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: (...a: unknown[]) => mockRequireStaff(...a),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@/lib/infos-acces/notify.js', () => ({
  evaluerInfosAccesEtEnvoyer: (...a: unknown[]) => mockEvaluer(...a),
}));

import { PATCH } from '@/app/api/v1/admin/collectes/[id]/infos-acces/route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/admin/collectes/coll-1/infos-acces',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
const ctx = { params: Promise.resolve({ id: 'coll-1' }) };

beforeEach(() => {
  admin = makeClient();
  mockRequireStaff.mockReset();
  mockEvaluer.mockReset();
  mockRequireStaff.mockResolvedValue({
    ctx: { userId: 'u-1', role: 'admin_savr' },
  });
  mockEvaluer.mockResolvedValue({ envoye: false });
});

describe('M0.6 / PATCH infos-acces — garde staff + validation', () => {
  it('non-staff → renvoie l’erreur d’auth', async () => {
    const errResp = new Response('nope', { status: 403 });
    mockRequireStaff.mockResolvedValue({ error: errResp });
    const res = await PATCH(makeReq({ tournees: [] }), ctx);
    expect(res.status).toBe(403);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });

  it('body sans tournees → 422', async () => {
    const res = await PATCH(makeReq({}), ctx);
    expect(res.status).toBe(422);
  });

  it('collecte introuvable → 404', async () => {
    admin.results['collectes'] = { data: null, error: { code: 'PGRST116' } };
    const res = await PATCH(
      makeReq({ tournees: [{ tournee_id: 'T1', chauffeur_nom: 'X' }] }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('tournee_id hors périmètre de la collecte → 422', async () => {
    admin.results['collectes'] = {
      data: { id: 'coll-1', controle_acces_requis: true },
      error: null,
    };
    admin.results['collecte_tournees'] = {
      data: [{ tournee_id: 'T1', tournees: {} }],
      error: null,
    };
    const res = await PATCH(
      makeReq({ tournees: [{ tournee_id: 'T-INCONNU', chauffeur_nom: 'X' }] }),
      ctx,
    );
    expect(res.status).toBe(422);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });
});

describe('M0.6 / PATCH infos-acces — écriture + email de complétude', () => {
  it('saisie valide → 200, ré-évalue la complétude et remonte email_envoye', async () => {
    admin.results['collectes'] = {
      data: { id: 'coll-1', controle_acces_requis: true },
      error: null,
    };
    admin.results['collecte_tournees'] = {
      data: [{ tournee_id: 'T1', tournees: { id: 'T1' } }],
      error: null,
    };
    admin.results['tournees'] = { data: null, error: null };
    mockEvaluer.mockResolvedValue({ envoye: true, issue: 'envoye' });

    const res = await PATCH(
      makeReq({
        tournees: [
          {
            tournee_id: 'T1',
            plaque_immatriculation: 'AA-123-BB',
            chauffeur_nom: 'Jean',
            chauffeur_telephone: '0611',
          },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      email_envoye: boolean;
      email: string;
    };
    expect(body.email_envoye).toBe(true);
    expect(body.email).toBe('envoye');
    expect(mockEvaluer).toHaveBeenCalledWith(expect.anything(), 'coll-1');
  });

  // Décision Val 2026-10-08 (C3) : la réponse dit ce qu'il est advenu de l'email,
  // pour que la fiche n'annonce plus « envoyé » quand il n'est pas parti.
  it.each([
    { issue: 'en_reprise', envoye: false },
    { issue: 'non_envoye', envoye: false },
    { issue: 'sans_objet', envoye: false },
  ])(
    'email $issue → 200, email_envoye=false et `email` dit pourquoi',
    async ({ issue, envoye }) => {
      admin.results['collectes'] = {
        data: { id: 'coll-1', controle_acces_requis: true },
        error: null,
      };
      admin.results['collecte_tournees'] = {
        data: [{ tournee_id: 'T1', tournees: { id: 'T1' } }],
        error: null,
      };
      mockEvaluer.mockResolvedValue({ envoye, issue });

      const res = await PATCH(
        makeReq({ tournees: [{ tournee_id: 'T1', chauffeur_nom: 'Jean' }] }),
        ctx,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        email_envoye: boolean;
        email: string;
      };
      expect(body.email_envoye).toBe(false);
      expect(body.email).toBe(issue);
    },
  );

  it('aucun champ modifiable fourni → 422 (avant tout envoi)', async () => {
    admin.results['collectes'] = {
      data: { id: 'coll-1', controle_acces_requis: true },
      error: null,
    };
    admin.results['collecte_tournees'] = {
      data: [{ tournee_id: 'T1', tournees: { id: 'T1' } }],
      error: null,
    };
    const res = await PATCH(makeReq({ tournees: [{ tournee_id: 'T1' }] }), ctx);
    expect(res.status).toBe(422);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });
});

describe('M0.6 / PATCH infos-acces — camion demandé sans tournée (création Admin, C2 Val 2026-10-06)', () => {
  const collecte2Camions = {
    id: 'coll-1',
    statut: 'validee',
    controle_acces_requis: false,
    nb_camions_demande: 2,
    prestataire_logistique_id: 'presta-1',
    date_collecte: '2026-10-01',
    heure_collecte: '22:00:00',
  };
  const lienRang1 = {
    data: [{ tournee_id: 'T1', rang: 1, tournees: { id: 'T1' } }],
    error: null,
  };
  const ecrituresDe = (op?: Ecriture['op']) =>
    admin.ecritures.filter(
      (e) => e.table !== 'audit_log' && (op === undefined || e.op === op),
    );

  it('rang 2 sans tournée → tournée ADM-coll-1-2 créée (planifiée, prestataire et date de la collecte, créneau nuit), liée au rang 2, coordonnées écrites sur elle, tournees_creees renvoyé', async () => {
    admin.results['collectes'] = { data: collecte2Camions, error: null };
    admin.results['collecte_tournees'] = lienRang1;
    admin.results['tournees'] = { data: { id: 'T-NEW' }, error: null };
    mockEvaluer.mockResolvedValue({ envoye: false });

    const res = await PATCH(
      makeReq({
        tournees: [
          { rang: 2, chauffeur_nom: 'Léa', chauffeur_telephone: '0622' },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tournees_creees: Array<{ rang: number; tournee_id: string }>;
    };
    expect(body.tournees_creees).toEqual([{ rang: 2, tournee_id: 'T-NEW' }]);
    expect(mockEvaluer).toHaveBeenCalledWith(expect.anything(), 'coll-1');

    // Ce qui est réellement écrit, dans l'ordre : tournée, lien, coordonnées.
    expect(ecrituresDe().map((e) => `${e.table}.${e.op}`)).toEqual([
      'tournees.upsert',
      'collecte_tournees.insert',
      'tournees.update',
    ]);
    const [creation, lien, coord] = ecrituresDe();
    expect(creation!.payload).toEqual({
      reference_interne: 'ADM-coll-1-2',
      date_tournee: '2026-10-01',
      creneau: 'nuit',
      prestataire_logistique_id: 'presta-1',
      statut: 'planifiee',
    });
    expect(creation!.opts).toEqual({ onConflict: 'reference_interne' });
    expect(lien!.payload).toEqual({
      collecte_id: 'coll-1',
      tournee_id: 'T-NEW',
      rang: 2,
    });
    expect(coord!.payload).toEqual({
      chauffeur_nom: 'Léa',
      chauffeur_telephone: '0622',
    });
    expect(coord!.filtres).toEqual({ id: 'T-NEW' });
  });

  it.each([
    ['08:30:00', 'matin'],
    ['14:00:00', 'apres_midi'],
    ['19:00:00', 'soir'],
    [null, 'nuit'],
  ])(
    'créneau de la tournée créée dérivé de l’heure de collecte (%s → %s)',
    async (heure, creneau) => {
      admin.results['collectes'] = {
        data: { ...collecte2Camions, heure_collecte: heure },
        error: null,
      };
      admin.results['collecte_tournees'] = { data: [], error: null };
      admin.results['tournees'] = { data: { id: 'T-NEW' }, error: null };
      const res = await PATCH(
        makeReq({ tournees: [{ rang: 1, chauffeur_nom: 'X' }] }),
        ctx,
      );
      expect(res.status).toBe(200);
      expect(
        (ecrituresDe('upsert')[0]!.payload as { creneau: string }).creneau,
      ).toBe(creneau);
    },
  );

  it('rang au-delà du nombre de camions demandé → 422, aucune écriture', async () => {
    admin.results['collectes'] = { data: collecte2Camions, error: null };
    admin.results['collecte_tournees'] = { data: [], error: null };
    const res = await PATCH(
      makeReq({ tournees: [{ rang: 3, chauffeur_nom: 'X' }] }),
      ctx,
    );
    expect(res.status).toBe(422);
    expect(ecrituresDe()).toEqual([]);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });

  it('rang déjà lié à une tournée → 422 « rechargez la fiche », aucune écriture', async () => {
    admin.results['collectes'] = { data: collecte2Camions, error: null };
    admin.results['collecte_tournees'] = lienRang1;
    const res = await PATCH(
      makeReq({ tournees: [{ rang: 1, chauffeur_nom: 'X' }] }),
      ctx,
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /rechargez la fiche/,
    );
    expect(ecrituresDe()).toEqual([]);
  });

  it('collecte sans prestataire logistique → 422 explicite, aucune écriture', async () => {
    admin.results['collectes'] = {
      data: { ...collecte2Camions, prestataire_logistique_id: null },
      error: null,
    };
    admin.results['collecte_tournees'] = { data: [], error: null };
    const res = await PATCH(
      makeReq({ tournees: [{ rang: 1, chauffeur_nom: 'X' }] }),
      ctx,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/prestataire/);
    expect(ecrituresDe()).toEqual([]);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });

  it.each(['realisee', 'cloturee', 'annulee', 'realisee_sans_collecte'])(
    'collecte terminée (%s) : un item { rang } → 422, aucune tournée créée (les tournées existantes restent corrigeables)',
    async (statut) => {
      admin.results['collectes'] = {
        data: { ...collecte2Camions, statut },
        error: null,
      };
      admin.results['collecte_tournees'] = lienRang1;
      const res = await PATCH(
        makeReq({ tournees: [{ rang: 2, chauffeur_nom: 'X' }] }),
        ctx,
      );
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(
        /terminée/,
      );
      expect(ecrituresDe()).toEqual([]);

      // La tournée existante, elle, se corrige toujours.
      admin = makeClient();
      admin.results['collectes'] = {
        data: { ...collecte2Camions, statut },
        error: null,
      };
      admin.results['collecte_tournees'] = lienRang1;
      const ok = await PATCH(
        makeReq({ tournees: [{ tournee_id: 'T1', chauffeur_nom: 'X' }] }),
        ctx,
      );
      expect(ok.status).toBe(200);
      expect(ecrituresDe().map((e) => `${e.table}.${e.op}`)).toEqual([
        'tournees.update',
      ]);
    },
  );

  it('item { rang } sans aucune coordonnée (champs vides) → 422, aucune tournée créée', async () => {
    admin.results['collectes'] = { data: collecte2Camions, error: null };
    admin.results['collecte_tournees'] = lienRang1;
    const res = await PATCH(
      makeReq({
        tournees: [
          { tournee_id: 'T1', chauffeur_nom: 'Paul' },
          {
            rang: 2,
            plaque_immatriculation: '',
            chauffeur_nom: '  ',
            chauffeur_telephone: '',
          },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/camion 2/);
    expect(ecrituresDe()).toEqual([]);
  });

  it('validation complète avant toute écriture : item 1 valide (rang), item 2 invalide (tournee_id inconnu) → 422 et rien n’est créé', async () => {
    admin.results['collectes'] = { data: collecte2Camions, error: null };
    admin.results['collecte_tournees'] = { data: [], error: null };
    admin.results['tournees'] = { data: { id: 'T-NEW' }, error: null };
    const res = await PATCH(
      makeReq({
        tournees: [
          { rang: 1, chauffeur_nom: 'Léa' },
          { tournee_id: 'T-INCONNUE', chauffeur_nom: 'X' },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(422);
    expect(ecrituresDe()).toEqual([]);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });

  it('le même rang deux fois dans le body → 422, aucune écriture', async () => {
    admin.results['collectes'] = { data: collecte2Camions, error: null };
    admin.results['collecte_tournees'] = { data: [], error: null };
    const res = await PATCH(
      makeReq({
        tournees: [
          { rang: 1, chauffeur_nom: 'A' },
          { rang: 1, chauffeur_nom: 'B' },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(422);
    expect(ecrituresDe()).toEqual([]);
  });

  it('deux camions nouveaux, le lien du 2e tombe en 23505 : le 1er a déjà reçu ses coordonnées (jamais de tournée créée sans coordonnées), 409 renvoyé', async () => {
    admin.results['collectes'] = { data: collecte2Camions, error: null };
    admin.results['collecte_tournees'] = { data: [], error: null };
    admin.results['tournees'] = { data: { id: 'T-ADM' }, error: null };
    admin.resultsEcriture['collecte_tournees.insert'] = (n) =>
      n === 2
        ? {
            data: null,
            error: { code: '23505', message: 'uniq_collecte_tournee_rang' },
          }
        : { data: null, error: null };
    const res = await PATCH(
      makeReq({
        tournees: [
          { rang: 1, chauffeur_nom: 'Paul' },
          { rang: 2, chauffeur_nom: 'Léa' },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(409);
    expect(ecrituresDe().map((e) => `${e.table}.${e.op}`)).toEqual([
      'tournees.upsert',
      'collecte_tournees.insert',
      'tournees.update',
      'tournees.upsert',
      'collecte_tournees.insert',
      'tournees.delete',
    ]);
    expect(ecrituresDe('update')[0]!.payload).toEqual({
      chauffeur_nom: 'Paul',
    });
    // Les coordonnées du camion 1 sont écrites : elles sont auditées malgré le 409.
    const audit = admin.ecritures.find((e) => e.table === 'audit_log');
    expect(audit?.payload).toMatchObject({
      action: 'infos_acces_chauffeur_maj',
      new_values: {
        tournees: [{ tourneeId: 'T-ADM', updates: { chauffeur_nom: 'Paul' } }],
        tournees_creees: [{ rang: 1, tournee_id: 'T-ADM' }],
      },
    });
    expect(mockEvaluer).not.toHaveBeenCalled();
  });

  it('course avec l’adapter : le rang a été lié entre la lecture et l’écriture (23505 sur le lien) → 409 « rechargez », tournée Admin retirée, lien du prestataire intact, aucune coordonnée écrite', async () => {
    admin.results['collectes'] = { data: collecte2Camions, error: null };
    admin.results['collecte_tournees'] = lienRang1;
    admin.results['tournees'] = { data: { id: 'T-ADM' }, error: null };
    admin.resultsEcriture['collecte_tournees.insert'] = {
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "uniq_collecte_tournee_rang"',
      },
    };
    const res = await PATCH(
      makeReq({ tournees: [{ rang: 2, chauffeur_nom: 'Léa' }] }),
      ctx,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /rechargez la fiche/,
    );
    expect(ecrituresDe().map((e) => `${e.table}.${e.op}`)).toEqual([
      'tournees.upsert',
      'collecte_tournees.insert',
      'tournees.delete',
    ]);
    // Jamais un upsert du lien (il aurait DÉTACHÉ la tournée du prestataire).
    expect(ecrituresDe('upsert').map((e) => e.table)).toEqual(['tournees']);
    const suppression = ecrituresDe('delete')[0]!;
    expect(suppression.filtres).toEqual({
      id: 'T-ADM',
      reference_interne: 'ADM-coll-1-2',
    });
    expect(ecrituresDe('update')).toEqual([]);
    expect(admin.ecritures.some((e) => e.table === 'audit_log')).toBe(false);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });
});
