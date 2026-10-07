import type { createSupabaseServerClient } from '@/lib/api-auth.js';

type ClientSession = ReturnType<typeof createSupabaseServerClient>;

/**
 * Le lieu fait-il partie du PARC de l'organisation (`organisations_lieux`) ?
 *
 * Plus étroit que ce que la session LIT par `v_lieux_clients` : la policy
 * `lieux_clients_select` ouvre aussi les lieux où l'organisation a programmé un
 * événement (lieu détaché de son parc depuis, par exemple). Une action qui
 * engage « le gestionnaire du lieu » — déposer une demande de modification,
 * savoir qu'une demande est en cours — se borne au parc.
 *
 * Lu avec la session de l'utilisateur (policy de lecture de ses propres
 * rattachements) ; le filtre sur l'organisation est explicite.
 */
export async function estLieuDuParc(
  rls: ClientSession,
  organisationId: string,
  lieuId: string,
): Promise<{ ok: true; duParc: boolean } | { ok: false; error: unknown }> {
  const { data, error } = await rls
    .from('organisations_lieux')
    .select('lieu_id')
    .eq('organisation_id', organisationId)
    .eq('lieu_id', lieuId)
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error };
  return { ok: true, duParc: Boolean(data) };
}
