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

  // Email → association bénéficiaire
  if (asso.contact_email) {
    const { error: emailErr } = await supabase.rpc(
      'fn_envoyer_email_template',
      {
        p_template_code: 'ag_attribution_association',
        p_destinataire: asso.contact_email,
        p_variables: {
          evenement_nom: evenementNom,
          date_collecte: dateCollecte,
          lieu_adresse: lieuAdresse,
          volume_estime_repas: volumeEstime,
          transporteur_nom: transp.nom,
        },
      },
    );
    if (emailErr) {
      // §07/01 api.external.failed (service=resend). On NE logge PAS le destinataire
      // (PII) — seul le template + le message d'erreur RPC (sans email en clair).
      logger.error('api.external.failed', {
        service: 'resend',
        endpoint: 'fn_envoyer_email_template',
        template: 'ag_attribution_association',
        error: emailErr.message,
      });
    }
  }

  // Email → transporteur
  if (transp.contact_email) {
    const { error: emailErr } = await supabase.rpc(
      'fn_envoyer_email_template',
      {
        p_template_code: 'ag_attribution_transporteur',
        p_destinataire: transp.contact_email,
        p_variables: {
          evenement_nom: evenementNom,
          date_collecte: dateCollecte,
          lieu_adresse: lieuAdresse,
          association_adresse: assoAdresse,
          volume_estime_repas: volumeEstime,
        },
      },
    );
    if (emailErr) {
      logger.error('api.external.failed', {
        service: 'resend',
        endpoint: 'fn_envoyer_email_template',
        template: 'ag_attribution_transporteur',
        error: emailErr.message,
      });
    }
  }
}
