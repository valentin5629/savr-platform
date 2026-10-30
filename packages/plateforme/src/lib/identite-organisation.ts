import { createHash } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/api-auth';

/** Proxy du logo de sa propre organisation (`app/api/v1/mon-organisation/logo`). */
const ROUTES_API_MON_ORGANISATION_LOGO = '/api/v1/mon-organisation/logo';

/** Organisation affichée en haut à droite de l'en-tête (Val 2026-10-30). */
export interface IdentiteOrganisation {
  nom: string;
  /** URL du proxy de logo, `null` si l'organisation n'en a pas (avatar à initiales). */
  logoSrc: string | null;
}

/**
 * Nom et logo de l'organisation de l'utilisateur connecté, lus sous son propre
 * rôle (RLS : chaque rôle client lit sa propre organisation). Best-effort :
 * une erreur de lecture rend `null`, l'en-tête retombe alors sur l'email.
 */
export async function chargerIdentiteOrganisation(
  organisationId: string,
): Promise<IdentiteOrganisation | null> {
  try {
    const supabase = createSupabaseServerClient({ readonly: true });
    const { data } = await supabase
      .from('organisations')
      .select('nom, logo_url')
      .eq('id', organisationId)
      .maybeSingle();
    if (!data?.nom) return null;
    const logo = data.logo_url as string | null;
    return {
      nom: data.nom as string,
      // La version suit la clé : un nouveau logo n'est pas masqué par le cache
      // navigateur du proxy (5 min), et la clé R2 n'apparaît pas dans l'URL.
      logoSrc: logo
        ? `${ROUTES_API_MON_ORGANISATION_LOGO}?v=${createHash('sha1').update(logo).digest('hex').slice(0, 10)}`
        : null,
    };
  } catch {
    return null;
  }
}
