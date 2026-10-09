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

/**
 * Collectes lues par requête. Doit rester sous le plafond de lignes d'une réponse
 * (1000) : une page pleine est le seul signal qu'il reste des lignes à lire.
 */
export const TAILLE_PAGE = 200;

/** Identifiants par filtre `in.(…)` : une URL d'environ 4 000 caractères. */
export const TAILLE_TRANCHE = 100;

const PLAFOND_LIGNES_REPONSE = 1000;

type ErreurLecture = { message: string; code?: string };

type Reponse = PromiseLike<{ data: unknown; error: ErreurLecture | null }>;

/**
 * Lit toutes les lignes d'une sélection, page après page, dans l'ordre des `id`.
 * `lirePage(apresId)` doit trier par `id` croissant, se limiter à `TAILLE_PAGE` et,
 * si `apresId` n'est pas null, ne rendre que les `id` strictement supérieurs. Cette
 * pagination par clé ne rend jamais deux fois la même ligne, même si une collecte
 * est clôturée pendant la lecture (le cron de clôture tourne à la même minute).
 * Première erreur rendue telle quelle : l'appelant reste fail-closed.
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
    lignes.push(...page);
    if (page.length < TAILLE_PAGE) return { data: lignes, error: null };
    apresId = page[page.length - 1]!.id;
  }
}

/**
 * Lit les lignes rattachées à une liste d'identifiants, par tranches de
 * `TAILLE_TRANCHE`. Une tranche au plafond de lignes serait une réponse amputée :
 * rendue comme une erreur, pour qu'un document déjà émis ne passe jamais pour absent.
 */
export async function lireParTranches<T>(
  ids: string[],
  lireTranche: (tranche: string[]) => Reponse,
): Promise<{ data: T[]; error: ErreurLecture | null }> {
  const lignes: T[] = [];
  for (let i = 0; i < ids.length; i += TAILLE_TRANCHE) {
    const { data, error } = await lireTranche(ids.slice(i, i + TAILLE_TRANCHE));
    if (error) return { data: [], error };
    const tranche = (data ?? []) as T[];
    if (tranche.length >= PLAFOND_LIGNES_REPONSE) {
      return {
        data: [],
        error: { message: 'tranche au plafond de lignes de la réponse' },
      };
    }
    lignes.push(...tranche);
  }
  return { data: lignes, error: null };
}
