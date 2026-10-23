import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Contacts sur place d'UNE collecte (refonte du formulaire, lots A et B1,
 * décisions Val 2026-10-22 et 2026-10-23). Table `collecte_contacts` fermée aux
 * clients : lue en service-role, par la route qui a vérifié le droit.
 */
export const COLONNES_CONTACTS_COLLECTE =
  'contact_principal_nom, contact_principal_telephone, contact_secours_nom, contact_secours_telephone';

export const CHAMPS_CONTACTS_COLLECTE = [
  'contact_principal_nom',
  'contact_principal_telephone',
  'contact_secours_nom',
  'contact_secours_telephone',
] as const;

export interface ContactsCollecte {
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
}

/**
 * Lit les contacts d'une collecte. `{ erreur }` si la lecture échoue : un
 * échec ne doit jamais se lire comme « aucun contact ».
 */
export async function lireContactsCollecte(
  admin: AdminSupabase,
  collecteId: string,
): Promise<{ contacts: ContactsCollecte | null } | { erreur: unknown }> {
  const { data, error } = await admin
    .from('collecte_contacts')
    .select(COLONNES_CONTACTS_COLLECTE)
    .eq('collecte_id', collecteId)
    .maybeSingle();
  if (error) return { erreur: error };
  return { contacts: (data as ContactsCollecte | null) ?? null };
}
