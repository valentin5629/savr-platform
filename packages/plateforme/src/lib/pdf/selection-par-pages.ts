// Sélections des batchs PDF J+1, lues sans dépendre du nombre de collectes clôturées.
//
// Ces batchs relisent chaque nuit TOUTES les collectes clôturées de leur type, puis
// les documents déjà émis pour ces collectes. Deux plafonds de l'API de données
// rendaient cette lecture fausse passé un certain volume (mesurés sur savr-dev le
// 2026-10-09) :
//   - une réponse est amputée à 1000 lignes, SANS erreur (2010 lignes en base, 1000
//     rendues) : au-delà, des collectes clôturées n'étaient plus vues, donc jamais
//     documentées ;
//   - PostgREST recopie l'URL de la requête dans l'en-tête `Content-Location` de sa
//     réponse : un filtre `in.(…)` de 402 UUID a fait dépasser les 16 Ko d'en-têtes
//     que le client HTTP de Node accepte (`UND_ERR_HEADERS_OVERFLOW`, remonté en
//     « TypeError: fetch failed ») ; 390 UUID passaient encore. Le batch ZD s'arrêtait
//     alors en échec de sélection, chaque nuit, pour toutes les collectes.
//
// À ne pas confondre avec `lireParTranches` de `lib/exports/shared.ts`, qui lit des
// tranches de LIGNES par position (`range` + total) et lève une erreur d'export.

/**
 * Collectes lues par requête. Doit rester sous le plafond de lignes d'une réponse
 * (`max_rows`, 1000) : une page pleine est le seul signal qu'il reste des lignes à
 * lire. Épinglé par un test contre `supabase/config.toml`.
 */
export const TAILLE_PAGE = 200;

/** Identifiants par filtre `in.(…)` : une URL d'environ 4 000 caractères. */
export const TAILLE_LOT = 100;

const PLAFOND_LIGNES_REPONSE = 1000;

type ErreurLecture = { message: string; code?: string };

type Reponse = PromiseLike<{ data: unknown; error: ErreurLecture | null }>;

/**
 * Lit toutes les lignes d'une sélection, page après page, dans l'ordre des `id`.
 * `lirePage(apresId)` doit trier par `id` croissant, se limiter à `TAILLE_PAGE` et,
 * si `apresId` n'est pas null, ne rendre que les `id` strictement supérieurs. Cette
 * pagination par clé ne rend jamais deux fois la même ligne, même si une collecte
 * est clôturée pendant la lecture (le cron de clôture tourne à la même minute).
 *
 * Chaque page est contrôlée : ses `id` doivent croître strictement, à partir de
 * `apresId`. Une requête qui oublierait le tri ou la borne rendrait des doublons et
 * des manques SANS erreur (mesuré sur PostgREST local, sans tri : 29 lignes, pages
 * de 10 → 50 lues, 33 doublons, 12 manquantes) — et, borne ignorée, une lecture sans
 * fin. C'est rendu ici comme une erreur.
 *
 * Première erreur rendue telle quelle, sans ligne : l'appelant reste fail-closed.
 */
export async function lireParPages<T extends { id: string }>(
  lirePage: (apresId: string | null) => Reponse,
): Promise<{ data: T[]; error: ErreurLecture | null }> {
  const lignes: T[] = [];
  let apresId: string | null = null;
  for (;;) {
    const { data, error } = await lirePage(apresId);
    if (error) return { data: [], error };
    const page = (data ?? []) as T[];
    for (const ligne of page) {
      if (apresId !== null && ligne.id <= apresId) {
        return {
          data: [],
          error: { message: 'page non triée par id strictement croissant' },
        };
      }
      apresId = ligne.id;
    }
    lignes.push(...page);
    if (page.length < TAILLE_PAGE) return { data: lignes, error: null };
  }
}

/**
 * Lit les lignes rattachées à une liste d'identifiants, par lots de `TAILLE_LOT`.
 * Un lot au plafond de lignes serait une réponse amputée : rendu comme une erreur,
 * pour qu'un document déjà émis ne passe jamais pour absent.
 */
export async function lireParLots<T>(
  ids: string[],
  lireLot: (lot: string[]) => Reponse,
): Promise<{ data: T[]; error: ErreurLecture | null }> {
  const lignes: T[] = [];
  for (let i = 0; i < ids.length; i += TAILLE_LOT) {
    const { data, error } = await lireLot(ids.slice(i, i + TAILLE_LOT));
    if (error) return { data: [], error };
    const lot = (data ?? []) as T[];
    if (lot.length >= PLAFOND_LIGNES_REPONSE) {
      return {
        data: [],
        error: { message: 'lot au plafond de lignes de la réponse' },
      };
    }
    lignes.push(...lot);
  }
  return { data: lignes, error: null };
}
