// Email « document disponible » d'une collecte, envoyé une seule fois, à la
// clôture (48 h après la fin de collecte), quand son document existe (Val
// 2026-11-04). Les documents sortent, eux, dès que les poids sont là : ces 48 h
// laissent à l'Admin le temps de corriger avant que le client soit prévenu.
// Un document fabriqué après la clôture (poids AG saisi tard) déclenche l'email
// au passage suivant.
//   ZD : `rapport_disponible`, dès que le bordereau est émis.
//   AG : `attestation_don_disponible`, dès qu'une attestation est émise.
// Un seul envoi par collecte : une ligne `emails_envoyes` (quel qu'en soit le
// statut, le worker de retry porte les échecs) suffit à ne plus renvoyer.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { formatDateParis } from '@savr/shared/src/temps/index.js';
import { urlCanonique } from '@/lib/url-application.js';

import { cheminFicheCollecte } from './batch-pdf-j1.js';
import {
  TAILLE_PAGE,
  lireParLots,
  lireParPages,
} from './selection-par-pages.js';

const TEMPLATE_ZD = 'rapport_disponible';
const TEMPLATE_AG = 'attestation_don_disponible';

/** Collectes clôturées regardées : au-delà, l'email n'a plus de sens. */
const FENETRE_JOURS = 30;

export interface EmailsDocumentsResult {
  envoyes: number;
  errors: string[];
}

interface CollecteRow {
  id: string;
  type: string;
  date_collecte: string;
  co2_evite_kg: number | null;
  taux_recyclage: number | null;
  evenements: {
    nom_evenement: string | null;
    date_evenement: string;
    organisation_id: string;
    programmeur: { prenom: string | null; organisation_id: string } | null;
    organisations: {
      email_principal: string | null;
      type: string | null;
    } | null;
    lieux: { nom: string } | null;
  } | null;
  attributions_antgaspi: {
    volume_repas_realise: number | null;
    associations: { nom: string } | null;
  } | null;
}

export async function envoyerEmailsDocumentsDisponibles(
  supabase: SupabaseClient,
): Promise<EmailsDocumentsResult> {
  const result: EmailsDocumentsResult = { envoyes: 0, errors: [] };
  const depuis = new Date(
    Date.now() - FENETRE_JOURS * 24 * 3600 * 1000,
  ).toISOString();

  const { data: collectes, error: selErr } = await lireParPages<CollecteRow>(
    (apresId) => {
      const pages = supabase
        .from('collectes')
        .select(
          `id, type, date_collecte, co2_evite_kg, taux_recyclage,
          evenements (
            nom_evenement, date_evenement, organisation_id,
            programmeur:users!created_by ( prenom, organisation_id ),
            organisations!organisation_id ( email_principal, type ),
            lieux ( nom )
          ),
          attributions_antgaspi ( volume_repas_realise, associations ( nom ) )`,
        )
        .eq('statut', 'cloturee')
        .gte('realisee_at', depuis)
        .not('evenement_id', 'is', null);
      return (apresId ? pages.gt('id', apresId) : pages)
        .order('id', { ascending: true })
        .limit(TAILLE_PAGE);
    },
  );
  if (selErr) {
    result.errors.push(`Sélection collectes : ${selErr.message}`);
    return result;
  }
  if (!collectes.length) return result;
  const ids = collectes.map((c) => c.id);

  // Déjà prévenues : aucune nouvelle tentative.
  const { data: dejaEnvoyes, error: emErr } = await lireParLots<{
    entity_id: string;
  }>(ids, (lot) =>
    supabase
      .from('emails_envoyes')
      .select('entity_id')
      .eq('entity_type', 'collectes')
      .in('template_code', [TEMPLATE_ZD, TEMPLATE_AG])
      .in('entity_id', lot),
  );
  // Sans cette liste, envoyer = prévenir deux fois le même client.
  if (emErr) {
    result.errors.push(`Sélection emails envoyés : ${emErr.message}`);
    return result;
  }
  const prevenues = new Set(dejaEnvoyes.map((e) => e.entity_id));

  const { data: bordereaux, error: bErr } = await lireParLots<{
    collecte_id: string;
    poids_total_kg: number | null;
  }>(ids, (lot) =>
    supabase
      .from('bordereaux_savr')
      .select('collecte_id, poids_total_kg')
      .neq('statut', 'brouillon')
      .in('collecte_id', lot),
  );
  const { data: attestations, error: aErr } = await lireParLots<{
    collecte_id: string;
  }>(ids, (lot) =>
    supabase
      .from('attestations_don')
      .select('collecte_id')
      .eq('statut', 'emise')
      .in('collecte_id', lot),
  );
  if (bErr || aErr) {
    result.errors.push(
      `Sélection documents : ${(bErr ?? aErr)?.message ?? 'inconnue'}`,
    );
    return result;
  }
  const poidsBordereau = new Map(
    bordereaux.map((b) => [b.collecte_id, b.poids_total_kg]),
  );
  const attestees = new Set(attestations.map((a) => a.collecte_id));

  const { sendEmail } = await import('@savr/shared/src/email/index.js');

  for (const c of collectes) {
    if (prevenues.has(c.id)) continue;
    const ev = c.evenements;
    const destinataire = ev?.organisations?.email_principal;
    if (!ev || !destinataire) continue;

    const estZd = c.type === 'zero_dechet';
    if (estZd ? !poidsBordereau.has(c.id) : !attestees.has(c.id)) continue;

    // Prénom repris seulement si le programmeur est de l'organisation
    // destinataire. Textes saisis échappés (corps HTML interpolé tel quel).
    const prenom = escapeHtml(
      ev.programmeur?.organisation_id === ev.organisation_id
        ? (ev.programmeur.prenom?.trim() ?? '')
        : '',
    );
    const lienRapport = urlCanonique(
      cheminFicheCollecte(ev.organisations?.type, c.id),
    );

    // Variables = celles que chaque gabarit déclare : une variable manquante
    // fait refuser l'envoi.
    const variables: Record<string, string> = estZd
      ? {
          prenom,
          nom_evenement: escapeHtml(ev.nom_evenement?.trim() ?? ''),
          date_collecte: formatDateParis(c.date_collecte),
          lieu_nom: escapeHtml(ev.lieux?.nom ?? ''),
          // Nombres nus : le gabarit porte les unités.
          poids_total: formatNombre(poidsBordereau.get(c.id)),
          co2_evite: formatNombre(c.co2_evite_kg),
          taux_recyclage: formatNombre(c.taux_recyclage),
          lien_rapport: lienRapport,
        }
      : {
          prenom,
          nom_evenement: escapeHtml(
            ev.nom_evenement?.trim() || 'Votre événement',
          ),
          date_evenement: new Date(ev.date_evenement).toLocaleDateString(
            'fr-FR',
            { timeZone: 'Europe/Paris' },
          ),
          association_nom: escapeHtml(
            c.attributions_antgaspi?.associations?.nom?.trim() ?? '',
          ),
          nb_repas:
            typeof c.attributions_antgaspi?.volume_repas_realise === 'number' &&
            c.attributions_antgaspi.volume_repas_realise > 0
              ? String(c.attributions_antgaspi.volume_repas_realise)
              : '',
          lien_rapport: lienRapport,
        };

    const template = estZd ? TEMPLATE_ZD : TEMPLATE_AG;
    try {
      const { statut } = await sendEmail(template, destinataire, variables, {
        entityType: 'collectes',
        entityId: c.id,
      });
      if (statut !== 'dropped') result.envoyes++;
    } catch (e) {
      // Un email raté ne prive pas les collectes suivantes du leur. Sans
      // destinataire dans le log (§07/01).
      result.errors.push(`collecte ${c.id}: ${String(e)}`);
      logger.error('api.external.failed', {
        service: 'resend',
        endpoint: 'sendEmail',
        template,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

/** Nombre pour le corps de l'email, 1 décimale max, format FR ; « — » si absent. */
function formatNombre(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}
