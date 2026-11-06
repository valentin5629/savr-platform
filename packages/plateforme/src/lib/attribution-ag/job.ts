import { sendEmail } from '@savr/shared/src/email/index.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { formatDateParis } from '@savr/shared/src/temps/index.js';
import { heureCourte } from '@/lib/exports/shared';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

export interface AttributionValideePayload {
  collecte_id: string;
  attribution_id: string;
  association_id: string;
  transporteur_id: string;
  branche: string;
  mode_validation: string;
}

export async function processAttributionValidee(
  payload: AttributionValideePayload,
): Promise<void> {
  const supabase = createAdminSupabaseClient();

  // Charger les données complètes pour les emails
  const { data: attribution, error: attrErr } = await supabase
    .from('attributions_antgaspi')
    .select(
      `id, branche_attribution, mode_validation,
       collectes!collecte_id(
         id, date_collecte, heure_collecte, volume_estime_repas,
         evenements!evenement_id(
           nom_evenement, pax,
           lieux!lieu_id(nom, adresse_acces, ville)
         )
       ),
       associations!association_id(nom, contact_email)`,
    )
    .eq('id', payload.attribution_id)
    .single();

  if (attrErr || !attribution) {
    throw new Error(`Attribution introuvable: ${payload.attribution_id}`);
  }

  const collecte =
    (attribution.collectes as unknown as Record<string, unknown>) ?? {};
  const evt = (collecte.evenements as Record<string, unknown>) ?? {};
  const asso =
    (attribution.associations as unknown as Record<string, unknown>) ?? {};

  const evenementNom =
    ((evt.nom_evenement as string | null) ?? '').trim() || 'Événement traiteur';
  const volumeEstime = (collecte.volume_estime_repas as number) ?? 0;

  // Emails via le canal canonique `sendEmail` (trace `emails_envoyes`, relance par le
  // cron email-retry). Best-effort : un envoi raté est tracé mais n'échoue pas le
  // job (sinon un retry renverrait l'email déjà parti).
  // Le transporteur ne reçoit plus d'email : sa mission lui parvient par son
  // outil de prestataire logistique ou par l'équipe Savr (revue des emails, Val
  // 2026-10-28).
  if (asso.contact_email) {
    await envoyer(
      'ag_attribution_association',
      asso.contact_email as string,
      {
        evenement_nom: evenementNom,
        date_collecte: formatDateParis(collecte.date_collecte as string),
        heure_collecte: heureCourte(collecte.heure_collecte),
        volume_estime_repas: String(volumeEstime),
      },
      payload.collecte_id,
    );
  }
}

async function envoyer(
  template: string,
  destinataire: string,
  variables: Record<string, string>,
  collecteId: string,
): Promise<void> {
  // Le corps est du HTML interpolé tel quel et part chez un tiers (association) :
  // chaque valeur est échappée.
  const echappees = Object.fromEntries(
    Object.entries(variables).map(([k, v]) => [k, escapeHtml(v)]),
  );
  try {
    await sendEmail(template, destinataire, echappees, {
      entityType: 'collectes',
      entityId: collecteId,
    });
  } catch (e) {
    // §07/01 api.external.failed (service=resend) — jamais le destinataire (PII).
    logger.error('api.external.failed', {
      service: 'resend',
      endpoint: 'sendEmail',
      template,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
