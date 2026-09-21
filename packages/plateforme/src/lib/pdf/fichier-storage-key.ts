// Résolution `shared.fichiers.id` → clé R2 "bucket/key" (format attendu par
// getPresignedUrl / getObjectBytes).
//
// bordereaux_savr.pdf_fichier_id référence shared.fichiers (bucket + key, PAS de
// colonne `url`). L'embed PostgREST `fichiers:pdf_fichier_id(url)` depuis
// plateforme.bordereaux_savr ne peut pas marcher (colonne inexistante + relation
// cross-schema non exposée → PGRST200) : on lit la table shared explicitement.
// Sous client user-scopé, la policy fichiers_select (f_fichier_visible) est la
// frontière — un fichier hors périmètre est simplement absent de la Map.

import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';

export const FICHIER_STORAGE_SELECT = 'id, bucket, key';

export async function storageKeysDesFichiers(
  // Sous l'overlay G7 ce type devient SupabaseClient<Database> : la lecture
  // shared.fichiers ci-dessous reste vérifiée contre le schéma réel.
  supabase: SupabaseClient,
  fichierIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(fichierIds.filter((x): x is string => !!x))];
  const keys = new Map<string, string>();
  if (ids.length === 0) return keys;

  const { data, error } = await supabase
    .schema('shared')
    .from('fichiers')
    .select(FICHIER_STORAGE_SELECT)
    .in('id', ids)
    .is('deleted_at', null);
  if (error) throw error;

  for (const f of (data ?? []) as { id: string; bucket: string; key: string }[])
    keys.set(f.id, `${f.bucket}/${f.key}`);
  return keys;
}
