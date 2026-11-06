import { createHash } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/api-auth';

/** Proxy du logo de sa propre organisation (`app/api/v1/mon-organisation/logo`). */
const ROUTE_LOGO = '/api/v1/mon-organisation/logo';

/**
 * Qui est connecté (Val 2026-11-01) : le nom de l'utilisateur et son poste en
 * bas de la barre latérale, le logo de l'organisation en haut à droite du
 * bandeau de page (clients seulement).
 */
export interface IdentiteSession {
  /** Nom de l'organisation ; `null` si illisible. */
  organisation: string | null;
  /** URL du proxy de logo, `null` sans logo (tuile à initiales). */
  logoSrc: string | null;
  /** Faux pour le staff : pas de tuile d'organisation dans le bandeau. */
  logoAffichable: boolean;
  /** « Prénom Nom », repli sur l'email. */
  utilisateur: string;
  /** Poste saisi dans « Mon profil », `null` si vide. */
  poste: string | null;
}

/**
 * Lit l'identité de l'utilisateur connecté SOUS SON PROPRE RÔLE (RLS) : sa
 * fiche (`usr_self_select`) puis son organisation. Best-effort : une lecture
 * en échec retombe sur l'email, jamais d'erreur dans le layout.
 *
 * `logoAffichable` : faux pour le staff, que la route du logo refuse (rôles
 * clients seulement) — on n'émet pas une requête vouée au 403.
 */
export async function chargerIdentiteSession({
  userId,
  email,
  logoAffichable,
}: {
  userId: string;
  email: string;
  logoAffichable: boolean;
}): Promise<IdentiteSession> {
  const repli: IdentiteSession = {
    organisation: null,
    logoSrc: null,
    logoAffichable,
    utilisateur: email,
    poste: null,
  };
  try {
    const supabase = createSupabaseServerClient({ readonly: true });
    const { data: user } = await supabase
      .from('users')
      .select('prenom, nom, poste, organisation_id')
      .eq('id', userId)
      .maybeSingle();
    if (!user) return repli;
    const nomComplet = [user.prenom, user.nom]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .join(' ');

    const { data: org } = await supabase
      .from('organisations')
      .select('nom, logo_url')
      .eq('id', user.organisation_id as string)
      .maybeSingle();
    const logo = logoAffichable ? (org?.logo_url as string | null) : null;
    return {
      organisation: (org?.nom as string | undefined) ?? null,
      // La version suit la clé : un nouveau logo n'est pas masqué par le cache
      // navigateur du proxy (5 min), et la clé R2 n'apparaît pas dans l'URL.
      logoSrc: logo
        ? `${ROUTE_LOGO}?v=${createHash('sha1').update(logo).digest('hex').slice(0, 10)}`
        : null,
      logoAffichable,
      utilisateur: nomComplet || email,
      poste:
        typeof user.poste === 'string' && user.poste.trim()
          ? user.poste.trim()
          : null,
    };
  } catch {
    return repli;
  }
}
