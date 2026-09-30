/**
 * Mock Supabase keyé par TABLE (robuste à l'ordre des Promise.all) pour les
 * routes du pop-up fiche collecte client : enregistre les tables lues, les
 * `select` et les filtres `eq` demandés par table, les inserts et les appels
 * RPC.
 */
export type Result = { data: unknown; error: unknown };

export function makeClient() {
  const results: Record<string, Result> = {};
  const rpcResults: Record<string, Result> = {};
  const calls: string[] = [];
  const selects: Record<string, string[]> = {};
  const eqs: Record<string, Array<[string, unknown]>> = {};
  const inserts: Array<{ table: string; row: unknown }> = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  let insertResult: Result = { data: null, error: null };

  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {
      select: (s: unknown) => {
        (selects[table] ??= []).push(String(s));
        return c;
      },
      eq: (col: unknown, val: unknown) => {
        (eqs[table] ??= []).push([String(col), val]);
        return c;
      },
      is: () => c,
      in: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(res()),
      single: () => Promise.resolve(res()),
      insert: (row: unknown) => {
        inserts.push({ table, row });
        return Promise.resolve(insertResult);
      },
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }

  const api = {
    schema: () => api,
    from: (table: string) => {
      calls.push(table);
      return chain(table);
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResults[name] ?? { data: null, error: null });
    },
    setInsertResult(r: Result) {
      insertResult = r;
    },
    results,
    rpcResults,
    calls,
    selects,
    eqs,
    inserts,
    rpcCalls,
  };
  return api;
}

/** Ligne `collectes` telle que la renvoie la lecture RLS du chargeur. */
export function ligneCollecte(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'validee',
    statut_tms: 'acceptee',
    tms_reference: null,
    date_collecte: '2026-10-28',
    heure_collecte: '22:00:00',
    controle_acces_requis: false,
    informations_completes: true,
    informations_supplementaires: null,
    taux_recyclage: null,
    co2_net_kg: null,
    co2_evite_kg: null,
    realisee_at: null,
    aucun_repas_motif: null,
    lieu_overrides: null,
    evenement: {
      id: 'e1',
      organisation_id: 'org-1',
      traiteur_operationnel_organisation_id: 'org-1',
      created_by: 'user-1',
      nom_evenement: 'Salon',
      pax: 4200,
      type_evenement_id: 't1',
      reference_affaire: null,
      nom_client_organisateur: 'Maison Client',
      contact_principal_nom: 'Paul',
      contact_principal_telephone: '0611223344',
      contact_secours_nom: 'Léa',
      contact_secours_telephone: '0655443322',
      type_evenement: { libelle: 'Cocktail apéritif' },
      lieu: {
        id: 'l1',
        nom: 'Paris Expo',
        adresse_acces: '1 Place de la Porte de Versailles',
        code_postal: '75015',
        ville: 'Paris',
        acces_details: 'Hall 7',
      },
    },
    collecte_flux: [],
    ...over,
  };
}
