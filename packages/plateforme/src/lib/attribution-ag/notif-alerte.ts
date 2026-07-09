import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import type { AlgoAttributionResult } from './algo.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * BL-P2-30 (R22e) — Alertes Admin AG « aucune option » (in-app).
 *
 * §05 Règles métier :
 *  - l.61 « Si aucune association n'est éligible : alerte Admin Savr immédiate »
 *  - l.83/l.104/l.120 « Si aucun candidat éligible → branche aucun_prestataire,
 *    alerte Admin Savr » (province tri distance + branches IDF sans backup).
 *
 * Ces alertes sont FONCTIONNELLES → in-app (dashboard Admin), PAS Slack
 * (§07/03 §3 + CLAUDE.md §13 anti-doublon). Émises via la RPC idempotente
 * `f_upsert_alerte_admin` (skip si alerte ouverte identique existe déjà) au
 * point où l'algo détermine l'absence d'option (route recommandation).
 *
 * Best-effort : un échec d'émission d'alerte ne doit jamais faire échouer
 * l'affichage de la recommandation.
 */
export async function emettreAlertesAttributionSansOption(
  supabase: AdminSupabase,
  collecteId: string,
  result: AlgoAttributionResult,
): Promise<void> {
  const emissions: Array<{ code: string; titre: string; message: string }> = [];

  if (result.no_asso) {
    emissions.push({
      code: 'attribution_aucune_asso',
      titre: 'Attribution AG — aucune association éligible',
      message:
        `Aucune association éligible pour la collecte ${collecteId}. ` +
        'Traitement manuel requis (recherche libre).',
    });
  }

  if (result.no_prestataire) {
    emissions.push({
      code: 'attribution_aucun_prestataire',
      titre: 'Attribution AG — aucun transporteur éligible',
      message:
        `Aucun transporteur éligible pour la collecte ${collecteId} ` +
        `(branche ${result.branche}). Traitement manuel requis.`,
    });
  }

  for (const e of emissions) {
    const { error } = await supabase.rpc('f_upsert_alerte_admin', {
      p_code: e.code,
      p_titre: e.titre,
      p_message: e.message,
      p_entity_type: 'collecte',
      p_entity_id: collecteId,
    });
    if (error) {
      // Best-effort : l'alerte est un signal, jamais bloquant pour la reco.
      logger.error('attribution.alerte_sans_option_failed', {
        collecte_id: collecteId,
        code: e.code,
        error: error.message,
      });
    }
  }
}
