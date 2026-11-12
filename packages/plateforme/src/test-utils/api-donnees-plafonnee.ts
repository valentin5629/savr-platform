/**
 * Fausse API de données pour les tests de volume : le sous-ensemble du client
 * Supabase que lisent les listes, les dashboards et les exports, avec les DEUX
 * plafonds de PostgREST mesurés sur savr-dev (cf. `lib/pdf/selection-par-pages.ts`) :
 *  - une réponse est amputée à 1 000 lignes, sans erreur ;
 *  - un filtre `in.(…)` trop long fait échouer la lecture (« fetch failed »).
 * Un code qui lit tout en une requête, ou qui passe une liste entière
 * d'identifiants, y obtient ce qu'il obtiendrait en production : un résultat
 * amputé ou une erreur.
 *
 * Ce n'est pas PostgREST : les filtres ne portent que sur les colonnes de la
 * table lue. Un filtre sur une table embarquée (`evenements.lieu_id`), `or` et
 * `filter` sont consignés sans rien écarter : au test de ne poser dans la table
 * que les lignes du périmètre. Les fonctions SQL appelées par `.rpc()` sont
 * fournies par le test (`rpcs`).
 *
 * Une fonction qui rend des lignes se filtre, se trie et se borne comme une
 * table (`.rpc(…).eq(…).order(…).limit(…)`) : le banc applique ces maillons à ce
 * que rend la fonction du test, et ampute la réponse au même plafond (mesuré le
 * 2026-11-11 sur PostgREST 14.12 : 1 100 lignes rendues par une fonction, 1 000
 * servies sans limite, HTTP 206 ; les filtres jouent avant le plafond). Ces
 * lectures sont consignées sous le nom `rpc.<fonction>`.
 */
export type Ligne = Record<string, unknown>;
export type Erreur = { message: string; code?: string };

/** Lignes rendues au plus par réponse (`max_rows`, supabase/config.toml). */
export const PLAFOND_LIGNES = 1000;
/** 390 identifiants passent, 402 échouent (mesuré) : au-delà de 390, échec. */
export const PLAFOND_IDS = 390;

export interface Lecture {
  table: string;
  colonnes: string;
  /** Filtres reçus, dans l'ordre : [opérateur, colonne, valeur]. */
  filtres: Array<[string, string, unknown]>;
  tris: string[];
  limite: number | null;
  plage: [number, number] | null;
  /** Lignes rendues par cette lecture (0 si elle a échoué). */
  rendues: number;
}

/** `count` : le total demandé par `select(…, { count: 'exact' })`, sinon null ; absent d'une valeur seule rendue par une fonction. */
type Reponse = { data: unknown; error: Erreur | null; count?: number | null };

/** null et undefined en dernier, comme `nullsFirst: false`. */
function comparer(a: unknown, b: unknown): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function creerApiPlafonnee(tables: Record<string, Ligne[]> = {}) {
  const api = {
    tables,
    /** Erreur à rendre au lieu de lire : clé `<table>` ou `rpc.<nom>`. */
    pannes: {} as Record<string, Erreur>,
    rpcs: {} as Record<string, (args: Ligne) => unknown>,
    /** Lectures reçues, dans l'ordre. */
    lectures: [] as Lecture[],
    appelsRpc: [] as Array<{ nom: string; args: Ligne }>,
    /** Plus grand nombre d'appels `.rpc()` en cours au même instant. */
    rpcSimultanesMax: 0,
    client: null as unknown,
    lecturesDe: (table: string) =>
      api.lectures.filter((l) => l.table === table),
  };
  let rpcEnCours = 0;

  /**
   * Requête filtrable sur des lignes : celles d'une table, ou celles que rend
   * une fonction. `source` rend les lignes à filtrer, ou une réponse toute faite
   * (panne, valeur seule) ; `resoudre` dit quand la requête s'exécute.
   */
  const requeteSur = (
    table: string,
    source: () => Ligne[] | Reponse,
    resoudre: (executer: () => Reponse) => Promise<Reponse>,
  ) => {
    const lecture: Lecture = {
      table,
      colonnes: '*',
      filtres: [],
      tris: [],
      limite: null,
      plage: null,
      rendues: 0,
    };
    api.lectures.push(lecture);
    const predicats: Array<(l: Ligne) => boolean> = [];
    const tris: Array<{ colonne: string; croissant: boolean }> = [];
    let avecTotal = false;
    let listeTropLongue = false;

    const deLaTable = (colonne: string) => !colonne.includes('.');

    const executer = (): Reponse => {
      const lu = source();
      if (!Array.isArray(lu)) return lu;
      if (listeTropLongue)
        return {
          data: null,
          error: { message: 'TypeError: fetch failed' },
          count: null,
        };
      let lignes = lu.filter((l) => predicats.every((p) => p(l)));
      if (tris.length > 0)
        lignes = [...lignes].sort((a, b) => {
          for (const { colonne, croissant } of tris) {
            const ordre = comparer(a[colonne], b[colonne]);
            if (ordre !== 0) return croissant ? ordre : -ordre;
          }
          return 0;
        });
      const debut = lecture.plage ? lecture.plage[0] : 0;
      const demandees = lecture.plage
        ? lecture.plage[1] - lecture.plage[0] + 1
        : (lecture.limite ?? PLAFOND_LIGNES);
      const page = lignes.slice(
        debut,
        debut + Math.min(demandees, PLAFOND_LIGNES),
      );
      lecture.rendues = page.length;
      return {
        // Copie des lignes ; une fonction peut aussi rendre des valeurs nues.
        data: page.map((l) =>
          l !== null && typeof l === 'object' ? { ...l } : l,
        ),
        error: null,
        count: avecTotal ? lignes.length : null,
      };
    };

    const filtrer =
      (operateur: string, garde: (valeur: never, borne: never) => boolean) =>
      (colonne: string, borne: unknown) => {
        lecture.filtres.push([operateur, colonne, borne]);
        if (deLaTable(colonne))
          predicats.push((l) => garde(l[colonne] as never, borne as never));
        return requete;
      };

    const requete = {
      select: (colonnes = '*', options?: { count?: string }) => {
        lecture.colonnes = colonnes;
        avecTotal = options?.count === 'exact';
        return requete;
      },
      eq: filtrer('eq', (v, borne) => v === borne),
      neq: filtrer('neq', (v, borne) => v !== borne),
      gt: filtrer('gt', (v, borne) => v > borne),
      gte: filtrer('gte', (v, borne) => v >= borne),
      lt: filtrer('lt', (v, borne) => v < borne),
      lte: filtrer('lte', (v, borne) => v <= borne),
      is: filtrer('is', (v, borne) => (v ?? null) === borne),
      in: (colonne: string, valeurs: unknown[]) => {
        lecture.filtres.push(['in', colonne, valeurs]);
        if (valeurs.length > PLAFOND_IDS) listeTropLongue = true;
        if (deLaTable(colonne))
          predicats.push((l) => valeurs.includes(l[colonne]));
        return requete;
      },
      not: (colonne: string, operateur: string, valeur: unknown) => {
        lecture.filtres.push([`not.${operateur}`, colonne, valeur]);
        if (deLaTable(colonne) && operateur === 'is' && valeur === null)
          predicats.push((l) => l[colonne] != null);
        return requete;
      },
      or: (filtre: string) => {
        lecture.filtres.push(['or', '', filtre]);
        return requete;
      },
      filter: (colonne: string, operateur: string, valeur: unknown) => {
        lecture.filtres.push([operateur, colonne, valeur]);
        return requete;
      },
      order: (
        colonne: string,
        options?: { ascending?: boolean; referencedTable?: string },
      ) => {
        lecture.tris.push(colonne);
        if (deLaTable(colonne) && !options?.referencedTable)
          tris.push({ colonne, croissant: options?.ascending !== false });
        return requete;
      },
      limit: (n: number) => {
        lecture.limite = n;
        return requete;
      },
      range: (de: number, a: number) => {
        lecture.plage = [de, a];
        return requete;
      },
      maybeSingle: async () => {
        const r = await resoudre(executer);
        return r.error
          ? r
          : { data: (r.data as Ligne[])[0] ?? null, error: null, count: null };
      },
      then: (
        siOk: (r: Reponse) => unknown,
        siKo?: (e: unknown) => unknown,
      ): Promise<unknown> => resoudre(executer).then(siOk, siKo),
    };
    return requete;
  };

  const from = (table: string) =>
    requeteSur(
      table,
      () => {
        const panne = api.pannes[table];
        return panne
          ? { data: null, error: panne, count: null }
          : (api.tables[table] ?? []);
      },
      // Exécutée à l'instant où la requête est attendue.
      (executer) => Promise.resolve(executer()),
    );

  const rpc = (nom: string, args: Ligne = {}) => {
    api.appelsRpc.push({ nom, args });
    rpcEnCours++;
    api.rpcSimultanesMax = Math.max(api.rpcSimultanesMax, rpcEnCours);
    // Un tour de boucle : les appels lancés ensemble se chevauchent. L'appel est
    // compté dès qu'il est lancé ; les maillons posés à sa suite (`.eq`,
    // `.limit`…) le sont avant ce tour, donc avant l'exécution.
    const fini = new Promise<void>((tour) => setTimeout(tour, 0)).then(() => {
      rpcEnCours--;
    });
    return requeteSur(
      `rpc.${nom}`,
      () => {
        const panne = api.pannes[`rpc.${nom}`];
        if (panne) return { data: null, error: panne };
        const fonction = api.rpcs[nom];
        if (!fonction) throw new Error(`rpc non prévue par le test : ${nom}`);
        const rendu = fonction(args) ?? null;
        // Une valeur seule (nombre, booléen, objet) est rendue telle quelle.
        return Array.isArray(rendu)
          ? (rendu as Ligne[])
          : { data: rendu, error: null };
      },
      (executer) => fini.then(executer),
    );
  };

  api.client = { from, rpc };
  return api;
}
