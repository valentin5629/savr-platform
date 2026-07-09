import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { logger } from '@savr/shared/src/logger/index.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * BL-P2-30 (R22e) — Pont trigger → email pour le template 9 admin_pack_ag_etat.
 *
 * Les triggers de débit (fn_trg_pack_debit_realisee / _annulation_tardive)
 * écrivent une alerte in-app `pack_ag_bas` (franchissement ≤ 10 %, §05 l.1018)
 * ou `pack_ag_epuise` (§05 l.196). Un trigger DB ne peut pas envoyer d'email :
 * ce module scanne les alertes pack non encore notifiées et envoie le template 9
 * (§06.02 l.199-205, destinataire = tous les admin_savr via l'inbox partagée).
 *
 * Idempotent : `email_notifie_at` est posé après envoi → jamais de doublon.
 * Un recrédit qui ré-arme le déclencheur RÉSOUT l'alerte (statut='resolue'),
 * une nouvelle alerte (email_notifie_at NULL) sera ré-envoyée au franchissement
 * suivant (F4).
 */

// Inbox admin partagée — même destinataire que le template 10 (incident collecte).
const ADMIN_INBOX = 'hello@gosavr.io';

const CODE_PACK_ETAT = ['pack_ag_bas', 'pack_ag_epuise'] as const;

interface AlertePack {
  id: string;
  code: string;
  entity_id: string | null;
}

interface PackContexte {
  credits_initiaux: number;
  credits_restants: number | null;
  credits_consommes: number;
  type_pack: string;
  organisation_id: string;
  organisations: { nom: string } | { nom: string }[] | null;
}

export interface NotifyPackEtatResult {
  nb_traite: number;
  ids: string[];
}

/**
 * Scanne alertes_admin (pack_ag_bas / pack_ag_epuise, ouvertes, non notifiées),
 * envoie le template 9 avec les variables du pack, puis pose email_notifie_at.
 */
export async function traiterAlertesPackEtat(
  supabase: AdminSupabase,
): Promise<NotifyPackEtatResult> {
  const { data: alertes, error } = await supabase
    .from('alertes_admin')
    .select('id, code, entity_id')
    .in('code', CODE_PACK_ETAT as unknown as string[])
    .eq('statut', 'ouverte')
    .is('email_notifie_at', null)
    .limit(100);

  if (error) throw new Error(`alertes_admin scan: ${error.message}`);

  const traite: string[] = [];

  for (const a of (alertes ?? []) as AlertePack[]) {
    if (!a.entity_id) continue;

    const { data: pack } = await supabase
      .from('packs_antgaspi')
      .select(
        'credits_initiaux, credits_restants, credits_consommes, type_pack, organisation_id, organisations!organisation_id(nom)',
      )
      .eq('id', a.entity_id)
      .maybeSingle();

    if (!pack) {
      // Pack disparu (rare) : ne pas rester bloqué, marquer notifié pour ne pas
      // rescanner en boucle (l'alerte reste consultable in-app).
      await supabase
        .from('alertes_admin')
        .update({ email_notifie_at: new Date().toISOString() })
        .eq('id', a.id);
      continue;
    }

    const p = pack as PackContexte;
    const org = Array.isArray(p.organisations)
      ? p.organisations[0]
      : p.organisations;
    const restants =
      p.credits_restants ?? p.credits_initiaux - p.credits_consommes;
    const pct =
      p.credits_initiaux > 0
        ? Math.round((restants / p.credits_initiaux) * 100)
        : 0;

    // Dernière collecte rattachée au pack (best-effort, pour le corps du mail).
    const { data: derniere } = await supabase
      .from('collectes')
      .select('date_collecte')
      .eq('pack_antgaspi_id', a.entity_id)
      .order('date_collecte', { ascending: false })
      .limit(1)
      .maybeSingle();

    const estBas = a.code === 'pack_ag_bas';
    const niveau = estBas ? 'bas' : 'epuise';
    const etatLibelle = estBas ? 'bientôt épuisé' : 'épuisé';

    try {
      await sendEmail(
        'admin_pack_ag_etat',
        ADMIN_INBOX,
        {
          niveau,
          etat_libelle: etatLibelle,
          organisation_nom: org?.nom ?? '',
          type_pack: p.type_pack,
          credits_restants: String(restants),
          credits_initiaux: String(p.credits_initiaux),
          pct_restant: String(pct),
          derniere_collecte_date:
            (derniere as { date_collecte?: string } | null)?.date_collecte ??
            '',
          // Bloc conditionnel du template 9 (un seul actif selon le niveau).
          niveau_bas: estBas ? 'true' : '',
          niveau_epuise: estBas ? '' : 'true',
          lien_fiche_org: `https://app.gosavr.io/admin/organisations/${p.organisation_id}`,
        },
        { entityType: 'pack_antgaspi', entityId: a.entity_id },
      );
    } catch (err) {
      // Envoi en échec : ne PAS poser email_notifie_at → rescanné au prochain run.
      logger.error('pack.etat_email_failed', {
        alerte_id: a.id,
        pack_id: a.entity_id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    await supabase
      .from('alertes_admin')
      .update({ email_notifie_at: new Date().toISOString() })
      .eq('id', a.id);

    traite.push(a.id);
  }

  return { nb_traite: traite.length, ids: traite };
}
