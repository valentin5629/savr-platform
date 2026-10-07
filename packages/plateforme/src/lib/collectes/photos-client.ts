// Photos de collecte visibles du client (décision Val 2026-10-07).
//
// Le client ne voit que les photos que l'équipe Savr a choisies dans la fiche
// collecte Admin, 2 au maximum. Le choix vit dans `shared.fichiers.rang_client` :
// NULL = non choisie (réservée à l'équipe Savr), 1 ou 2 = choisie, à cette place.
// La limite de 2 est garantie en base (CHECK + index unique
// `uniq_fichiers_photo_client_rang`) ; ce module ne fait que proposer un rang
// libre et traduire le refus de la base en message lisible.

// `import type` : effacé à la compilation dans tous les modes. Ce module est aussi
// importé par l'écran (constante MAX_PHOTOS_CLIENT) : il ne doit rien tirer du
// client Supabase serveur dans le bundle navigateur.
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

export const ENTITE_PHOTO_COLLECTE = 'plateforme.collectes';
export const RANGS_CLIENT = [1, 2] as const;
export type RangClient = (typeof RANGS_CLIENT)[number];
export const MAX_PHOTOS_CLIENT = RANGS_CLIENT.length;

export const MESSAGE_MAX_PHOTOS_CLIENT =
  'Deux photos sont déjà visibles du client. Retirez-en une avant d’en choisir une autre.';

// Code Postgres d'une violation d'unicité : deux sélections simultanées ont visé
// le même rang, la base n'en garde qu'une.
export const CODE_RANG_DEJA_PRIS = '23505';

/**
 * Premier rang client libre pour une collecte, ou `null` si les deux sont pris.
 * Lecture indicative : entre cette lecture et l'écriture, une autre sélection
 * peut prendre le rang. C'est l'index unique qui tranche (cf. CODE_RANG_DEJA_PRIS).
 */
export async function rangClientLibre(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<RangClient | null> {
  const { data, error } = await supabase
    .schema('shared')
    .from('fichiers')
    .select('rang_client')
    .eq('entity_type', ENTITE_PHOTO_COLLECTE)
    .eq('entity_id', collecteId)
    .is('deleted_at', null)
    .not('rang_client', 'is', null);
  if (error) throw error;

  const pris = new Set(
    ((data ?? []) as { rang_client: number | null }[]).map(
      (l) => l.rang_client,
    ),
  );
  return RANGS_CLIENT.find((r) => !pris.has(r)) ?? null;
}
