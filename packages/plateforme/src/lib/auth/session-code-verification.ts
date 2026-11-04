import type { createSupabaseServerClient } from '@/lib/api-auth';
import { claimsJeton } from '@/lib/claims-jeton';

type ClientServeur = ReturnType<typeof createSupabaseServerClient>;
type User = NonNullable<
  Awaited<ReturnType<ClientServeur['auth']['getUser']>>['data']['user']
>;

/**
 * Session lue par l'écran et les routes du code de vérification
 * (`lib/code-verification.ts`). Ils doivent accepter une session de l'équipe
 * Savr qui n'a pas encore passé le code : ils n'utilisent donc pas
 * `getVerifiedClaims`, qui la refuse.
 */
export interface SessionCodeVerification {
  user: User;
  role: string | undefined;
  aal: unknown;
}

/** `null` sans session valide auprès de GoTrue (`getUser()`). */
export async function lireSessionCodeVerification(
  supabase: ClientServeur,
): Promise<SessionCodeVerification | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Le jeton est celui de la session que `getUser()` vient de valider.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const claims = claimsJeton(session?.access_token);
  const role = claims['user_role'];
  return {
    user,
    role: typeof role === 'string' ? role : undefined,
    aal: claims['aal'],
  };
}
