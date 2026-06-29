/**
 * M4.1 — Tests Vitest : endpoint d'export CSV unifié /api/v1/exports/[entity].
 * Couvre : matrice d'autorisation par profil (P1 matrice_exports_csv_par_profil),
 * format CSV FR + double colonne dates (P2 export_csv_format_fr_et_filtres_actifs),
 * filtres actifs propagés, cloisonnement (clients = RLS jamais service_role,
 * staff = service_role), entité inconnue 404, non-authentifié 401.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };
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
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
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
let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockCreateAdmin = vi.fn(() => ({
  from: (...a: unknown[]) => (admin.from as (...x: unknown[]) => unknown)(...a),
  rpc: (...a: unknown[]) => (admin.rpc as (...x: unknown[]) => unknown)(...a),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockCreateAdmin(),
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
function params(entity: string) {
  return { params: Promise.resolve({ entity }) };
}
async function call(entity: string, query = '') {
  const { GET } = await import('@/app/api/v1/exports/[entity]/route.js');
  return GET(makeReq(`/api/v1/exports/${entity}${query}`), params(entity));
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
});

// ── Auth / entité ───────────────────────────────────────────────────────────
describe('M4.1 / garde', () => {
  it('M4.1/non_authentifie_401', async () => {
    noAuth();
    expect((await call('collectes')).status).toBe(401);
  });

  it('M4.1/entite_inconnue_404', async () => {
    setupAuth('admin_savr', null);
    expect((await call('inexistant')).status).toBe(404);
  });

  it('M4.1/courses_logistiques_hors_v1_404 — entité non exposée (tms.* V2)', async () => {
    setupAuth('admin_savr', null);
    expect((await call('courses-logistiques')).status).toBe(404);
  });
});

// ── Matrice d'autorisation (P1) ──────────────────────────────────────────────
describe('M4.1 / matrice_exports_csv_par_profil', () => {
  it('commercial → pesees : 403 (non autorisé)', async () => {
    setupAuth('traiteur_commercial');
    expect((await call('pesees')).status).toBe(403);
  });

  it('gestionnaire → collectes : 403 (export au grain événement uniquement)', async () => {
    setupAuth('gestionnaire_lieux');
    expect((await call('collectes')).status).toBe(403);
  });

  it('agence → associations-ag : 403', async () => {
    setupAuth('agence');
    expect((await call('associations-ag')).status).toBe(403);
  });

  it('client_organisateur → factures : 403', async () => {
    setupAuth('client_organisateur');
    expect((await call('factures')).status).toBe(403);
  });

  it('traiteur_manager → pesees : 200 (autorisé)', async () => {
    setupAuth('traiteur_manager');
    rls.push({ data: [], error: null });
    const res = await call('pesees');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
  });
});

// ── Cloisonnement : clients = RLS jamais service_role ────────────────────────
describe('M4.1 / cloisonnement', () => {
  it('client (RLS) : createAdminSupabaseClient JAMAIS appelé', async () => {
    setupAuth('traiteur_manager');
    rls.push({ data: [], error: null });
    await call('collectes');
    expect(mockCreateAdmin).not.toHaveBeenCalled();
  });

  it('staff : utilise service_role (createAdminSupabaseClient appelé)', async () => {
    setupAuth('admin_savr', null);
    admin.push({ data: [], error: null });
    const res = await call('collectes');
    expect(res.status).toBe(200);
    expect(mockCreateAdmin).toHaveBeenCalled();
  });

  it('staff : repas AG lus en direct (jamais via RPC C-1-safe = 0 sous service_role)', async () => {
    setupAuth('admin_savr', null);
    admin.push({
      data: [
        {
          id: 'c-ag',
          type: 'anti_gaspi',
          statut: 'cloturee',
          date_collecte: '2026-01-20',
          evenements: {
            nom_evenement: 'Don',
            date_evenement: '2026-01-20',
            traiteur_operationnel_organisation_id: null,
            lieux: { nom: 'Hall' },
          },
        },
      ],
      error: null,
    });
    // resolveRepas (staff) : lecture directe attributions_antgaspi
    admin.push({
      data: [{ collecte_id: 'c-ag', volume_repas_realise: 240 }],
      error: null,
    });
    const res = await call('collectes', '?type=anti_gaspi');
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('240'); // repas AG résolu
    expect(admin.__calls.rpc).toBeUndefined(); // pas de RPC sous service_role
    expect(
      (admin.__calls.from ?? []).some((a) => a[0] === 'attributions_antgaspi'),
    ).toBe(true);
  });
});

// ── Format CSV FR + double colonne dates (P2) ────────────────────────────────
describe('M4.1 / export_csv_format_fr_et_filtres_actifs', () => {
  it('format canonique : BOM, séparateur ;, en-têtes FR, dates DD/MM/YYYY, poids virgule', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          date_collecte: '2026-01-15',
          heure_collecte: '23:00:00',
          taux_recyclage: 82.3,
          co2_evite_kg: 12.5,
          collecte_flux: [{ poids_reel_kg: 100 }, { poids_reel_kg: 25.5 }],
          evenements: {
            nom_evenement: 'Gala',
            date_evenement: '2026-01-14',
            nom_client_organisateur: 'ACME',
            traiteur_operationnel_organisation_id: 'tr-1',
            lieux: { nom: 'Palais', code_postal: '75001', ville: 'Paris' },
          },
        },
      ],
      error: null,
    });
    // résolution v_referentiel_traiteurs
    rls.push({
      data: [
        { id: 'tr-1', nom: 'Traiteur Un', raison_sociale: 'Traiteur Un SAS' },
      ],
      error: null,
    });

    const res = await call('collectes', '?type=zero_dechet');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(
      /attachment; filename="collectes-savr-\d{8}\.csv"/,
    );

    // Le BOM est dans les octets envoyés (compat Excel FR) ; Response.text()
    // le retire au décodage, donc on vérifie les octets bruts.
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
    const text = new TextDecoder().decode(buf);
    const _lines = text.split('\r\n');
    const header = _lines[0] ?? '';
    const line1 = _lines[1] ?? '';
    expect(header).toContain('Date événement');
    expect(header).toContain('Date collecte'); // double colonne dates
    expect(header.split(';').length).toBeGreaterThan(10);
    // 14/01/2026 (événement) ET 15/01/2026 (collecte) présents
    expect(line1).toContain('14/01/2026');
    expect(line1).toContain('15/01/2026');
    expect(line1).toContain('23:00');
    expect(line1).toContain('125,5'); // tonnage virgule décimale
    expect(line1).toContain('82,3'); // taux recyclage virgule décimale
    expect(line1).not.toContain('82.3'); // jamais de point décimal
    expect(line1).toContain('Traiteur Un SAS'); // nom résolu via vue
  });

  it('filtres actifs propagés à la requête (type + from/to)', async () => {
    setupAuth('agence');
    rls.push({ data: [], error: null });
    await call('collectes', '?type=anti_gaspi&from=2026-01-01&to=2026-01-31');
    const eq = rls.__calls.eq ?? [];
    const gte = rls.__calls.gte ?? [];
    const lte = rls.__calls.lte ?? [];
    expect(eq.some((a) => a[0] === 'type' && a[1] === 'anti_gaspi')).toBe(true);
    expect(
      gte.some((a) => a[0] === 'date_collecte' && a[1] === '2026-01-01'),
    ).toBe(true);
    expect(
      lte.some((a) => a[0] === 'date_collecte' && a[1] === '2026-01-31'),
    ).toBe(true);
  });
});

// ── Factures : whitelist sans donnée sensible ────────────────────────────────
describe('M4.1 / factures whitelist', () => {
  it('client : brouillons exclus + jamais de colonne marge', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: [
        {
          numero_facture: 'F-2026-001',
          type: 'zero_dechet',
          statut: 'payee',
          montant_ht: 100,
          montant_ttc: 120,
          date_emission: '2026-01-10',
        },
      ],
      error: null,
    });
    const res = await call('factures');
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body.toLowerCase()).not.toContain('marge');
    // brouillon exclu pour les clients
    expect((rls.__calls.neq ?? []).some((a) => a[1] === 'brouillon')).toBe(
      true,
    );
  });
});

// ── Événements (grain événement, colonnes figées §12) ────────────────────────
describe('M4.1 / evenements', () => {
  it('unifié : traiteur_manager → 200 + colonnes figées + tonnage agrégé', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: [
        {
          id: 'e1',
          nom_evenement: 'Salon',
          date_evenement: '2026-02-01',
          pax: 300,
          traiteur_operationnel_organisation_id: 'tr-1',
          lieux: { nom: 'Dock' },
          types_evenements: { libelle: 'Salon pro' },
          collectes: [
            {
              id: 'c1',
              type: 'zero_dechet',
              statut: 'cloturee',
              date_collecte: '2026-02-01',
              taux_recyclage: 80,
              collecte_flux: [{ poids_reel_kg: 40 }, { poids_reel_kg: 10 }],
            },
          ],
        },
      ],
      error: null,
    });
    rls.push({
      data: [{ id: 'tr-1', nom: 'Tr', raison_sociale: 'Tr SAS' }],
      error: null,
    });

    const res = await call('evenements');
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(buf);
    const _lines = text.split('\r\n');
    const header = _lines[0] ?? '';
    const line1 = _lines[1] ?? '';
    expect(res.status).toBe(200);
    expect(header).toContain('Première collecte');
    expect(header).toContain('Tonnage ZD (kg)');
    expect(header).toContain('Statut consolidé');
    expect(line1).toContain('50'); // 40 + 10 kg
    expect(line1).toContain('Tr SAS');
  });

  it('route gestionnaire dédiée : périmètre organisations_lieux + CSV', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'L1' }], error: null }); // périmètre
    rls.push({
      data: [
        {
          id: 'e2',
          nom_evenement: 'Forum',
          date_evenement: '2026-03-01',
          pax: 100,
          traiteur_operationnel_organisation_id: null,
          lieux: { nom: 'Hall' },
          types_evenements: { libelle: 'Forum' },
          collectes: [],
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/export-csv/route.js');
    const res = await GET(
      makeReq('/api/v1/gestionnaire/evenements/export-csv'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    // filtre périmètre appliqué (in sur lieu_id)
    expect((rls.__calls.in ?? []).some((a) => a[0] === 'lieu_id')).toBe(true);
  });
});

describe('M4.1 / packs-ag', () => {
  it('colonnes réelles packs_antgaspi + SANS financier (masquage gestionnaire §06.05)', async () => {
    setupAuth('gestionnaire_lieux');
    // Colonnes RÉELLES (convergées M2.1). Si le builder relisait reference/
    // date_debut/prix_ht/devise (colonnes phantom), ces valeurs seraient absentes.
    rls.push({
      data: [
        {
          type_pack: 'pack_30',
          credits_initiaux: 30,
          credits_consommes: 5,
          credits_restants: 25,
          date_achat: '2026-01-10',
          date_expiration: null,
          statut: 'actif',
        },
      ],
      error: null,
    });
    const res = await call('packs-ag');
    expect(res.status).toBe(200);
    const text = new TextDecoder().decode(
      new Uint8Array(await res.arrayBuffer()),
    );
    const [header, line1] = text.split('\r\n');
    expect(header).toContain('Type de pack');
    expect(header).toContain('Crédits restants');
    expect(header).toContain("Date d'achat");
    // financier masqué (§06.05) — aucune colonne prix / montant / devise
    expect(header).not.toContain('Montant');
    expect(header).not.toContain('Prix');
    expect(header).not.toContain('Devise');
    expect(line1).toContain('pack_30');
    expect(line1).toContain('25');
  });
});
