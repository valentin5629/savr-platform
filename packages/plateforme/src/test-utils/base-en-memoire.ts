/**
 * Base en mémoire pour les tests de bout en bout côté serveur : juste le
 * sous-ensemble du client Supabase que lisent et écrivent `sendEmail`, le worker
 * de retry et les suites d'un email perdu — assez pour faire tourner le VRAI
 * code d'un bout à l'autre, les lignes écrites par une étape étant relues par
 * la suivante.
 *
 * Ce n'est pas PostgREST : filtres par égalité / comparaison simple, pas de
 * jointure. Les fonctions SQL appelées par `.rpc()` sont fournies par le test
 * (`rpcs`) ; leur comportement réel est prouvé ailleurs, en pgTAP.
 */
export type Ligne = Record<string, unknown>;
export type Panne = { code: string; message: string };

export interface BaseEnMemoire {
  tables: Record<string, Ligne[]>;
  /**
   * Erreur à rendre au lieu d'exécuter : clé `<table>.select`, `<table>.insert`,
   * `<table>.update` ou `rpc.<nom>`.
   */
  pannes: Record<string, Panne>;
  rpcs: Record<string, (args: Ligne) => unknown>;
  /** Appels `.rpc()` reçus, dans l'ordre. */
  appelsRpc: Array<{ nom: string; args: Ligne }>;
  /** Listes de colonnes demandées par `.select()`, par table. */
  selects: Record<string, string[]>;
  /** Horloge des `created_at` posés à l'insertion. */
  maintenant: () => number;
  client: unknown;
}

type Resultat = { data: unknown; error: Panne | null };

function requete(
  base: BaseEnMemoire,
  table: string,
  mode: 'select' | 'update',
  patch: Ligne = {},
) {
  const filtres: Array<(l: Ligne) => boolean> = [];
  let tri: { colonne: string; croissant: boolean } | null = null;
  let limite: number | null = null;
  let rendreLignes = mode === 'select';

  const executer = (): { data: Ligne[] | null; error: Panne | null } => {
    const panne = base.pannes[`${table}.${mode}`];
    if (panne) return { data: null, error: panne };
    let lignes = (base.tables[table] ??= []).filter((l) =>
      filtres.every((f) => f(l)),
    );
    if (mode === 'update') for (const l of lignes) Object.assign(l, patch);
    if (tri) {
      const { colonne, croissant } = tri;
      lignes = [...lignes].sort((a, b) => {
        const [x, y] = [String(a[colonne]), String(b[colonne])];
        return (x < y ? -1 : x > y ? 1 : 0) * (croissant ? 1 : -1);
      });
    }
    if (limite !== null) lignes = lignes.slice(0, limite);
    return {
      data: rendreLignes ? lignes.map((l) => ({ ...l })) : null,
      error: null,
    };
  };

  const comparer =
    (test: (valeur: never, borne: never) => boolean) =>
    (colonne: string, borne: unknown) => {
      filtres.push((l) => test(l[colonne] as never, borne as never));
      return b;
    };

  const b = {
    eq: comparer((v, borne) => v === borne),
    neq: comparer((v, borne) => v !== borne),
    is: comparer((v, borne) => v === borne),
    gte: comparer((v, borne) => v >= borne),
    lt: comparer((v, borne) => v < borne),
    in: (colonne: string, valeurs: unknown[]) => {
      filtres.push((l) => valeurs.includes(l[colonne]));
      return b;
    },
    order: (colonne: string, opts?: { ascending?: boolean }) => {
      tri = { colonne, croissant: opts?.ascending !== false };
      return b;
    },
    limit: (n: number) => {
      limite = n;
      return b;
    },
    select: () => {
      rendreLignes = true;
      return b;
    },
    maybeSingle: async (): Promise<Resultat> => {
      const r = executer();
      return r.error ? r : { data: r.data?.[0] ?? null, error: null };
    },
    single: async (): Promise<Resultat> => {
      const r = executer();
      if (r.error) return r;
      const premiere = r.data?.[0];
      return premiere
        ? { data: premiere, error: null }
        : { data: null, error: { code: 'PGRST116', message: 'aucune ligne' } };
    },
    then: (
      siOk: (r: Resultat) => unknown,
      siKo?: (e: unknown) => unknown,
    ): Promise<unknown> => Promise.resolve(executer()).then(siOk, siKo),
  };
  return b;
}

export function creerBaseEnMemoire(
  tables: Record<string, Ligne[]> = {},
): BaseEnMemoire {
  const base: BaseEnMemoire = {
    tables,
    pannes: {},
    rpcs: {},
    appelsRpc: [],
    selects: {},
    maintenant: () => Date.now(),
    client: null,
  };

  base.client = {
    rpc: async (nom: string, args: Ligne = {}): Promise<Resultat> => {
      base.appelsRpc.push({ nom, args });
      const panne = base.pannes[`rpc.${nom}`];
      if (panne) return { data: null, error: panne };
      const fonction = base.rpcs[nom];
      if (!fonction) throw new Error(`rpc non prévue par le test : ${nom}`);
      return { data: fonction(args) ?? null, error: null };
    },
    from: (table: string) => ({
      select: (colonnes = '*') => {
        (base.selects[table] ??= []).push(colonnes);
        return requete(base, table, 'select');
      },
      update: (patch: Ligne) => requete(base, table, 'update', patch),
      insert: (ligne: Ligne) => {
        const panne = base.pannes[`${table}.insert`];
        const lignes = (base.tables[table] ??= []);
        const creee = {
          id: `${table}-${lignes.length + 1}`,
          created_at: new Date(base.maintenant()).toISOString(),
          ...ligne,
        };
        if (!panne) lignes.push(creee);
        const resultat: Resultat = panne
          ? { data: null, error: panne }
          : { data: { ...creee }, error: null };
        const ecrit = {
          select: () => ecrit,
          single: async () => resultat,
          then: (
            siOk: (r: Resultat) => unknown,
            siKo?: (e: unknown) => unknown,
          ): Promise<unknown> => Promise.resolve(resultat).then(siOk, siKo),
        };
        return ecrit;
      },
    }),
  };

  // Même contrat que `plateforme.f_upsert_alerte_admin` : pas de seconde alerte
  // tant qu'une alerte identique est ouverte.
  base.rpcs['f_upsert_alerte_admin'] = (args) => {
    const alertes = (base.tables['alertes_admin'] ??= []);
    const dejaOuverte = alertes.some(
      (a) =>
        a['code'] === args['p_code'] &&
        a['entity_type'] === args['p_entity_type'] &&
        a['entity_id'] === args['p_entity_id'] &&
        a['statut'] === 'ouverte',
    );
    if (!dejaOuverte) {
      alertes.push({
        id: `alertes_admin-${alertes.length + 1}`,
        created_at: new Date(base.maintenant()).toISOString(),
        code: args['p_code'],
        titre: args['p_titre'],
        message: args['p_message'],
        entity_type: args['p_entity_type'],
        entity_id: args['p_entity_id'],
        statut: 'ouverte',
        resolue_at: null,
      });
    }
    return null;
  };

  return base;
}
