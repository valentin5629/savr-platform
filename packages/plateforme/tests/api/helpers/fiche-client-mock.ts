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
  const updates: Array<{ table: string; row: unknown }> = [];
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
      update: (row: unknown) => {
        updates.push({ table, row });
        return c;
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
    updates,
    selects,
    eqs,
    inserts,
    rpcCalls,
  };
  return api;
}

/**
 * Colonne réservée d'`evenements` (hors GRANT SELECT authenticated) telle que la
 * renvoie la lecture service-role du chargeur — à poser dans
 * `admin.results.evenements`. Depuis le lot B1 (décision Val 2026-10-23), seule
 * la référence d'affaire y est lue : les contacts sont ceux de la collecte
 * (`contactsCollecte`).
 */
export function reserveEvenement(over: Record<string, unknown> = {}) {
  return {
    reference_affaire: 'AFF-2026-042',
    ...over,
  };
}

/**
 * Contacts sur place de LA collecte (`collecte_contacts`, fermée aux clients,
 * lue en service-role par le chargeur — lots A et B1 de la refonte du
 * formulaire) — à poser dans `admin.results.collecte_contacts`.
 */
export function contactsCollecte(over: Record<string, unknown> = {}) {
  return {
    contact_principal_nom: 'Paul',
    contact_principal_telephone: '0611223344',
    contact_secours_nom: 'Léa',
    contact_secours_telephone: '0655443322',
    ...over,
  };
}

/**
 * Ligne `collectes` telle que la renvoie la lecture RLS du chargeur : l'embed
 * `evenement` ne porte AUCUNE colonne réservée (contacts, référence d'affaire).
 * Le type d'événement est celui de LA collecte (lot B1, décision Val
 * 2026-10-23) : l'embed `evenement` n'en porte plus.
 */
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
    co2_evite_kg: null,
    realisee_at: null,
    aucun_repas_motif: null,
    lieu_overrides: null,
    type_evenement_id: 't1',
    type_evenement: { libelle: 'Cocktail apéritif' },
    evenement: {
      id: 'e1',
      organisation_id: 'org-1',
      traiteur_operationnel_organisation_id: 'org-1',
      created_by: 'user-1',
      nom_evenement: 'Salon',
      pax: 4200,
      nom_client_organisateur: 'Maison Client',
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
