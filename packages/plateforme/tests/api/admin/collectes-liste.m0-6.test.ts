/**
 * M0.6 — API GET /admin/collectes : prédicats de filtrage (BL-P1-BOA-05).
 * Verrouille le prédicat corrigé du chip « Non transmises TMS » (§06.06 §3 l.195 :
 * statut=programmee ET tms_reference IS NULL) + les filtres serveur ajoutés
 * (statut multi, info incomplète, organisation/lieu, rapport non consulté).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const chain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => chain,
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify({ aal: 'aal2', ...claims })).toString('base64url')}.s`;
}

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

function setupAuth(role = 'admin_savr') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

async function callGet(qs: string) {
  const { GET } = await import('@/app/api/v1/admin/collectes/route.js');
  return GET(new NextRequest(`http://localhost/api/v1/admin/collectes${qs}`));
}

describe('M0.6 — API GET collectes filtres (BL-P1-BOA-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it('M0.6 — chip « Non transmises TMS » : statut=programmee ET tms_reference IS NULL', async () => {
    await callGet('?chip=non_transmises');
    expect(chain.eq).toHaveBeenCalledWith('statut', 'programmee');
    expect(chain.is).toHaveBeenCalledWith('tms_reference', null);
    // Prédicat réaligné : plus de garde statut_tms='non_envoye' ni in(statut,[...])
    expect(chain.eq).not.toHaveBeenCalledWith('statut_tms', 'non_envoye');
    expect(chain.in).not.toHaveBeenCalled();
  });

  it('M0.6 — la liste sert tms_reference : l’action « Dispatcher » en dépend (kpi_a_dispatcher_predicat_unique)', async () => {
    await callGet('');
    // `estADispatcher` exige `tms_reference === null` : sans la colonne dans le
    // select, plus aucune ligne n'offrirait « Dispatcher ».
    const colonnes = String(chain.select.mock.calls[0]?.[0]);
    expect(colonnes).toMatch(/\btms_reference\b/);
    expect(colonnes).toMatch(/\bstatut_tms\b/);
  });

  it('M0.6 — filtre statut multi → in(statut, [...])', async () => {
    await callGet('?statuts=cloturee,validee');
    expect(chain.in).toHaveBeenCalledWith('statut', ['validee', 'cloturee']);
  });

  // ── Statut affiché Admin : « Créée » / « Programmée » (décision Val 2026-10-07) ──
  it('M0.6/statut_admin_brouillon_absent — la liste Admin ne sert jamais un brouillon', async () => {
    await callGet('');
    expect(chain.neq).toHaveBeenCalledWith('statut', 'brouillon');
    await callGet('?statuts=programmee,validee,en_cours');
    expect(chain.neq).toHaveBeenCalledTimes(2);
  });

  it('M0.6/statut_admin_creee_avant_envoi — la liste sert les signaux d’envoi (prestataire posé, attribution, référence)', async () => {
    await callGet('');
    const colonnes = String(chain.select.mock.calls[0]?.[0]);
    expect(colonnes).toMatch(/\bprestataire_logistique_id\b/);
    expect(colonnes).toMatch(/\battributions_antgaspi!collecte_id\(/);
  });

  it('M0.6/statut_admin_filtre_creee_programmee — statuts=creee → moitié « non envoyée » du statut programmee', async () => {
    await callGet('?statuts=creee');
    expect(chain.or).toHaveBeenCalledWith(
      'and(statut.eq.programmee,statut_tms.eq.non_envoye,tms_reference.is.null,prestataire_logistique_id.is.null,attributions_antgaspi.is.null)',
    );
    expect(chain.in).not.toHaveBeenCalledWith('statut', expect.anything());
  });

  it('M0.6/statut_admin_filtre_creee_programmee — statuts=programmee,validee → moitié « envoyée » OU validée', async () => {
    await callGet('?statuts=programmee,validee');
    expect(chain.or).toHaveBeenCalledWith(
      'and(statut.eq.programmee,or(statut_tms.neq.non_envoye,tms_reference.not.is.null,prestataire_logistique_id.not.is.null,attributions_antgaspi.not.is.null)),statut.in.(validee)',
    );
  });

  it('M0.6/statut_admin_filtre_creee_programmee — « Créée » et « Programmée » ensemble → in(statut) sur le statut DB, sans or', async () => {
    await callGet('?statuts=creee,programmee,en_cours');
    expect(chain.in).toHaveBeenCalledWith('statut', ['programmee', 'en_cours']);
    expect(chain.or).not.toHaveBeenCalled();
  });

  it('M0.6/statut_admin_brouillon_absent — clés inconnues écartées ; rien de valide demandé → aucune ligne, jamais une liste élargie', async () => {
    await callGet('?statuts=validee,x)%2Cstatut.neq.zz');
    expect(chain.in).toHaveBeenCalledWith('statut', ['validee']);
    expect(chain.or).not.toHaveBeenCalled();

    vi.clearAllMocks();
    setupAuth();
    await callGet('?statuts=brouillon,nimporte');
    expect(chain.in).toHaveBeenCalledWith('statut', []);
    expect(chain.or).not.toHaveBeenCalled();
  });

  it('M0.6 — ancien paramètre mono `statut` lu comme une liste d’un élément', async () => {
    await callGet('?statut=creee');
    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining(
        'and(statut.eq.programmee,statut_tms.eq.non_envoye',
      ),
    );
  });

  it('M0.6 — filtre info_incomplete=true → eq(informations_completes,false)', async () => {
    await callGet('?info_incomplete=true');
    expect(chain.eq).toHaveBeenCalledWith('informations_completes', false);
  });

  it('M0.6 — filtre controle_acces=true → miroir du KPI « Infos accès à envoyer » (requis + non envoyé + à venir)', async () => {
    await callGet('?controle_acces=true');
    // Miroir EXACT du compteur chip-counts `controle_acces_a_envoyer`.
    expect(chain.eq).toHaveBeenCalledWith('controle_acces_requis', true);
    expect(chain.is).toHaveBeenCalledWith('infos_acces_email_envoye_at', null);
    expect(chain.gte).toHaveBeenCalledWith('date_collecte', expect.any(String));
  });

  it('M0.6 — filtres organisation_id / lieu_id sur la jointure événement', async () => {
    await callGet('?organisation_id=org-1&lieu_id=lieu-1');
    expect(chain.eq).toHaveBeenCalledWith(
      'evenements.organisation_id',
      'org-1',
    );
    expect(chain.eq).toHaveBeenCalledWith('evenements.lieu_id', 'lieu-1');
  });

  it('R24c — filtre « Traiteur » = traiteur_operationnel_id → eq(evenements.traiteur_operationnel_organisation_id)', async () => {
    await callGet('?traiteur_operationnel_id=trait-1');
    expect(chain.eq).toHaveBeenCalledWith(
      'evenements.traiteur_operationnel_organisation_id',
      'trait-1',
    );
  });

  it('R24c — périmètre drill-down perimetre_org_ids[] (UUID) → .or(programmateur OU opérateur) sur evenements', async () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await callGet(`?perimetre_org_ids[]=${a}&perimetre_org_ids[]=${b}`);
    const orCall = chain.or.mock.calls.find((c) =>
      String(c[0]).includes(`organisation_id.in.(${a},${b})`),
    );
    expect(orCall).toBeDefined();
    expect(String(orCall?.[0])).toContain(
      `traiteur_operationnel_organisation_id.in.(${a},${b})`,
    );
    expect(orCall?.[1]).toEqual({ referencedTable: 'evenements' });
  });

  it('M0.6 — choix multiple : types / traiteur_operationnel_ids / lieu_ids (CSV) → in(…) prioritaires sur le mono', async () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await callGet(
      `?types=zero_dechet,anti_gaspi&type=zero_dechet&traiteur_operationnel_ids=${a},${b}&lieu_ids=${b}&lieu_id=lieu-1`,
    );
    expect(chain.in).toHaveBeenCalledWith('type', [
      'zero_dechet',
      'anti_gaspi',
    ]);
    expect(chain.in).toHaveBeenCalledWith(
      'evenements.traiteur_operationnel_organisation_id',
      [a, b],
    );
    expect(chain.in).toHaveBeenCalledWith('evenements.lieu_id', [b]);
    // Le mono est ignoré quand la liste est fournie.
    expect(chain.eq).not.toHaveBeenCalledWith('type', 'zero_dechet');
    expect(chain.eq).not.toHaveBeenCalledWith('evenements.lieu_id', 'lieu-1');
  });

  it('M0.6 — pastille (chip) ET filtres de la barre se cumulent côté route (décision Val 2026-09-30, E5)', async () => {
    const t = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await callGet(
      `?chip=non_transmises&types=zero_dechet&traiteur_operationnel_ids=${t}&statuts=validee`,
    );
    // Prédicat de la pastille…
    expect(chain.eq).toHaveBeenCalledWith('statut', 'programmee');
    expect(chain.is).toHaveBeenCalledWith('tms_reference', null);
    // … ET filtres de la barre, appliqués en plus (ET logique).
    expect(chain.in).toHaveBeenCalledWith('type', ['zero_dechet']);
    expect(chain.in).toHaveBeenCalledWith(
      'evenements.traiteur_operationnel_organisation_id',
      [t],
    );
    expect(chain.in).toHaveBeenCalledWith('statut', ['validee']);
  });

  it('M0.6 — choix multiple : valeurs hors liste blanche / non-UUID écartées avant in(…)', async () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await callGet(
      `?types=zero_dechet,autre),x&traiteur_operationnel_ids=${a},pas-un-uuid&lieu_ids=pas-un-uuid`,
    );
    expect(chain.in).toHaveBeenCalledWith('type', ['zero_dechet']);
    expect(chain.in).toHaveBeenCalledWith(
      'evenements.traiteur_operationnel_organisation_id',
      [a],
    );
    // Aucune valeur valide → pas de filtre lieu du tout.
    expect(chain.in.mock.calls.some((c) => c[0] === 'evenements.lieu_id')).toBe(
      false,
    );
  });

  it('R24c — périmètre ignore les ids non-UUID (défense en profondeur → pas de .or)', async () => {
    await callGet('?perimetre_org_ids[]=not-a-uuid');
    expect(
      chain.or.mock.calls.some((c) =>
        String(c[0]).includes('organisation_id.in.'),
      ),
    ).toBe(false);
  });

  it('M0.6 — filtre rapport_non_consulte=true → is(rapports_rse.consulte_par_user_at, null)', async () => {
    await callGet('?rapport_non_consulte=true');
    expect(chain.is).toHaveBeenCalledWith(
      'rapports_rse.consulte_par_user_at',
      null,
    );
  });

  // Une collecte AG avec excédents n'a pas de rapport (son document est
  // l'attestation de don) : le filtre ne retient que les ZD et les AG sans
  // excédents. Mesuré sur savr-dev le 2026-10-09 : 79 collectes sans cette
  // règle (dont 24 AG clôturées avec une ligne de rapport jamais rendue), 55 avec.
  it('M0.6 — filtre rapport_non_consulte=true → seulement ZD et AG sans excédents', async () => {
    await callGet('?rapport_non_consulte=true');
    expect(chain.or).toHaveBeenCalledWith(
      'type.eq.zero_dechet,statut.eq.realisee_sans_collecte',
    );
  });

  it('M0.6 — sans le filtre rapport_non_consulte, aucune restriction de type n’est posée', async () => {
    await callGet('');
    expect(
      chain.or.mock.calls.some((c) =>
        String(c[0]).includes('realisee_sans_collecte'),
      ),
    ).toBe(false);
  });
});

// Décision Val 2026-11-02 : une collecte dont l'ordre de création est abandonné
// dans la file d'envoi s'affiche « Créée ». La route lit ces abandons, les sert
// sur chaque ligne (`envoi_abandonne`) et les passe au filtre de statut.
describe('M0.6/statut_admin_creee_envoi_abandonne — GET /admin/collectes', () => {
  const ABANDONNEE = '11111111-1111-4111-8111-111111111111';
  const AUTRE = '22222222-2222-4222-8222-222222222222';
  const fromParDefaut = chain.from.getMockImplementation();

  // Une lecture terminale (thenable) qui enregistre ses filtres.
  function lecture(reponse: { data: unknown; error: unknown }) {
    const filtres: unknown[][] = [];
    const l: Record<string, unknown> = {
      then: (resolve: (r: typeof reponse) => unknown) => resolve(reponse),
    };
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit'])
      l[m] = (...args: unknown[]) => {
        filtres.push([m, ...args]);
        return l;
      };
    return { l, filtres };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });
  afterEach(() => {
    chain.from.mockImplementation(fromParDefaut ?? (() => chain));
  });

  function brancher(
    file: { data: unknown; error: unknown },
    // Toutes les créations des collectes candidates (2e lecture de la file) :
    // une création plus récente que l'abandon le remplace (Val 2026-11-03).
    creations: { data: unknown; error: unknown } = {
      data: [{ aggregate_id: ABANDONNEE, seq: 7, statut: 'dead' }],
      error: null,
    },
  ) {
    const fileEnvoi = lecture(file);
    const toutesCreations = lecture(creations);
    const encore = lecture({ data: [{ id: ABANDONNEE }], error: null });
    let collectes = 0;
    let file_ = 0;
    chain.from.mockImplementation((table: string) => {
      if (table === 'outbox_events')
        return file_++ === 0 ? fileEnvoi.l : toutesCreations.l;
      // 1re lecture de `collectes` = la liste ; 2e = abandons encore concernés.
      if (table === 'collectes' && collectes++ === 1) return encore.l;
      return chain;
    });
    return { fileEnvoi, toutesCreations, encore };
  }

  it('ligne abandonnée marquée, filtre « Créée » qui la retient', async () => {
    const { fileEnvoi, encore } = brancher({
      data: [{ aggregate_id: ABANDONNEE }],
      error: null,
    });
    chain.range.mockResolvedValueOnce({
      data: [{ id: ABANDONNEE }, { id: AUTRE }],
      error: null,
      count: 2,
    });
    const res = await callGet('?statuts=creee');
    expect(res.status).toBe(200);
    const corps = (await res.json()) as {
      data: { id: string; envoi_abandonne: boolean }[];
    };
    expect(corps.data.map((r) => [r.id, r.envoi_abandonne])).toEqual([
      [ABANDONNEE, true],
      [AUTRE, false],
    ]);
    // Seuls les ordres de création abandonnés…
    expect(fileEnvoi.filtres).toEqual(
      expect.arrayContaining([
        ['eq', 'event_type', 'collecte.creee'],
        ['eq', 'statut', 'dead'],
      ]),
    );
    // … de collectes que l'exception touche encore.
    expect(encore.filtres).toEqual(
      expect.arrayContaining([
        ['in', 'id', [ABANDONNEE]],
        ['eq', 'statut', 'programmee'],
        ['eq', 'statut_tms', 'non_envoye'],
        ['is', 'tms_reference', null],
      ]),
    );
    expect(String(chain.or.mock.calls[0]?.[0])).toContain(
      `id.in.(${ABANDONNEE})`,
    );
  });

  it('M0.6/ordre_abandonne_remplace — création abandonnée puis renvoyée : la collecte ne compte plus parmi les abandons', async () => {
    const { toutesCreations } = brancher(
      { data: [{ aggregate_id: ABANDONNEE }], error: null },
      {
        data: [
          { aggregate_id: ABANDONNEE, seq: 7, statut: 'dead' },
          { aggregate_id: ABANDONNEE, seq: 9, statut: 'pending' },
        ],
        error: null,
      },
    );
    chain.range.mockResolvedValueOnce({
      data: [{ id: ABANDONNEE }],
      error: null,
      count: 1,
    });
    const res = await callGet('');
    expect(res.status).toBe(200);
    const corps = (await res.json()) as {
      data: { id: string; envoi_abandonne: boolean }[];
    };
    expect(corps.data.map((r) => [r.id, r.envoi_abandonne])).toEqual([
      [ABANDONNEE, false],
    ]);
    expect(toutesCreations.filtres).toEqual(
      expect.arrayContaining([
        ['eq', 'event_type', 'collecte.creee'],
        ['in', 'aggregate_id', [ABANDONNEE]],
      ]),
    );
  });

  it('lecture de la file en échec : 500, jamais une liste aux statuts faux', async () => {
    brancher({ data: null, error: { code: '57014', message: 'timeout' } });
    const res = await callGet('');
    expect(res.status).toBe(500);
    expect(chain.range).not.toHaveBeenCalled();
  });
});

// Colonne « Montant » (Val 2026-11-03) : la route calcule le montant de la
// prestation de chaque ligne depuis ce qu'elle lit (pack débité, organisation et
// lieu de l'événement, pax et date de la collecte), sans lire aucune facture.
describe('M3.5/montant_prestation_liste_route — GET /admin/collectes', () => {
  const fromParDefaut = chain.from.getMockImplementation();
  const ORG = '33333333-3333-4333-8333-333333333333';
  const GEST = '44444444-4444-4444-8444-444444444444';
  const LIEU = '55555555-5555-4555-8555-555555555555';

  function lecture(data: unknown[]) {
    const l: Record<string, unknown> = {
      then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data, error: null }),
    };
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit'])
      l[m] = () => l;
    return l;
  }

  const referentiel: Record<string, unknown[]> = {
    outbox_events: [],
    grilles_tarifaires_zd: [
      {
        id: 'g1',
        est_defaut: true,
        valide_du: '2026-01-01',
        valide_jusqu: null,
      },
    ],
    tarifs_zero_dechet: [
      {
        grille_id: 'g1',
        pax_min: 1,
        pax_max: null,
        prix_base_ht: 300,
        prix_par_couvert_ht: null,
      },
    ],
    organisations: [{ id: ORG, grille_tarifaire_zd_id: null }],
    organisations_lieux: [{ lieu_id: LIEU, organisation_id: GEST }],
    tarifs_negocie: [
      {
        activite: 'zd',
        scope: 'gestionnaire',
        organisation_id: null,
        gestionnaire_organisation_id: GEST,
        lieu_id: LIEU,
        remise_pct: 0.25,
        valide_du: '2026-01-01',
        valide_jusqu: null,
      },
    ],
    tarifs_packs_ag: [
      { prix_unitaire_ht: 590, valide_du: '2026-01-01', valide_jusqu: null },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    chain.from.mockImplementation((table: string) =>
      table in referentiel ? lecture(referentiel[table]!) : chain,
    );
  });
  afterEach(() => {
    chain.from.mockImplementation(fromParDefaut ?? (() => chain));
  });

  it('M3.5/montant_prestation_liste_route — pack débité, tarif ZD remisé du gestionnaire du lieu, hors pack, inconnu', async () => {
    const evenement = { organisation_id: ORG, lieu_id: LIEU };
    chain.range.mockResolvedValueOnce({
      data: [
        {
          id: 'ag-pack',
          type: 'anti_gaspi',
          pax: 80,
          date_collecte: '2026-11-10',
          evenements: evenement,
          packs_antgaspi: {
            prix_unitaire_ht: 130,
            montant_total_ht: 1300,
            credits_initiaux: 10,
          },
        },
        {
          id: 'zd',
          type: 'zero_dechet',
          pax: 200,
          date_collecte: '2026-11-10',
          evenements: evenement,
          packs_antgaspi: null,
        },
        {
          id: 'ag-hors-pack',
          type: 'anti_gaspi',
          pax: 80,
          date_collecte: '2026-11-10',
          evenements: evenement,
          packs_antgaspi: null,
        },
        {
          id: 'zd-sans-pax',
          type: 'zero_dechet',
          pax: null,
          date_collecte: '2026-11-10',
          evenements: evenement,
          packs_antgaspi: null,
        },
      ],
      error: null,
      count: 4,
    });
    const res = await callGet('');
    expect(res.status).toBe(200);
    const corps = (await res.json()) as {
      data: { id: string; montant_ht: number | null }[];
    };
    expect(corps.data.map((r) => [r.id, r.montant_ht])).toEqual([
      ['ag-pack', 130], // pack débité, jamais le pack actif de l'organisation
      ['zd', 225], // 300 × (1 − 0,25)
      ['ag-hors-pack', 590], // la remise du gestionnaire est ZD, pas AG
      ['zd-sans-pax', null],
    ]);
    // Le pack lu est celui que la collecte a débité ; aucune facture lue.
    const colonnes = String(chain.select.mock.calls[0]?.[0]);
    expect(colonnes).toMatch(/packs_antgaspi!pack_antgaspi_id\(/);
    expect(colonnes).not.toMatch(/factures_collectes/);
    const tables = chain.from.mock.calls.map((a) => String(a[0]));
    expect(tables).not.toContain('factures_collectes');
    expect(tables).not.toContain('packs_antgaspi');
  });
});
