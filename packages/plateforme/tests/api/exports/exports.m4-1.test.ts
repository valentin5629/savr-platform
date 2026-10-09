/**
 * M4.1 — Tests Vitest : endpoint d'export CSV unifié /api/v1/exports/[entity].
 * Couvre : matrice d'autorisation par profil (P1 matrice_exports_csv_par_profil),
 * format CSV FR + double colonne dates (P2 export_csv_format_fr_et_filtres_actifs),
 * filtres actifs propagés, cloisonnement (clients = RLS jamais service_role,
 * staff = service_role), entité inconnue 404, non-authentifié 401.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown; count?: number | null };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  // Total de la requête (`count: 'exact'`) : par défaut celui des lignes servies
  // — une seule tranche ; un cas peut en annoncer davantage (lecture par tranches).
  const next = (): Result => {
    const r = queue.shift() ?? { data: null, error: null };
    return 'count' in r
      ? r
      : { ...r, count: Array.isArray(r.data) ? r.data.length : null };
  };
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
    'filter',
    'gte',
    'lte',
    'neq',
    'or',
    'is',
    'not',
    'order',
    'range',
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

// Identifiants au format UUID : les listes d'ids sont validées avant `.in()`.
const LIEU_1 = '11111111-1111-4111-8111-111111111111';
const LIEU_2 = '22222222-2222-4222-8222-222222222222';
const ORG_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

  // Décision Val 2026-10-07 : la liste Événements du gestionnaire est retirée,
  // son export passe sur la liste Collectes (1 ligne = 1 collecte).
  it('M4.1/export_collectes_gestionnaire_autorise — gestionnaire → collectes : 200, sous sa session (jamais service_role)', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [], error: null });
    const res = await call('collectes');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(mockCreateAdmin).not.toHaveBeenCalled();
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

  it('staff : repas AG lus dans l’embed de la ligne (jamais via RPC C-1-safe = 0 sous service_role, ni par une seconde requête)', async () => {
    setupAuth('admin_savr', null);
    const ligne = (id: string, attributions: unknown) => ({
      id,
      type: 'anti_gaspi',
      statut: 'cloturee',
      date_collecte: '2026-01-20',
      attributions_antgaspi: attributions,
      evenements: {
        nom_evenement: id,
        date_evenement: '2026-01-20',
        traiteur_operationnel_organisation_id: null,
        lieux: { nom: 'Hall' },
      },
    });
    admin.push({
      data: [
        // Objet ou tableau selon la cardinalité vue par PostgREST.
        ligne('evt-objet', { id: 'a1', volume_repas_realise: 240 }),
        ligne('evt-tableau', [{ id: 'a2', volume_repas_realise: 35 }]),
        ligne('evt-sans-attribution', null),
      ],
      error: null,
    });
    const res = await call('collectes', '?type=anti_gaspi');
    const csv = await res.text();
    expect(res.status).toBe(200);
    const repasDe = (id: string) =>
      csv
        .split('\r\n')
        .find((l) => l.includes(id))
        ?.split(';')
        .pop();
    expect(repasDe('evt-objet')).toBe('240');
    expect(repasDe('evt-tableau')).toBe('35');
    // Sans attribution : cellule vide, pas un zéro.
    expect(repasDe('evt-sans-attribution')).toBe('');
    expect(admin.__calls.rpc).toBeUndefined(); // pas de RPC sous service_role
    // Une seule lecture : une requête `in(collecte_id, …)` à part dépasserait
    // la longueur d'URL et le plafond de lignes sur un gros export.
    expect((admin.__calls.from ?? []).map((a) => a[0])).toEqual(['collectes']);
    expect(String((admin.__calls.select ?? [])[0]?.[0])).toMatch(
      /attributions_antgaspi!collecte_id\(id, volume_repas_realise\)/,
    );
  });

  it('traiteur : export associations-ag — embed to-one (OBJET PostgREST) non jeté', async () => {
    // Régression : buildAssociationsAgExport (traiteur) agrège les bénéficiaires
    // via l'embed collectes.attributions_antgaspi, que PostgREST renvoie en OBJET
    // (to-one, collecte_id UNIQUE). Avant le fix, `: []` le jetait → export vide.
    setupAuth('traiteur_manager', 'org-a');
    rls.push({
      data: [
        {
          id: 'c-ag',
          type: 'anti_gaspi',
          // ⚠ OBJET, pas tableau — forme réelle PostgREST.
          attributions_antgaspi: {
            association_id: 'asso-1',
            volume_repas_realise: 90,
            associations: { nom: 'Les Restos', ville: 'Paris', region: 'IDF' },
          },
        },
      ],
      error: null,
    });
    const res = await call('associations-ag');
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('Les Restos'); // asso non jetée
    expect(text).toContain('90'); // repas comptés
  });
});

// ── Format CSV FR + double colonne dates (P2) ────────────────────────────────
// Statut exporté = statut AFFICHÉ (décision Val 2026-10-07) : côté staff, le
// statut DB `programmee` sort « Créée » tant que la demande n'est pas partie
// vers le prestataire, « Programmée » ensuite ; aucun brouillon.
describe('M4.1 / export collectes — statut affiché Admin', () => {
  const ligne = (id: string, over: Record<string, unknown>) => ({
    id,
    type: 'zero_dechet',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    tms_reference: null,
    prestataire_logistique_id: null,
    attributions_antgaspi: null,
    date_collecte: '2026-01-20',
    evenements: {
      nom_evenement: id,
      date_evenement: '2026-01-20',
      traiteur_operationnel_organisation_id: null,
      lieux: { nom: 'Hall' },
    },
    ...over,
  });
  const statutDe = (csv: string, id: string): string | undefined => {
    const lignes = csv.split('\r\n');
    const colonne = (lignes[0] ?? '').split(';').indexOf('Statut');
    return lignes.find((l) => l.includes(id))?.split(';')[colonne];
  };

  it('M0.6/statut_admin_export_staff — staff : « Créée » avant l’envoi, « Programmée » après, brouillons exclus', async () => {
    setupAuth('admin_savr', null);
    admin.push({
      data: [
        ligne('evt-creee', {}),
        ligne('evt-dispatchee', { prestataire_logistique_id: 'presta-1' }),
        ligne('evt-attribuee', {
          type: 'anti_gaspi',
          attributions_antgaspi: { id: 'attr-1' },
        }),
        ligne('evt-validee', { statut: 'validee', statut_tms: 'acceptee' }),
      ],
      error: null,
    });
    const csv = await (await call('collectes')).text();

    expect(statutDe(csv, 'evt-creee')).toBe('Créée');
    expect(statutDe(csv, 'evt-dispatchee')).toBe('Programmée');
    expect(statutDe(csv, 'evt-attribuee')).toBe('Programmée');
    expect(statutDe(csv, 'evt-validee')).toBe('Validée');
    // Les QUATRE signaux d'envoi sont lus (un champ absent ferait sortir
    // « Programmée » toute collecte programmée), brouillons écartés à la requête.
    const select = String((admin.__calls.select ?? [])[0]?.[0]);
    expect(select).toMatch(/\bstatut_tms\b/);
    expect(select).toMatch(/\btms_reference\b/);
    expect(select).toMatch(/\bprestataire_logistique_id\b/);
    expect(select).toMatch(/attributions_antgaspi!collecte_id\(id\b/);
    expect(admin.__calls.neq).toContainEqual(['statut', 'brouillon']);
  });

  // « Sans excédent » n'est pas un statut (décision Val 2026-10-09) : l'export
  // dit « Réalisée » et garde l'information dans « Repas AG », qui vaut 0.
  it('M4.1/export_collectes_sans_excedent_zero_repas — AG sans excédent : statut « Réalisée », « Repas AG » = 0, jamais une cellule vide', async () => {
    setupAuth('admin_savr', null);
    admin.push({
      data: [
        ligne('evt-sans-excedent', {
          type: 'anti_gaspi',
          statut: 'realisee_sans_collecte',
          statut_tms: 'acceptee',
        }),
        ligne('evt-ag-sans-attribution', {
          type: 'anti_gaspi',
          statut: 'cloturee',
          statut_tms: 'acceptee',
        }),
        ligne('evt-zd', { statut: 'cloturee', statut_tms: 'acceptee' }),
      ],
      error: null,
    });
    const csv = await (await call('collectes')).text();
    const repasDe = (id: string) =>
      csv
        .split('\r\n')
        .find((l) => l.includes(id))
        ?.split(';')
        .pop();

    expect(statutDe(csv, 'evt-sans-excedent')).toBe('Réalisée');
    // Aucune cellule ne porte l'ancien libellé de statut.
    expect(csv.split(/;|\r\n/)).not.toContain('Sans excédents');
    expect(repasDe('evt-sans-excedent')).toBe('0');
    // Témoins : sans cette règle, une AG sans attribution lue et une ZD
    // laissent la cellule vide.
    expect(repasDe('evt-ag-sans-attribution')).toBe('');
    expect(repasDe('evt-zd')).toBe('');
  });

  it('M4.1/export_impact_rse_sans_excedent_zero_repas — même règle dans l’export Impact RSE', async () => {
    setupAuth('admin_savr', null);
    admin.push({
      data: [
        ligne('evt-sans-excedent', {
          type: 'anti_gaspi',
          statut: 'realisee_sans_collecte',
        }),
        ligne('evt-ag-sans-attribution', {
          type: 'anti_gaspi',
          statut: 'cloturee',
        }),
      ],
      error: null,
    });
    const res = await call('impact-rse');
    const csv = await res.text();
    expect(res.status).toBe(200);
    const lignes = csv.split('\r\n');
    const colonne = (lignes[0] ?? '').split(';').indexOf('Repas AG');
    expect(colonne).toBeGreaterThan(-1);
    const repasDe = (id: string) =>
      lignes.find((l) => l.includes(id))?.split(';')[colonne];
    expect(repasDe('evt-sans-excedent')).toBe('0');
    expect(repasDe('evt-ag-sans-attribution')).toBe('');
  });

  it('client : ni signaux d’envoi lus (pas de lecture de attributions_antgaspi), ni changement de libellé', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: [
        ligne('evt-client', {}),
        ligne('evt-brouillon', { statut: 'brouillon' }),
      ],
      error: null,
    });
    const csv = await (await call('collectes')).text();

    expect(statutDe(csv, 'evt-client')).toBe('Programmée');
    // Un brouillon reste « Créée » côté client, comme avant ce lot.
    expect(statutDe(csv, 'evt-brouillon')).toBe('Créée');
    const select = String((rls.__calls.select ?? [])[0]?.[0]);
    expect(select).not.toMatch(/attributions_antgaspi/);
    expect(select).not.toMatch(/prestataire_logistique_id/);
    expect(rls.__calls.neq ?? []).not.toContainEqual(['statut', 'brouillon']);
  });
});

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
        // v_referentiel_traiteurs rend UN libellé (20260922080000).
        { id: 'tr-1', nom: 'Traiteur Un' },
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
    expect(line1).toContain('Traiteur Un'); // libellé unique résolu via la vue
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

  it('filtres de la barre des listes traiteur / agence propagés (statuts d’onglet, lieu, client, info incomplète, programmée par)', async () => {
    setupAuth('agence');
    rls.push({ data: [], error: null });
    await call(
      'collectes',
      `?type=zero_dechet&statut=brouillon,programmee&lieu_id=${LIEU_1}&client=Viparis&info_incomplete=oui&programmee_par=${ORG_1},${ORG_2}`,
    );
    const eq = rls.__calls.eq ?? [];
    const inn = rls.__calls.in ?? [];
    expect(inn).toContainEqual(['statut', ['brouillon', 'programmee']]);
    // L'ancien `lieu_id` est lu comme une liste d'un élément.
    expect(inn).toContainEqual(['evenements.lieu_id', [LIEU_1]]);
    expect(rls.__calls.filter).toContainEqual([
      'evenements.nom_client_organisateur',
      'in',
      '("Viparis")',
    ]);
    // « Info incomplète : oui » = informations_completes à false.
    expect(eq).toContainEqual(['informations_completes', false]);
    expect(inn).toContainEqual(['evenements.organisation_id', [ORG_1, ORG_2]]);
  });

  // Filtres à choix multiple des listes traiteur / agence (partie C) : l'export
  // lit les paramètres par la MÊME fonction que leurs routes (§12).
  it('M4.1/export_collectes_filtres_choix_multiple — lieu_ids CSV et client répété, comme la liste', async () => {
    setupAuth('traiteur_manager');
    rls.push({ data: [], error: null });
    const qs = new URLSearchParams({
      type: 'zero_dechet',
      lieu_ids: `${LIEU_1},${LIEU_2}`,
    });
    qs.append('client', 'Viparis');
    qs.append('client', 'Agence "Les Halles", (Paris)');
    await call('collectes', `?${qs}`);
    expect(rls.__calls.in).toContainEqual([
      'evenements.lieu_id',
      [LIEU_1, LIEU_2],
    ]);
    expect(rls.__calls.filter).toContainEqual([
      'evenements.nom_client_organisateur',
      'in',
      '("Viparis","Agence \\"Les Halles\\", (Paris)")',
    ]);
  });

  it('M4.1/export_collectes_filtres_liste_prioritaire — lieu_ids ET lieu_id présents : seule la liste est lue', async () => {
    setupAuth('agence');
    rls.push({ data: [], error: null });
    await call('collectes', `?lieu_ids=${LIEU_1}&lieu_id=${LIEU_2}`);
    expect(
      (rls.__calls.in ?? []).filter((a) => a[0] === 'evenements.lieu_id'),
    ).toEqual([['evenements.lieu_id', [LIEU_1]]]);
  });

  it('M4.1/export_collectes_filtres_invalides_ecartes — jamais de .in() vide, aucun filtre fantôme', async () => {
    setupAuth('agence');
    rls.push({ data: [], error: null });
    await call(
      'collectes',
      '?type=zero_dechet&lieu_ids=pas-un-uuid&statut=inconnu&programmee_par=x&client=&client=%20',
    );
    // Un `.in(colonne, [])` viderait l'export ; ici aucun filtre n'est posé.
    expect(rls.__calls.in ?? []).toEqual([]);
    expect(rls.__calls.filter ?? []).toEqual([]);
    expect(rls.__calls.eq).toEqual([['type', 'zero_dechet']]);
  });

  it('M4.1/export_collectes_statut_hors_enum_retire — seuls les statuts de l’enum filtrent', async () => {
    setupAuth('agence');
    rls.push({ data: [], error: null });
    await call('collectes', '?statut=inconnu,cloturee');
    expect(rls.__calls.in).toContainEqual(['statut', ['cloturee']]);
  });
});

// ── Export de la liste Collectes du gestionnaire (décision Val 2026-10-07) ────
// Sa liste filtre aussi par traiteur, type et taille d'événement : l'export lit
// ces paramètres par la MÊME fonction que la route de la liste (§12 §2).
describe('M4.1 / export collectes — filtres de la liste gestionnaire', () => {
  const TRAITEUR_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const TYPE_EVT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const lignes = async (res: Response) =>
    new TextDecoder()
      .decode(new Uint8Array(await res.arrayBuffer()))
      .split('\r\n')
      .filter(Boolean);

  it('M4.1/export_collectes_gestionnaire_filtres_liste — lieu, traiteur, type et taille d’événement propagés, comme la liste', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [], error: null });
    const qs = new URLSearchParams({
      type: 'zero_dechet',
      lieu_ids: `${LIEU_1},${LIEU_2}`,
      traiteur_ids: TRAITEUR_1,
    });
    qs.append('type_evenement_ids[]', TYPE_EVT);
    qs.append('taille_evenements[]', 'M');
    qs.append('taille_evenements[]', 'XS');
    await call('collectes', `?${qs}`);
    const inn = rls.__calls.in ?? [];
    expect(rls.__calls.eq).toContainEqual(['type', 'zero_dechet']);
    expect(inn).toContainEqual(['evenements.lieu_id', [LIEU_1, LIEU_2]]);
    expect(inn).toContainEqual([
      'evenements.traiteur_operationnel_organisation_id',
      [TRAITEUR_1],
    ]);
    expect(inn).toContainEqual(['evenements.type_evenement_id', [TYPE_EVT]]);
    // Un seul `.or()` sur l'embed, prédicats de la table de constantes.
    expect(rls.__calls.or).toEqual([
      [
        'and(pax.gte.500,pax.lt.750),pax.is.null,pax.lt.250',
        { referencedTable: 'evenements' },
      ],
    ]);
  });

  it.each([
    ['taille hors XS…XL', '?taille_evenements[]=ZZ'],
    ['clé héritée', '?taille_evenements[]=toString'],
    ['traiteur mal formé', '?traiteur_ids=pas-un-uuid'],
    ['lieu mal formé', '?lieu_ids=pas-un-uuid'],
  ])(
    'M4.1/export_collectes_gestionnaire_filtre_illisible_vide — %s : fichier sans ligne, jamais le périmètre entier',
    async (_cas, query) => {
      setupAuth('gestionnaire_lieux');
      // Une ligne attend dans la file : elle ne doit PAS sortir, la requête
      // n'est pas envoyée.
      rls.push({
        data: [
          {
            id: 'c1',
            type: 'zero_dechet',
            statut: 'cloturee',
            evenements: { nom_evenement: 'Ne doit pas sortir', lieux: {} },
          },
        ],
        error: null,
      });
      const res = await call('collectes', query);
      expect(res.status).toBe(200);
      const l = await lignes(res);
      expect(l).toHaveLength(1);
      expect(l[0]).toContain('Date collecte');
      expect(rls.__calls.rpc ?? []).toEqual([]);
    },
  );

  it('M4.1/export_collectes_filtres_gestionnaire_bornes_au_role — agence : traiteur et taille ignorés, règle « valeur illisible = filtre ignoré » inchangée', async () => {
    setupAuth('agence');
    rls.push({ data: [], error: null });
    await call(
      'collectes',
      `?traiteur_ids=${TRAITEUR_1}&type_evenement_ids[]=${TYPE_EVT}&taille_evenements[]=ZZ`,
    );
    expect(rls.__calls.in ?? []).toEqual([]);
    expect(rls.__calls.or ?? []).toEqual([]);
    // La requête part bien (pas de court-circuit « aucun résultat »).
    expect(rls.__calls.order).toBeDefined();
  });
});

// ── Export de la liste Collectes de l'Admin (décision Val 2026-10-07) ─────────
// Sa liste porte des filtres que les listes clientes n'ont pas (pastilles,
// statuts affichés, traiteur opérationnel, périmètre, contrôle d'accès, rapport
// non consulté) : la route de la liste et l'export les lisent ET les appliquent
// par le MÊME module, pour que le fichier porte les lignes de la liste (§12 §2).
describe('M4.1 / export collectes — filtres de la liste Admin', () => {
  const TRAITEUR_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const FILTRES = ['eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'or'] as const;

  beforeEach(() => {
    // Fenêtres 48 h des pastilles et « à venir » : même jour pour les deux appels.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Filtres posés sur la requête `collectes` par un appel (liste ou export). */
  async function filtresPoses(appel: () => Promise<Response>) {
    admin = makeChain();
    admin.push({ data: [], error: null });
    const res = await appel();
    expect(res.status).toBe(200);
    return Object.fromEntries(FILTRES.map((m) => [m, admin.__calls[m] ?? []]));
  }
  async function liste(query: string): Promise<Response> {
    const { GET } = await import('@/app/api/v1/admin/collectes/route.js');
    return GET(makeReq(`/api/v1/admin/collectes${query}`));
  }

  it.each<[string, string, (typeof FILTRES)[number], unknown[]]>([
    [
      'statuts affichés (liste DB)',
      '?statuts=validee,en_cours',
      'in',
      ['statut', ['validee', 'en_cours']],
    ],
    [
      'statut « Créée » = demande non partie',
      '?statuts=creee',
      'or',
      [
        'and(statut.eq.programmee,statut_tms.eq.non_envoye,tms_reference.is.null,prestataire_logistique_id.is.null,attributions_antgaspi.is.null)',
      ],
    ],
    [
      'statut « Programmée » = demande partie, cumulé à un autre statut',
      '?statuts=programmee,validee',
      'or',
      [
        'and(statut.eq.programmee,or(statut_tms.neq.non_envoye,tms_reference.not.is.null,prestataire_logistique_id.not.is.null,attributions_antgaspi.not.is.null)),statut.in.(validee)',
      ],
    ],
    [
      // Décision Val 2026-10-09 : « Réalisée » se lit aussi sur une collecte AG
      // sans excédent, le filtre n'en propose qu'une.
      'statut « Réalisée » : couvre aussi la collecte AG sans excédent',
      '?statuts=realisee,cloturee',
      'in',
      ['statut', ['realisee', 'realisee_sans_collecte', 'cloturee']],
    ],
    [
      'aucun statut lisible : aucune ligne, jamais la liste entière',
      '?statuts=inconnu,brouillon',
      'in',
      ['statut', []],
    ],
    [
      'type (choix multiple)',
      '?types=anti_gaspi',
      'in',
      ['type', ['anti_gaspi']],
    ],
    [
      'traiteur opérationnel',
      `?traiteur_operationnel_ids=${TRAITEUR_1},${ORG_1}`,
      'in',
      ['evenements.traiteur_operationnel_organisation_id', [TRAITEUR_1, ORG_1]],
    ],
    [
      'lieux',
      `?lieu_ids=${LIEU_1},${LIEU_2}`,
      'in',
      ['evenements.lieu_id', [LIEU_1, LIEU_2]],
    ],
    [
      'période — début',
      '?from=2026-01-01',
      'gte',
      ['date_collecte', '2026-01-01'],
    ],
    ['période — fin', '?to=2026-06-30', 'lte', ['date_collecte', '2026-06-30']],
    [
      'info incomplète',
      '?info_incomplete=true',
      'eq',
      ['informations_completes', false],
    ],
    [
      'infos d’accès à envoyer (contrôle requis, email non envoyé, à venir)',
      '?controle_acces=true',
      'is',
      ['infos_acces_email_envoye_at', null],
    ],
    [
      'rapport non consulté',
      '?rapport_non_consulte=true',
      'is',
      ['rapports_rse.consulte_par_user_at', null],
    ],
    [
      'périmètre d’organisations du drill-down',
      `?perimetre_org_ids[]=${ORG_1}&perimetre_org_ids[]=${ORG_2}`,
      'or',
      [
        `organisation_id.in.(${ORG_1},${ORG_2}),traiteur_operationnel_organisation_id.in.(${ORG_1},${ORG_2})`,
        { referencedTable: 'evenements' },
      ],
    ],
    [
      'pastille « Non transmises ZD »',
      '?chip=non_transmises_zd',
      'eq',
      ['statut_tms', 'non_envoye'],
    ],
    [
      'pastille « Modifiées sans renvoi TMS »',
      '?chip=dirty_tms',
      'not',
      ['tms_reference', 'is', null],
    ],
    [
      'pastille « AG en attente attribution »',
      '?chip=ag_attente_attribution',
      'is',
      ['attributions_antgaspi', null],
    ],
    [
      'pastille « Collecte <48 h non validée »',
      '?chip=collectes_48h_non_validees',
      'lte',
      ['date_collecte', '2026-10-09'],
    ],
    [
      'pastille ET barre cumulées',
      `?chip=attente_prestataire&statuts=validee&types=zero_dechet&lieu_ids=${LIEU_1}&from=2026-01-01`,
      'eq',
      ['statut_tms', 'attribuee_en_attente_acceptation'],
    ],
  ])(
    'M4.1/export_collectes_admin_filtres_liste — %s : le fichier porte les filtres de la liste',
    async (_cas, query, methode, appelAttendu) => {
      setupAuth('admin_savr', null);
      const deLaListe = await filtresPoses(() => liste(query));
      const deLExport = await filtresPoses(() => call('collectes', query));

      // Le filtre du cas est bien posé (l'égalité seule serait vraie à vide)…
      expect(deLExport[methode]).toContainEqual(appelAttendu);
      // … et l'export pose EXACTEMENT les filtres de la liste, brouillons exclus.
      expect(deLExport).toEqual(deLaListe);
      expect(deLExport.neq).toContainEqual(['statut', 'brouillon']);
    },
  );

  it('M4.1/export_collectes_admin_filtres_liste — rapport non consulté : embed rapports_rse en !inner, absent sinon', async () => {
    setupAuth('admin_savr', null);
    admin.push({ data: [], error: null });
    await call('collectes', '?rapport_non_consulte=true');
    expect(String((admin.__calls.select ?? [])[0]?.[0])).toMatch(
      /rapports_rse!collecte_id!inner\(consulte_par_user_at\)/,
    );

    admin = makeChain();
    admin.push({ data: [], error: null });
    await call('collectes', '?statuts=validee');
    expect(String((admin.__calls.select ?? [])[0]?.[0])).not.toMatch(
      /rapports_rse/,
    );
  });

  it('M4.1/export_collectes_admin_sans_tri_ni_page — tri et page de la liste ignorés : toute la sélection, date décroissante', async () => {
    setupAuth('admin_savr', null);
    admin.push({ data: [], error: null });
    await call('collectes', '?statuts=validee&tri=type&ordre=asc&page=3');
    expect(admin.__calls.order).toEqual([
      ['date_collecte', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(admin.__calls.range).toEqual([[0, 999]]);
  });

  it('M4.1/export_collectes_filtres_admin_bornes_au_staff — agence : aucun filtre de la liste Admin n’est lu, sa requête reste celle de sa liste', async () => {
    setupAuth('agence');
    rls.push({ data: [], error: null });
    const qs = new URLSearchParams({
      chip: 'dirty_tms',
      statuts: 'creee',
      types: 'anti_gaspi',
      statut_tms: 'acceptee',
      organisation_id: ORG_1,
      traiteur_operationnel_ids: TRAITEUR_1,
      controle_acces: 'true',
      rapport_non_consulte: 'true',
      info_incomplete: 'true',
    });
    qs.append('perimetre_org_ids[]', ORG_2);
    const res = await call('collectes', `?${qs}`);
    expect(res.status).toBe(200);
    for (const m of FILTRES) expect(rls.__calls[m] ?? []).toEqual([]);
    expect(String((rls.__calls.select ?? [])[0]?.[0])).not.toMatch(
      /rapports_rse|attributions_antgaspi/,
    );
    expect(mockCreateAdmin).not.toHaveBeenCalled();
  });

  it('M4.1/export_collectes_filtres_admin_bornes_au_staff — staff : les filtres des listes clientes (client, programmée par, info incomplète oui/non) ne sont pas les siens', async () => {
    setupAuth('admin_savr', null);
    admin.push({ data: [], error: null });
    await call(
      'collectes',
      `?client=Viparis&programmee_par=${ORG_1}&info_incomplete=oui`,
    );
    expect(admin.__calls.filter ?? []).toEqual([]);
    expect(admin.__calls.in ?? []).toEqual([]);
    expect(admin.__calls.eq ?? []).toEqual([]);
  });

  // PostgREST plafonne chaque réponse (`max_rows`) : le staff est le premier
  // rôle à dépasser 1 000 collectes (historique repris de Bubble).
  const ligneZd = (id: string) => ({
    id,
    type: 'zero_dechet',
    statut: 'cloturee',
    statut_tms: 'terminee',
    tms_reference: 'CMD-1',
    prestataire_logistique_id: null,
    attributions_antgaspi: null,
    date_collecte: '2026-01-20',
    evenements: {
      nom_evenement: id,
      date_evenement: '2026-01-20',
      traiteur_operationnel_organisation_id: null,
      lieux: { nom: 'Hall' },
    },
  });

  it('M4.1/export_collectes_lecture_par_tranches — réponse plafonnée : les tranches suivantes sont lues jusqu’au total annoncé', async () => {
    setupAuth('admin_savr', null);
    // Le serveur annonce 3 lignes et n'en sert que 2 par réponse.
    admin.push({
      data: [ligneZd('evt-1'), ligneZd('evt-2')],
      error: null,
      count: 3,
    });
    admin.push({ data: [ligneZd('evt-3')], error: null, count: 3 });
    const res = await call('collectes', '?statuts=cloturee');
    const csv = await res.text();
    expect(res.status).toBe(200);
    for (const id of ['evt-1', 'evt-2', 'evt-3']) expect(csv).toContain(id);
    // La seconde tranche repart du nombre de lignes REÇUES, filtres reposés.
    expect(admin.__calls.range).toEqual([
      [0, 999],
      [2, 1001],
    ]);
    expect(
      (admin.__calls.in ?? []).filter((a) => a[0] === 'statut'),
    ).toHaveLength(2);
  });

  it('M4.1/export_collectes_lecture_par_tranches — lignes disparues entre deux tranches : la lecture s’arrête sur la tranche vide', async () => {
    setupAuth('admin_savr', null);
    admin.push({ data: [ligneZd('evt-1')], error: null, count: 2 });
    admin.push({ data: [], error: null, count: 1 });
    const res = await call('collectes');
    expect(res.status).toBe(200);
    expect(admin.__calls.range).toHaveLength(2);
  });

  it('M4.1/export_collectes_total_absent_echec — sans total, l’export échoue : jamais un fichier peut-être tronqué', async () => {
    setupAuth('admin_savr', null);
    admin.push({ data: [ligneZd('evt-1')], error: null, count: null });
    const res = await call('collectes');
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('evt-1');
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
      // v_referentiel_traiteurs rend UN libellé (20260922080000).
      data: [{ id: 'tr-1', nom: 'Tr' }],
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
    expect(line1).toContain(';Tr;'); // libellé unique de la vue
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
