/**
 * M4.2 — Tests Vitest : registre réglementaire ZD (§06.03).
 * Couvre (couche api) : auth (401 / agence 403), liste, export CSV tracé +
 * format FR, export ZIP bordereaux (50 ok / 51 refus 422 / 0 refus 422),
 * téléchargement bordereau (200 + URL pré-signée / hors périmètre 404),
 * export CSV 0 ligne (en-têtes seules). Génération R2 mockée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data?: unknown; count?: number; error?: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result =>
    queue.shift() ?? { data: null, count: 0, error: null };
  const chain: Record<string, unknown> = {
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'gte',
    'lte',
    'neq',
    'order',
    'overlaps',
    'or',
    'range',
    'schema',
    'is',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.insert = (...args: unknown[]) => {
    record('insert', args);
    return chain;
  };
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    record('rpc', args);
    return Promise.resolve(next());
  };
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    schema: (...a: unknown[]) =>
      (rls.schema as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: vi.fn(async () => Buffer.from('%PDF-1.4 fake pdf bytes')),
  getPresignedUrl: vi.fn(async () => 'https://r2.example/signed-url'),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId: string | null = 'org-a') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt(
          organisationId
            ? { user_role: role, organisation_id: organisationId }
            : { user_role: role },
        ),
      },
    },
    error: null,
  });
}
function noAuth() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}
function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}
async function callList(query = '') {
  const { GET } = await import('@/app/api/v1/registre/route.js');
  return GET(makeReq(`/api/v1/registre${query}`));
}
async function callCsv(query = '') {
  const { GET } = await import('@/app/api/v1/registre/export-csv/route.js');
  return GET(makeReq(`/api/v1/registre/export-csv${query}`));
}
async function callZip(query = '') {
  const { GET } = await import('@/app/api/v1/registre/export-zip/route.js');
  return GET(makeReq(`/api/v1/registre/export-zip${query}`));
}
async function callDownload(id: string) {
  const { GET } =
    await import('@/app/api/v1/registre/bordereaux/[id]/download/route.js');
  return GET(makeReq(`/api/v1/registre/bordereaux/${id}/download`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
});

// ── Auth ────────────────────────────────────────────────────────────────────
describe('M4.2 / garde', () => {
  it('M4.2/acces_registre_non_authentifie_401', async () => {
    noAuth();
    expect((await callList()).status).toBe(401);
  });

  it('M4.2/registre_agence_denied — agence refusée (403)', async () => {
    setupAuth('agence', 'org-a');
    expect((await callList()).status).toBe(403);
  });

  it('M4.2/liste_registre_200 — manager voit ses lignes', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({ data: [{ collecte_id: 'c1' }], count: 1, error: null });
    const res = await callList('?page=1&limit=25');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; rows: unknown[] };
    expect(body.total).toBe(1);
    expect(body.rows).toHaveLength(1);
  });
});

// ── Export CSV (P1 export_csv_registre_filtre_trace) ─────────────────────────
// Référentiel des flux tel que le pose la migration 20261004203000.
const REF_BIODECHET = {
  code: 'biodechet',
  nom: 'Biodéchets',
  code_dechet_europeen: '20 01 08',
  filiere_valorisation: 'methanisation',
  code_traitement: 'R3',
  exutoire: 'GENERIS VSG DCDT',
  exutoire_adresse:
    'ZI des Graviers, 6 avenue Winston Churchill, 94190 Villeneuve-Saint-Georges',
};
const REF_VERRE = {
  code: 'verre',
  nom: 'Verre',
  code_dechet_europeen: '15 01 07',
  filiere_valorisation: 'recyclage',
  code_traitement: 'R5',
  exutoire: 'REVIVAL GENNEVILLIERS TRSFT',
  exutoire_adresse: '9 route du Môle Central, 92230 Gennevilliers',
};
const REF_CARTON = {
  code: 'carton',
  nom: 'Cartons',
  code_dechet_europeen: '15 01 01',
  filiere_valorisation: 'recyclage',
  code_traitement: 'R3',
  exutoire: 'TAIS VILLENEUVE LE ROI TDI',
  exutoire_adresse: '6 rue des Vœux Saint-Georges, 94290 Villeneuve-le-Roi',
};
const LIGNE_REGISTRE = {
  collecte_id: 'c1',
  date_evenement: '2026-05-12',
  date_collecte: '2026-05-13',
  lieu_nom: 'Pavillon Cambon',
  traiteur_raison_sociale: 'Kaspia SARL',
  flux_codes: ['biodechet', 'verre'],
  poids_total_kg: 504.7,
  exutoire_nom: 'Prestataire Savr',
  bordereau_numero: 'BSAV-2026-00001',
  bordereau_statut: 'emis',
};
const EN_TETES_CSV = [
  'Nature du déchet',
  'Code nomenclature déchets',
  'Identité du producteur de déchet',
  "Date d'expédition",
  'Quantité (tonnage)',
  'Filière de traitement finale',
  'Code D&R de traitement finale',
  'Numéro de BSD',
  'Transporteur - Nom',
  'Transporteur - Adresse',
  'Transporteur - Code postal',
  'Transporteur - Ville',
  'Exutoire intermédiaire - Nom',
  'Exutoire intermédiaire - Adresse',
  'Exutoire intermédiaire - Code postal',
  'Exutoire intermédiaire - Ville',
  'Exutoire final - Nom',
  'Exutoire final - Adresse',
  'Exutoire final - Code postal',
  'Exutoire final - Ville',
  'Lieu',
  'Traiteur',
  'Date événement',
  'N° bordereau',
].join(';');

async function lignesCsv(res: Response): Promise<string[]> {
  const text = new TextDecoder().decode(
    new Uint8Array(await res.arrayBuffer()),
  );
  return text.split('\r\n');
}

describe('M4.2 / export_csv_registre_filtre_trace', () => {
  it('CSV 200 + format FR + trace exports_registre', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({ data: [LIGNE_REGISTRE], count: 1, error: null });
    rls.push({
      data: [
        { collecte_id: 'c1', poids_reel_kg: 468.7, flux_dechets: REF_VERRE },
        { collecte_id: 'c1', poids_reel_kg: 36, flux_dechets: REF_BIODECHET },
      ],
      error: null,
    });
    rls.push({ error: null }); // trace insert

    const res = await callCsv('?from=2026-05-01&to=2026-05-31&flux=biodechet');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toMatch(
      /registre-savr-\d{8}\.csv/,
    );

    const buf = new Uint8Array(await res.clone().arrayBuffer());
    expect(Array.from(buf.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // BOM
    const [header, ...lignes] = await lignesCsv(res);
    expect(header).toBe(EN_TETES_CSV);
    expect(lignes).toHaveLength(2); // une ligne par flux pesé

    // Trace exports_registre : type registre_dechets, format csv, nb_lignes =
    // lignes de données du fichier (2 flux), pas le nombre de collectes (1).
    const insertArgs = (rls.__calls.insert ?? [])[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertArgs?.type_export).toBe('registre_dechets');
    expect(insertArgs?.format).toBe('csv');
    expect(insertArgs?.nb_lignes).toBe(2);
    expect(insertArgs?.user_id).toBe('user-1');
    expect(insertArgs?.organisation_id).toBe('org-a');
  });

  it('M4.2/export_csv_ligne_par_flux — une ligne par flux pesé, 20 colonnes du modèle + 4 colonnes Savr', async () => {
    setupAuth('gestionnaire_lieux', 'org-a');
    rls.push({ data: [LIGNE_REGISTRE], count: 1, error: null });
    rls.push({
      data: [
        // Rendus dans le désordre, avec un flux à 0 et un flux non pesé.
        { collecte_id: 'c1', poids_reel_kg: 468.7, flux_dechets: REF_VERRE },
        { collecte_id: 'c1', poids_reel_kg: 0, flux_dechets: REF_CARTON },
        { collecte_id: 'c1', poids_reel_kg: 36, flux_dechets: REF_BIODECHET },
        {
          collecte_id: 'c1',
          poids_reel_kg: null,
          flux_dechets: { code: 'emballage', nom: 'Emballages' },
        },
      ],
      error: null,
    });
    rls.push({ error: null });

    const [, ...lignes] = await lignesCsv(await callCsv());
    const entrepot = '3 rue du Fort de la Briche;93200;Saint-Denis';
    expect(lignes).toEqual([
      [
        'Biodéchets;20 01 08;Pavillon Cambon;13/05/2026;0,036;Méthanisation;R3;BSAV-2026-00001',
        `Savr;${entrepot}`,
        `Entrepôt Savr;${entrepot}`,
        'GENERIS VSG DCDT;ZI des Graviers, 6 avenue Winston Churchill;94190;Villeneuve-Saint-Georges',
        'Pavillon Cambon;Kaspia SARL;12/05/2026;BSAV-2026-00001',
      ].join(';'),
      [
        'Verre;15 01 07;Pavillon Cambon;13/05/2026;0,4687;Recyclage;R5;BSAV-2026-00001',
        `Savr;${entrepot}`,
        `Entrepôt Savr;${entrepot}`,
        'REVIVAL GENNEVILLIERS TRSFT;9 route du Môle Central;92230;Gennevilliers',
        'Pavillon Cambon;Kaspia SARL;12/05/2026;BSAV-2026-00001',
      ].join(';'),
    ]);
  });

  it('M4.2/export_csv_flux_par_tranches — les identifiants de collecte partent par tranches de 100', async () => {
    setupAuth('admin_savr', null);
    const collectes = Array.from({ length: 250 }, (_, i) => ({
      ...LIGNE_REGISTRE,
      collecte_id: `c${i}`,
    }));
    rls.push({ data: collectes, count: 250, error: null });
    // Une pesée dans chaque tranche : la 1re, la 2e et la 3e doivent toutes sortir.
    for (const id of ['c0', 'c100', 'c249']) {
      rls.push({
        data: [{ collecte_id: id, poids_reel_kg: 10, flux_dechets: REF_VERRE }],
        error: null,
      });
    }

    const [, ...lignes] = await lignesCsv(await callCsv());
    const tranches = (rls.__calls.in ?? []).map((a) => a[1] as string[]);
    expect(tranches.map((t) => t.length)).toEqual([100, 100, 50]);
    expect(tranches.flat()).toEqual(collectes.map((c) => c.collecte_id));
    expect(lignes).toHaveLength(3);
  });

  it('M4.2/export_csv_adresse_exutoire — adresse découpée, format inconnu laissé entier', async () => {
    const { decouperAdresse } = await import('@/lib/registre/csv.js');
    expect(
      decouperAdresse('10 rue de la Victoire, 93150 Le Blanc-Mesnil'),
    ).toEqual({
      voie: '10 rue de la Victoire',
      codePostal: '93150',
      ville: 'Le Blanc-Mesnil',
    });
    // Un nombre à 5 chiffres dans la voie n'est pas pris pour le code postal.
    expect(
      decouperAdresse('BP 12345, 2 rue du Port, 95100 Argenteuil'),
    ).toEqual({
      voie: 'BP 12345, 2 rue du Port',
      codePostal: '95100',
      ville: 'Argenteuil',
    });
    expect(decouperAdresse('Zone portuaire de Gennevilliers')).toEqual({
      voie: 'Zone portuaire de Gennevilliers',
      codePostal: '',
      ville: '',
    });
    expect(decouperAdresse(null)).toEqual({
      voie: '',
      codePostal: '',
      ville: '',
    });
  });

  it('M4.2/export_csv_zero_ligne_entetes_seules', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({ data: [], count: 0, error: null }); // 0 collecte → aucune lecture des flux
    rls.push({ error: null }); // trace insert
    const res = await callCsv('?from=2026-01-01&to=2026-01-31');
    expect(res.status).toBe(200);
    const lignes = (await lignesCsv(res)).filter(Boolean);
    expect(lignes).toEqual([EN_TETES_CSV]); // en-têtes seules
    const insertArgs = (rls.__calls.insert ?? [])[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertArgs?.nb_lignes).toBe(0);
  });
});

// ── Export ZIP (P1 export_zip_bordereaux_periode + cas limites) ──────────────
describe('M4.2 / export_zip_bordereaux_periode', () => {
  function pushRows() {
    rls.push({
      data: [{ collecte_id: 'c1', date_evenement: '2026-04-10' }],
      count: 1,
      error: null,
    });
  }
  // Forme réelle : bordereaux_savr.pdf_fichier_id → shared.fichiers (bucket/key).
  // Pas de colonne `url` ni d'embed cross-schema (G7 column-db).
  function bords(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      numero: `BSAV-2026-${String(i).padStart(5, '0')}`,
      pdf_fichier_id: `f${i}`,
    }));
  }
  function fichiers(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `f${i}`,
      bucket: 'bordereaux',
      key: `b${i}.pdf`,
    }));
  }

  it('zip_exactement_50_bordereaux_ok + trace bordereaux_batch', async () => {
    setupAuth('traiteur_manager', 'org-a');
    pushRows();
    rls.push({ data: bords(50), error: null });
    rls.push({ data: fichiers(50), error: null }); // shared.fichiers
    rls.push({ error: null }); // trace
    const res = await callZip('?from=2026-04-01&to=2026-05-31');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    // Colonnes sélectionnées (G7) : jamais `fichiers:pdf_fichier_id(url)`.
    const selects = (rls.__calls.select ?? []).map((c) => c[0]);
    expect(selects).toContain('numero, pdf_fichier_id');
    expect(selects).toContain('id, bucket, key');
    expect(selects.join('|')).not.toContain('url');
    expect(rls.__calls.schema).toEqual([['shared']]);
    const { getObjectBytes } = await import('@/lib/pdf/r2-client.js');
    expect(getObjectBytes).toHaveBeenCalledTimes(50);
    expect(getObjectBytes).toHaveBeenCalledWith('bordereaux/b0.pdf');
    const insertArgs = (rls.__calls.insert ?? [])[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertArgs?.type_export).toBe('bordereaux_batch');
    expect(insertArgs?.format).toBe('zip');
    expect(insertArgs?.nb_lignes).toBe(50);
  });

  it('M4.2/zip_51_bordereaux_refuse — 422 + aucune trace', async () => {
    setupAuth('traiteur_manager', 'org-a');
    pushRows();
    rls.push({ data: bords(51), error: null });
    const res = await callZip('?from=2026-04-01&to=2026-05-31');
    expect(res.status).toBe(422);
    expect(rls.__calls.insert).toBeUndefined();
  });

  it('M4.2/zip_zero_bordereau_refuse_message — 422', async () => {
    setupAuth('traiteur_manager', 'org-a');
    pushRows();
    rls.push({ data: [], error: null });
    const res = await callZip('?from=2026-04-01&to=2026-05-31');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Aucun bordereau');
  });
});

// ── Téléchargement bordereau ─────────────────────────────────────────────────
describe('M4.2 / telechargement_pdf_bordereau_depuis_liste', () => {
  it('200 + URL pré-signée', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({
      data: { id: 'b1', statut: 'emis', pdf_fichier_id: 'f1' },
      error: null,
    });
    rls.push({
      data: [{ id: 'f1', bucket: 'bordereaux', key: 'b1.pdf' }],
      error: null,
    }); // shared.fichiers
    const res = await callDownload('b1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expires_in: number };
    expect(body.url).toBe('https://r2.example/signed-url');
    expect(body.expires_in).toBe(900);
    // Colonnes sélectionnées (G7) + clé R2 reconstruite depuis bucket/key.
    expect((rls.__calls.select ?? []).map((c) => c[0])).toEqual([
      'id, statut, pdf_fichier_id',
      'id, bucket, key',
    ]);
    expect(rls.__calls.schema).toEqual([['shared']]);
    expect(rls.__calls.from).toEqual([['bordereaux_savr'], ['fichiers']]);
    const { getPresignedUrl } = await import('@/lib/pdf/r2-client.js');
    expect(getPresignedUrl).toHaveBeenCalledWith('bordereaux/b1.pdf', 900);
  });

  it('fichier PDF absent de shared.fichiers (hors périmètre / supprimé) — 404', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({
      data: { id: 'b1', statut: 'emis', pdf_fichier_id: 'f1' },
      error: null,
    });
    rls.push({ data: [], error: null }); // fichiers_select filtre la ligne
    const res = await callDownload('b1');
    expect(res.status).toBe(404);
  });

  it('M4.2/url_directe_bordereau_hors_perimetre_deny — 404 (RLS → null)', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({ data: null, error: null });
    const res = await callDownload('b-autre-org');
    expect(res.status).toBe(404);
  });
});

// ── Filtres à choix multiple (§06.03 « multi-select », décision Val 2026-09-30) ─
describe('M4.2 / filtres à choix multiple', () => {
  const UUID_A = '11111111-1111-4111-8111-111111111111';
  const UUID_B = '22222222-2222-4222-8222-222222222222';

  it('M4.2/registre_filtres_lieu_traiteur_csv — lieu / traiteur CSV → in(), non-UUID et flux inconnus écartés', async () => {
    setupAuth('gestionnaire_lieux', 'org-a');
    rls.push({ data: [], count: 0, error: null });
    const res = await callList(
      `?lieu=${UUID_A},${UUID_B},pas-un-uuid&traiteur=${UUID_A},x)&flux=biodechet,inconnu&bordereau=dispo`,
    );
    expect(res.status).toBe(200);
    const inCalls = rls.__calls.in ?? [];
    expect(inCalls).toContainEqual(['lieu_id', [UUID_A, UUID_B]]);
    expect(inCalls).toContainEqual([
      'traiteur_operationnel_organisation_id',
      [UUID_A],
    ]);
    expect(inCalls).toContainEqual(['bordereau_statut', ['emis', 'corrige']]);
    expect(rls.__calls.overlaps).toContainEqual(['flux_codes', ['biodechet']]);
  });

  it('M4.2/registre_filtres_valeurs_toutes_invalides — aucun in() vide', async () => {
    setupAuth('traiteur_manager', 'org-a');
    rls.push({ data: [], count: 0, error: null });
    await callList('?lieu=abc&traiteur=def&flux=zzz');
    expect(rls.__calls.in ?? []).toEqual([]);
    expect(rls.__calls.overlaps ?? []).toEqual([]);
  });

  it('M4.2/registre_options_perimetre_complet — lieux et traiteurs de toute la vue, dédoublonnés, triés, lus par tranches', async () => {
    setupAuth('gestionnaire_lieux', 'org-a');
    rls.push({
      data: [
        {
          collecte_id: 'c1',
          lieu_id: 'l2',
          lieu_nom: 'Salle Wagram',
          traiteur_operationnel_organisation_id: 't1',
          traiteur_raison_sociale: 'Kaspia',
        },
        {
          collecte_id: 'c2',
          lieu_id: 'l1',
          lieu_nom: 'Pavillon Dauphine',
          traiteur_operationnel_organisation_id: 't1',
          traiteur_raison_sociale: 'Kaspia',
        },
        {
          collecte_id: 'c3',
          lieu_id: 'l2',
          lieu_nom: 'Salle Wagram',
          traiteur_operationnel_organisation_id: null,
          traiteur_raison_sociale: null,
        },
      ],
      error: null,
    });
    rls.push({ data: [], error: null }); // tranche suivante vide → fin
    const { GET } = await import('@/app/api/v1/registre/options/route.js');
    const res = await GET(makeReq('/api/v1/registre/options'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lieux: [
        { id: 'l1', nom: 'Pavillon Dauphine' },
        { id: 'l2', nom: 'Salle Wagram' },
      ],
      traiteurs: [{ id: 't1', nom: 'Kaspia' }],
    });
    // Même vue RLS-safe que la liste ; la 2e tranche repart après les lignes lues
    // (aucune troncature, quel que soit max_rows).
    expect(rls.__calls.from).toEqual([
      ['v_registre_dechets'],
      ['v_registre_dechets'],
    ]);
    expect(rls.__calls.range).toEqual([
      [0, 999],
      [3, 1002],
    ]);
  });

  it('M4.2/registre_options_garde — 401 sans session, agence refusée (403), aucune lecture', async () => {
    const { GET } = await import('@/app/api/v1/registre/options/route.js');
    noAuth();
    expect((await GET(makeReq('/api/v1/registre/options'))).status).toBe(401);
    setupAuth('agence', 'org-a');
    expect((await GET(makeReq('/api/v1/registre/options'))).status).toBe(403);
    expect(rls.__calls.from ?? []).toEqual([]);
  });
});
