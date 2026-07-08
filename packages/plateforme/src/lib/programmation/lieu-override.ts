import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

export interface OverrideLieuParams {
  evenementId: string;
  lieuId: string;
  overrides: Record<string, unknown>;
  userId: string;
  role: string | null;
}

/**
 * BL-P1-PROG-01 — signalement léger d'un override de lieu à la programmation.
 * CDC §06.01 l.111 : « Notification Admin Savr (signalement léger — le diff avant/après
 * est lisible via lieu_overrides vs lieux officiel + tracé audit_log) ». Le référentiel
 * lieux n'est PAS mis à jour automatiquement (l.112).
 *
 * Best-effort / non bloquant : n'échoue jamais la programmation.
 */
export async function notifierOverrideLieu(
  supabase: AdminSupabase,
  params: OverrideLieuParams,
): Promise<void> {
  const champs = Object.keys(params.overrides).join(', ');

  // Notification Admin in-app dédupliquée (aucun email — signalement léger).
  try {
    await supabase.rpc('f_upsert_alerte_admin', {
      p_code: 'lieu_override_programmation',
      p_titre: 'Lieu modifié à la programmation',
      p_message: `Des champs du lieu (${champs}) ont été modifiés à la programmation (override per-collecte). Le référentiel lieu n'est pas mis à jour automatiquement.`,
      p_entity_type: 'evenements',
      p_entity_id: params.evenementId,
    });
  } catch {
    // best-effort : n'échoue jamais la programmation.
  }

  // Trace audit_log : le diff avant/après est lisible via lieu_overrides vs lieu officiel.
  try {
    await supabase.from('audit_log').insert({
      table_name: 'lieux',
      record_id: params.lieuId,
      action: 'lieu_override_programmation',
      user_id: params.userId,
      role: params.role,
      new_values: {
        evenement_id: params.evenementId,
        lieu_overrides: params.overrides,
      },
    });
  } catch {
    // best-effort.
  }
}
