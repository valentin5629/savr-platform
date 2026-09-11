import { sendEmail } from '@savr/shared/src/email/index.js';
import { logger } from '@savr/shared/src/logger/index.js';
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
       associations!association_id(nom, adresse, ville, contact_email),
       transporteurs!transporteur_id(nom, contact_email, type_tms)`,
    )
    .eq('id', payload.attribution_id)
    .single();

  if (attrErr || !attribution) {
    throw new Error(`Attribution introuvable: ${payload.attribution_id}`);
  }

  const collecte =
    (attribution.collectes as unknown as Record<string, unknown>) ?? {};
  const evt = (collecte.evenements as Record<string, unknown>) ?? {};
  const lieu = (evt.lieux as Record<string, unknown>) ?? {};
  const asso =
    (attribution.associations as unknown as Record<string, unknown>) ?? {};
  const transp =
    (attribution.transporteurs as unknown as Record<string, unknown>) ?? {};

  const evenementNom = (evt.nom_evenement as string) ?? '';
  const dateCollecte = `${collecte.date_collecte as string} ${collecte.heure_collecte as string}`;
  const lieuAdresse = `${lieu.adresse_acces as string}, ${lieu.ville as string}`;
  const volumeEstime = (collecte.volume_estime_repas as number) ?? 0;
  const assoAdresse = `${asso.adresse as string}, ${asso.ville as string}`;

  // Emails via le canal canonique `sendEmail` (trace `emails_envoyes`, relance par le
  // cron email-retry). L'ancienne RPC `fn_envoyer_email_template` n'a JAMAIS existé
  // (ni migration, ni dev, ni prod) : aucun email d'attribution n'était envoyé.
  // Best-effort : un envoi raté est tracé mais n'échoue pas le job (sinon un retry
  // renverrait l'email déjà parti à l'autre destinataire).
  if (asso.contact_email) {
    await envoyer(
      'ag_attribution_association',
      asso.contact_email as string,
      {
        evenement_nom: evenementNom,
        date_collecte: dateCollecte,
        lieu_adresse: lieuAdresse,
        volume_estime_repas: String(volumeEstime),
        transporteur_nom: String(transp.nom ?? ''),
      },
      payload.collecte_id,
    );
  }

  if (transp.contact_email) {
    await envoyer(
      'ag_attribution_transporteur',
      transp.contact_email as string,
      {
        evenement_nom: evenementNom,
        date_collecte: dateCollecte,
        lieu_adresse: lieuAdresse,
        association_adresse: assoAdresse,
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
  try {
    await sendEmail(template, destinataire, variables, {
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
