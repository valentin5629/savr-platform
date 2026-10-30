/**
 * Fiche organisation Admin (Val 2026-10-30) : l'équipe Savr ajoute un domaine
 * email (vérifié d'emblée), retire ou rétablit sa vérification, le retire, et
 * ajoute ou modifie une entité de facturation.
 *
 * Chaque écriture tourne sous service_role : le périmètre organisation est
 * porté par `.eq('organisation_id', <id de l'URL>)`, vérifié ici appel par appel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Appel = { table: string; methode: string; args: unknown[] };
const appels: Appel[] = [];
// Résultats par table, consommés dans l'ordre des requêtes terminées.
const resultats: Record<string, { data: unknown; error: unknown }[]> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const suivant = () =>
    Promise.resolve(resultats[table]?.shift() ?? { data: null, error: null });
  for (const m of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'neq',
    'order',
  ]) {
    b[m] = (...args: unknown[]) => {
      appels.push({ table, methode: m, args });
      return b;
    };
  }
  b.maybeSingle = () => suivant();
  b.single = () => suivant();
  b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    suivant().then(ok, ko);
  return b;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from: (t: string) => builder(t) }),
}));

const mockVerifySiret = vi.fn();
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
vi.mock('@savr/shared/src/api/siret.js', () => ({
  verifySiret: (...a: unknown[]) => mockVerifySiret(...a),
  isValidSiretFormat: (s: string) => /^\d{14}$/.test(s),
}));
vi.mock('@savr/shared/src/siret/revalidation.js', () => ({
  enqueueSiretRevalidation: (...a: unknown[]) => mockEnqueue(...a),
}));

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string) {
  const payload = Buffer.from(
    JSON.stringify({ user_role: role, organisation_id: null }),
  ).toString('base64url');
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-staff-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: `header.${payload}.sig` } },
    error: null,
  });
}

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/v1/admin/x', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const appelsDe = (table: string, methode: string) =>
  appels.filter((a) => a.table === table && a.methode === methode);

function perimetre(table: string) {
  return appelsDe(table, 'eq').filter((a) => a.args[0] === 'organisation_id');
}

beforeEach(() => {
  appels.length = 0;
  for (const k of Object.keys(resultats)) delete resultats[k];
  vi.clearAllMocks();
  setupAuth('admin_savr');
});

const DOM = 'organisations_domaines_email';

describe('POST domaines-email (Admin)', () => {
  async function post(body: unknown) {
    const { POST } =
      await import('@/app/api/v1/admin/organisations/[id]/domaines-email/route.js');
    return POST(req('POST', body), {
      params: Promise.resolve({ id: 'org-1' }),
    });
  }

  it('201 : domaine normalisé, rattaché à l’organisation de l’URL, vérifié d’emblée, audité', async () => {
    resultats.domaines_email_publics = [{ data: null, error: null }];
    resultats[DOM] = [
      {
        data: { id: 'd-1', domaine: 'arep.fr', verifie_at: 'x' },
        error: null,
      },
    ];
    const res = await post({ domaine: ' @AREP.fr ', organisation_id: 'org-2' });
    expect(res.status).toBe(201);
    const ins = appelsDe(DOM, 'insert')[0]?.args[0] as Record<string, unknown>;
    expect(ins.organisation_id).toBe('org-1');
    expect(ins.domaine).toBe('arep.fr');
    expect(typeof ins.verifie_at).toBe('string');
    expect(appelsDe('audit_log', 'insert')).toHaveLength(1);
  });

  it('422 domaine public (gmail.com), aucun INSERT', async () => {
    resultats.domaines_email_publics = [
      { data: { domaine: 'gmail.com' }, error: null },
    ];
    const res = await post({ domaine: 'gmail.com' });
    expect(res.status).toBe(422);
    expect(appelsDe(DOM, 'insert')).toHaveLength(0);
  });

  it('422 domaine jetable, aucun INSERT', async () => {
    const res = await post({ domaine: 'yopmail.com' });
    expect(res.status).toBe(422);
    expect(appelsDe(DOM, 'insert')).toHaveLength(0);
  });

  it('422 format invalide', async () => {
    const res = await post({ domaine: 'pas un domaine' });
    expect(res.status).toBe(422);
  });

  it('409 domaine déjà rattaché (unicité globale)', async () => {
    resultats.domaines_email_publics = [{ data: null, error: null }];
    resultats[DOM] = [{ data: null, error: { code: '23505' } }];
    const res = await post({ domaine: 'arep.fr' });
    expect(res.status).toBe(409);
  });

  it('403 pour un rôle client', async () => {
    setupAuth('traiteur_manager');
    const res = await post({ domaine: 'arep.fr' });
    expect(res.status).toBe(403);
    expect(appelsDe(DOM, 'insert')).toHaveLength(0);
  });
});

describe('PATCH / DELETE domaines-email/[domaineId] (Admin)', () => {
  const params = Promise.resolve({ id: 'org-1', domaineId: 'd-1' });
  async function route() {
    return import('@/app/api/v1/admin/organisations/[id]/domaines-email/[domaineId]/route.js');
  }

  it('PATCH verifie=false : retire la vérification, bornée à l’organisation, auditée', async () => {
    resultats[DOM] = [
      { data: { id: 'd-1', verifie_at: 'x' }, error: null },
      { data: { id: 'd-1', verifie_at: null }, error: null },
    ];
    const { PATCH } = await route();
    const res = await PATCH(req('PATCH', { verifie: false }), { params });
    expect(res.status).toBe(200);
    expect(appelsDe(DOM, 'update')[0]?.args[0]).toEqual({ verifie_at: null });
    expect(perimetre(DOM).every((a) => a.args[1] === 'org-1')).toBe(true);
    expect(perimetre(DOM)).toHaveLength(2);
    expect(appelsDe('audit_log', 'insert')).toHaveLength(1);
  });

  it('PATCH 404 si le domaine n’est pas dans cette organisation, aucun UPDATE', async () => {
    resultats[DOM] = [{ data: null, error: null }];
    const { PATCH } = await route();
    const res = await PATCH(req('PATCH', { verifie: true }), { params });
    expect(res.status).toBe(404);
    expect(appelsDe(DOM, 'update')).toHaveLength(0);
  });

  it('PATCH 422 sans booléen', async () => {
    const { PATCH } = await route();
    const res = await PATCH(req('PATCH', { verifie: 'oui' }), { params });
    expect(res.status).toBe(422);
  });

  it('DELETE borné à l’organisation, audité ; 404 hors organisation', async () => {
    resultats[DOM] = [
      { data: { id: 'd-1', domaine: 'arep.fr' }, error: null },
      { data: null, error: null },
    ];
    const { DELETE } = await route();
    const ok = await DELETE(req('DELETE'), { params });
    expect(ok.status).toBe(200);
    expect(perimetre(DOM)[0]?.args[1]).toBe('org-1');
    expect(appelsDe('audit_log', 'insert')).toHaveLength(1);
    const ko = await DELETE(req('DELETE'), { params });
    expect(ko.status).toBe(404);
  });
});

const EF = 'entites_facturation';
const ENTITE = {
  raison_sociale: 'AREP SARL',
  siret: '123 456 789 00012',
  adresse_facturation: '1 rue X',
  code_postal: '75001',
  ville: 'Paris',
};

describe('POST entites-facturation (Admin)', () => {
  async function post(body: unknown) {
    const { POST } =
      await import('@/app/api/v1/admin/organisations/[id]/entites-facturation/route.js');
    return POST(req('POST', body), {
      params: Promise.resolve({ id: 'org-1' }),
    });
  }

  it('201 : organisation de l’URL, SIRET sans espaces vérifié INSEE, par défaut = autres dé-flaguées dans l’organisation', async () => {
    mockVerifySiret.mockResolvedValue('verifie');
    resultats[EF] = [
      { data: null, error: null }, // doublon
      { data: null, error: null }, // dé-flag
      { data: { id: 'ef-1' }, error: null }, // insert
    ];
    const res = await post({
      ...ENTITE,
      entite_par_defaut: true,
      organisation_id: 'org-2',
    });
    expect(res.status).toBe(201);
    expect(mockVerifySiret).toHaveBeenCalledWith('12345678900012');
    const ins = appelsDe(EF, 'insert')[0]?.args[0] as Record<string, unknown>;
    expect(ins.organisation_id).toBe('org-1');
    expect(ins.siret_verification).toBe('verifie');
    expect(appelsDe(EF, 'update')[0]?.args[0]).toEqual({
      entite_par_defaut: false,
    });
    expect(perimetre(EF)[0]?.args[1]).toBe('org-1');
    expect(appelsDe('audit_log', 'insert')).toHaveLength(1);
  });

  it('échec du dé-flag : arrêt, aucune création', async () => {
    mockVerifySiret.mockResolvedValue('verifie');
    resultats[EF] = [
      { data: null, error: null }, // doublon
      { data: null, error: { code: 'XX000' } }, // dé-flag
    ];
    const res = await post({ ...ENTITE, entite_par_defaut: true });
    expect(res.status).not.toBe(201);
    expect(appelsDe(EF, 'insert')).toHaveLength(0);
  });

  it('422 SIRET rejeté par l’INSEE, aucun INSERT', async () => {
    mockVerifySiret.mockResolvedValue('echec');
    resultats[EF] = [{ data: null, error: null }];
    const res = await post(ENTITE);
    expect(res.status).toBe(422);
    expect(appelsDe(EF, 'insert')).toHaveLength(0);
  });

  it('409 SIRET déjà utilisé', async () => {
    resultats[EF] = [{ data: { id: 'autre' }, error: null }];
    const res = await post(ENTITE);
    expect(res.status).toBe(409);
    expect(mockVerifySiret).not.toHaveBeenCalled();
  });

  it('INSEE injoignable : en_attente + revalidation planifiée', async () => {
    mockVerifySiret.mockResolvedValue('down');
    resultats[EF] = [
      { data: null, error: null },
      { data: { id: 'ef-1' }, error: null },
    ];
    const res = await post(ENTITE);
    expect(res.status).toBe(201);
    const ins = appelsDe(EF, 'insert')[0]?.args[0] as Record<string, unknown>;
    expect(ins.siret_verification).toBe('en_attente');
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('422 champ requis manquant', async () => {
    const res = await post({ ...ENTITE, ville: ' ' });
    expect(res.status).toBe(422);
  });
});

describe('PATCH entites-facturation/[entiteId] (Admin)', () => {
  const params = Promise.resolve({ id: 'org-1', entiteId: 'ef-1' });
  async function patch(body: unknown) {
    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/entites-facturation/[entiteId]/route.js');
    return PATCH(req('PATCH', body), { params });
  }

  it('404 si l’entité n’est pas dans cette organisation, aucune écriture', async () => {
    resultats[EF] = [{ data: null, error: null }];
    const res = await patch({ raison_sociale: 'X', entite_par_defaut: true });
    expect(res.status).toBe(404);
    expect(appelsDe(EF, 'update')).toHaveLength(0);
  });

  it('SIRET inchangé : aucune revérification ; champs hors liste ignorés', async () => {
    resultats[EF] = [
      { data: { id: 'ef-1', siret: '12345678900012' }, error: null },
      { data: { id: 'ef-1' }, error: null },
    ];
    const res = await patch({
      siret: '12345678900012',
      ville: 'Lyon',
      organisation_id: 'org-2',
      siret_verification: 'verifie',
    });
    expect(res.status).toBe(200);
    expect(mockVerifySiret).not.toHaveBeenCalled();
    expect(appelsDe(EF, 'update')[0]?.args[0]).toEqual({ ville: 'Lyon' });
    // lecture ciblée + UPDATE : deux bornes, toutes sur l'organisation de l'URL
    expect(perimetre(EF)).toHaveLength(2);
    expect(perimetre(EF).every((a) => a.args[1] === 'org-1')).toBe(true);
    expect(appelsDe('audit_log', 'insert')).toHaveLength(1);
  });

  it('par défaut : les autres entités de CETTE organisation perdent le drapeau, sauf la cible', async () => {
    resultats[EF] = [
      { data: { id: 'ef-1', siret: 's', actif: true }, error: null },
      { data: null, error: null }, // dé-flag
      { data: { id: 'ef-1' }, error: null }, // UPDATE
    ];
    const res = await patch({ entite_par_defaut: true });
    expect(res.status).toBe(200);
    const updates = appelsDe(EF, 'update');
    expect(updates[0]?.args[0]).toEqual({ entite_par_defaut: false });
    expect(updates[1]?.args[0]).toEqual({ entite_par_defaut: true });
    expect(appelsDe(EF, 'neq')[0]?.args).toEqual(['id', 'ef-1']);
    expect(perimetre(EF)).toHaveLength(3);
    expect(perimetre(EF).every((a) => a.args[1] === 'org-1')).toBe(true);
  });

  it('entité désactivée déjà par défaut : reste modifiable, drapeau inchangé', async () => {
    resultats[EF] = [
      {
        data: { id: 'ef-1', siret: 's', actif: false, entite_par_defaut: true },
        error: null,
      },
      { data: { id: 'ef-1' }, error: null },
    ];
    const res = await patch({ entite_par_defaut: true, ville: 'Lyon' });
    expect(res.status).toBe(200);
    expect(appelsDe(EF, 'update')).toHaveLength(1);
    expect(appelsDe(EF, 'update')[0]?.args[0]).toEqual({ ville: 'Lyon' });
  });

  it('par défaut refusé (422) sur une entité désactivée, aucune écriture', async () => {
    resultats[EF] = [
      { data: { id: 'ef-1', siret: 's', actif: false }, error: null },
    ];
    const res = await patch({ entite_par_defaut: true });
    expect(res.status).toBe(422);
    expect(appelsDe(EF, 'update')).toHaveLength(0);
  });

  it('échec du dé-flag : arrêt, l’entité n’est pas écrite', async () => {
    resultats[EF] = [
      { data: { id: 'ef-1', siret: 's', actif: true }, error: null },
      { data: null, error: { code: 'XX000' } },
    ];
    const res = await patch({ entite_par_defaut: true });
    expect(res.status).toBe(422); // writeError
    expect(appelsDe(EF, 'update')).toHaveLength(1);
  });

  it('SIRET changé : revérifié ; échec INSEE → 422 sans UPDATE', async () => {
    mockVerifySiret.mockResolvedValue('echec');
    resultats[EF] = [
      { data: { id: 'ef-1', siret: '12345678900012' }, error: null },
      { data: null, error: null },
    ];
    const res = await patch({ siret: '98765432100019' });
    expect(res.status).toBe(422);
    expect(appelsDe(EF, 'update')).toHaveLength(0);
  });

  it('422 champ requis vidé', async () => {
    const res = await patch({ raison_sociale: '' });
    expect(res.status).toBe(422);
  });
});
