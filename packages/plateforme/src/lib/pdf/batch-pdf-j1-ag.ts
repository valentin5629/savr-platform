// Batch J+1 6h — génère les attestations de don AG pour les collectes cloturees.
// Règles : R1 (cloturee + anti_gaspi + volume_repas_realise IS NOT NULL),
//          R2 (exclusion realisee_sans_collecte déjà filtrée sur statut=cloturee),
//          R8 (idempotence : skip si attestation emise/corrigee),
//          SIRET donateur (décision Val 2026-09-28) : pas d'attestation tant que
//          l'entité de facturation du donateur n'a pas un SIRET vérifié.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';

import {
  type BatchFatal,
  fatalSelection,
  fatalSiAucuneProduite,
  logCollecteEnEchec,
} from './batch-fatal.js';
import { anneeParis, jourParis } from '@savr/shared/src/temps/index.js';
import {
  TAILLE_PAGE,
  lireParPages,
  lireParLots,
} from './selection-par-pages.js';

export interface BatchPdfJ1AgResult {
  enqueued: number;
  skipped_no_attribution: number;
  /** Donateur sans SIRET vérifié → attestation différée + alerte Ops in-app. */
  skipped_siret_donateur: number;
  already_done: number;
  errors: string[];
  /** Échec global (sélection KO / 0 produit sur N tentés) → job.cron.failed. */
  fatal?: BatchFatal;
}

const JOB_NAME = 'attestations_batch';

interface AttributionRow {
  id: string;
  volume_repas_realise: number | null;
  poids_repas_kg: number | null;
  association_id: string;
  associations: {
    nom: string;
    adresse: string | null;
    habilitee_attestation_fiscale: boolean;
    numero_rup: string | null;
  } | null;
}

interface CollecteAgRow {
  id: string;
  evenement_id: string;
  realisee_at: string;
  date_collecte: string;
  co2_evite_kg: number | null;
  co2_facteurs_snapshot: Record<string, unknown> | null;
  evenements: {
    nom_evenement: string;
    date_evenement: string;
    organisation_id: string;
  } | null;
  attributions_antgaspi: AttributionRow | null;
}

interface EntiteFacturation {
  id: string;
  organisation_id: string;
  raison_sociale: string;
  siret: string;
  siret_verification: string;
}

export async function runBatchPdfJ1Ag(
  supabase: SupabaseClient,
): Promise<BatchPdfJ1AgResult> {
  const result: BatchPdfJ1AgResult = {
    enqueued: 0,
    skipped_no_attribution: 0,
    skipped_siret_donateur: 0,
    already_done: 0,
    errors: [],
  };

  // Embargo H+24 (§12 énoncé canonique + §05 SLAs : s'applique à l'attestation
  // de don au même titre que bordereau/rapport). L'attestation (snapshot juridique
  // 2041-GE) ne doit pas être figée avant realisee_at + 24h. Seuil calculé une
  // seule fois pour toutes les pages.
  const finEmbargo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // 1. Collectes AG cloturees (toutes, par pages — cf. selection-par-pages ; le
  //    statut cloturee filtre déjà realisee_sans_collecte, exempté d'embargo §12)
  const { data: collectes, error: selErr } = await lireParPages<CollecteAgRow>(
    (apresId) => {
      const pages = supabase
        .from('collectes')
        .select(
          `
      id, evenement_id, realisee_at, date_collecte,
      co2_evite_kg, co2_facteurs_snapshot,
      evenements ( nom_evenement, date_evenement, organisation_id ),
      attributions_antgaspi (
        id, volume_repas_realise, poids_repas_kg, association_id,
        associations ( nom, adresse, habilitee_attestation_fiscale, numero_rup )
      )
    `,
        )
        .eq('type', 'anti_gaspi')
        .eq('statut', 'cloturee')
        .lte('realisee_at', finEmbargo)
        .not('evenement_id', 'is', null);
      return (apresId ? pages.gt('id', apresId) : pages)
        .order('id', { ascending: true })
        .limit(TAILLE_PAGE);
    },
  );

  if (selErr) {
    result.fatal = fatalSelection(
      result.errors,
      'Sélection collectes AG',
      selErr,
    );
    return result;
  }

  if (!collectes.length) return result;

  // 2. Exclure celles sans attribution ou sans volume
  const eligible = collectes.filter((c) => {
    const attr = c.attributions_antgaspi;
    return attr && attr.volume_repas_realise != null;
  });
  result.skipped_no_attribution = collectes.length - eligible.length;

  if (!eligible.length) return result;

  // 3. Exclure collectes déjà attestées (idempotence R8)
  type AttRow = { collecte_id: string; statut: string };
  const { data: existingAtts, error: attSelErr } = await lireParLots<AttRow>(
    eligible.map((c) => c.id),
    (lot) =>
      supabase
        .from('attestations_don')
        .select('collecte_id, statut')
        .in('collecte_id', lot),
  );

  // Fail-closed : sans la liste des attestations émises, traiter = attestation fiscale
  // 2041-GE en double (numéro ATT-DON gapless consommé).
  if (attSelErr) {
    result.fatal = fatalSelection(
      result.errors,
      'Sélection attestations existantes',
      attSelErr,
    );
    return result;
  }

  const doneIds = new Set(
    existingAtts
      .filter((a) => a.statut === 'emise' || a.statut === 'corrigee')
      .map((a) => a.collecte_id),
  );

  const toProcess = eligible.filter((c) => !doneIds.has(c.id));
  result.already_done = eligible.length - toProcess.length;

  if (!toProcess.length) return result;

  // 4. Récupérer les entités de facturation (donateur = org programmatrice par défaut)
  const orgIds = [
    ...new Set(
      toProcess.map((c) => c.evenements?.organisation_id).filter(Boolean),
    ),
  ] as string[];
  const { data: entites, error: entErr } = await lireParLots<EntiteFacturation>(
    orgIds,
    (lot) =>
      supabase
        .from('entites_facturation')
        .select(
          'id, organisation_id, raison_sociale, siret, siret_verification',
        )
        .in('organisation_id', lot)
        .eq('entite_par_defaut', true)
        .eq('actif', true),
  );

  // Sans entité, l'attestation serait figée avec un donateur vide (raison sociale/SIRET).
  if (entErr) {
    result.fatal = fatalSelection(
      result.errors,
      'Sélection entités de facturation',
      entErr,
    );
    return result;
  }

  const entiteByOrg = new Map<string, EntiteFacturation>(
    entites.map((e) => [e.organisation_id, e]),
  );

  // Année PARISIENNE (cf. bordereaux) : séquence gapless annuelle.
  const annee = anneeParis();

  for (const collecte of toProcess) {
    try {
      const attr = collecte.attributions_antgaspi!;
      const asso = attr.associations;
      const ev = collecte.evenements!;
      const orgId = ev.organisation_id;
      const entite = entiteByOrg.get(orgId);
      const mentionFiscale = asso?.habilitee_attestation_fiscale ?? false;

      // 4bis. SIRET donateur (décision Val 2026-09-28) : la programmation n'exige
      // plus de SIRET, donc une attestation fiscale 2041-GE pourrait partir avec un
      // donateur sans SIRET. On la diffère — AVANT d'allouer le numéro gapless —
      // et on alerte l'Ops (in-app, dédupliquée). Le batch suivant l'émet dès que
      // le SIRET est vérifié (idempotence R8 inchangée).
      if (!entite || entite.siret_verification !== 'verifie' || !entite.siret) {
        result.skipped_siret_donateur++;
        const { error: alerteErr } = await supabase.rpc(
          'f_upsert_alerte_admin',
          {
            p_code: 'attestation_ag_siret_donateur_manquant',
            p_titre:
              'Attestation de don bloquée — SIRET du donateur non vérifié',
            p_message: `Collecte ${collecte.id} : l'attestation de don (Cerfa 2041-GE) ne sera émise qu'une fois le SIRET de l'entité de facturation de l'organisation vérifié. Compléter ou corriger le SIRET dans la fiche de l'organisation.`,
            p_entity_type: 'collectes',
            p_entity_id: collecte.id,
          },
        );
        if (alerteErr) {
          logger.error('attestation_ag.alerte_non_posee', {
            job_name: JOB_NAME,
            collecte_id: collecte.id,
            error_code: alerteErr.code,
            error: alerteErr.message,
          });
        }
        continue;
      }

      // 5. Allouer le numéro ATT-DON gapless
      const { data: numeroData } = await supabase
        .rpc('f_next_numero_attestation', { p_annee: annee })
        .single();
      const numero = numeroData as string;

      const today = jourParis();
      const dateEvenementStr = new Date(ev.date_evenement).toLocaleDateString(
        'fr-FR',
        { timeZone: 'Europe/Paris' },
      );
      const co2Snapshot = collecte.co2_facteurs_snapshot ?? {};
      const co2FacteursVersion = (co2Snapshot as Record<string, unknown>)
        ?.version as string | undefined;
      // Équivalence pédagogique km voiture, figée dans le snapshot AG
      // (trigger trg_co2_ag : equivalences.km_voiture, entier en km) — §12 §1.3.
      const co2KmVoiture = (
        (co2Snapshot as Record<string, unknown>)?.equivalences as
          | Record<string, unknown>
          | undefined
      )?.km_voiture as number | undefined;

      const disponibleA = new Date(
        new Date(collecte.realisee_at).getTime() + 24 * 3600 * 1000,
      );

      // 6. INSERT attestations_don (snapshot figé)
      const { data: attRow, error: attErr } = await supabase
        .from('attestations_don')
        .insert({
          collecte_id: collecte.id,
          attribution_antgaspi_id: attr.id,
          association_id: attr.association_id,
          mention_fiscale_2041ge: mentionFiscale,
          poids_kg: attr.poids_repas_kg ?? null,
          nb_repas: attr.volume_repas_realise,
          numero,
          date_emission: today,
          date_collecte: collecte.date_collecte,
          donateur_entite_facturation_id: entite.id,
          donateur_raison_sociale: entite.raison_sociale,
          donateur_siret: entite.siret,
          association_nom: asso?.nom ?? '',
          // Instantané figé du n° RUP à l'émission (CDC §04 associations.numero_rup,
          // source unique saisie dans la modale association §06.06 §5). Facultatif :
          // NULL ⇒ le Cerfa 2041-GE est émis sans la mention RUP.
          association_numero_rup: asso?.numero_rup ?? null,
          association_habilitation: mentionFiscale
            ? 'habilitee'
            : 'non_habilitee',
          volume_repas: attr.volume_repas_realise,
          co2_evite_kg: collecte.co2_evite_kg,
          co2_facteurs_snapshot: co2Snapshot,
          version: 1,
          statut: 'brouillon',
          eligible_at: disponibleA.toISOString(),
        })
        .select('id')
        .single();

      if (attErr || !attRow) {
        throw new Error(`INSERT attestations_don : ${attErr?.message}`);
      }

      const attestationId = (attRow as { id: string }).id;

      // 6bis. §07/06 attestation_don_generee — trace fiscale (mention 2041-GE).
      // Batch J+1 sans utilisateur → user_id null (system). Best-effort : un échec
      // d'audit ne doit pas interrompre le batch (idempotence en amont via doneIds).
      try {
        await supabase.from('audit_log').insert({
          action: 'attestation_don_generee',
          table_name: 'attestations_don',
          record_id: attestationId,
          user_id: null,
          new_values: {
            numero,
            collecte_id: collecte.id,
            association_id: attr.association_id,
            mention_fiscale_2041ge: mentionFiscale,
            nb_repas: attr.volume_repas_realise,
          },
          details: { source: 'batch-pdf-j1-ag' },
        });
      } catch {
        /* best-effort : audit non bloquant */
      }

      // 7. Payload PDF pour Railway/Puppeteer
      const attestationPayload = {
        numero,
        date_emission: new Date().toLocaleDateString('fr-FR', {
          timeZone: 'Europe/Paris',
        }),
        date_collecte: new Date(collecte.date_collecte).toLocaleDateString(
          'fr-FR',
          { timeZone: 'Europe/Paris' },
        ),
        nom_evenement: ev.nom_evenement,
        date_evenement: dateEvenementStr,
        donateur_raison_sociale: entite.raison_sociale,
        donateur_siret: entite.siret,
        association_nom: asso?.nom ?? '',
        association_adresse: asso?.adresse ?? null,
        association_numero_rup: asso?.numero_rup ?? null,
        mention_fiscale_2041ge: mentionFiscale,
        volume_repas: attr.volume_repas_realise,
        poids_kg: attr.poids_repas_kg,
        co2_evite_kg: collecte.co2_evite_kg,
        co2_km_voiture: co2KmVoiture ?? null,
        co2_facteurs_version: co2FacteursVersion,
      };

      // 8. Enqueuer le job PDF attestation
      await supabase.from('jobs_pdf').insert({
        type_document: 'attestation-don',
        entity_type: 'attestations_don',
        entity_id: attestationId,
        payload: attestationPayload,
        statut: 'pending',
        attempts: 0,
      });

      // (Pas de ligne rapports_rse pour une collecte AG avec excédents : son
      // document est l'attestation, affichée « Rapport de don ». L'ancienne étape 9
      // en créait une qu'aucun rendu ne suivait — décision Val 2026-10-09.)

      // 10. Email attestation_don_disponible (non bloquant). Destinataire =
      // email_principal de l'organisation programmatrice (§06.02, tranché Val
      // 2026-09-14, symétrie rapport_disponible). evenements n'a PAS de
      // contact_principal_email en V1 : l'ancienne lecture renvoyait toujours
      // vide → aucune attestation n'était jamais envoyée.
      const { data: orgaData } = await supabase
        .from('organisations')
        .select('email_principal')
        .eq('id', ev.organisation_id)
        .single();

      const contactEmail = (
        orgaData as { email_principal: string | null } | null
      )?.email_principal;
      if (contactEmail) {
        const { sendEmail } = await import('@savr/shared/src/email/index.js');
        void sendEmail(
          'attestation_don_disponible',
          contactEmail,
          {
            nom_evenement: ev.nom_evenement,
            date_evenement: dateEvenementStr,
            numero_attestation: numero,
          },
          { entityType: 'collectes', entityId: collecte.id },
        ).catch((e: unknown) => {
          // Best-effort : `void` seul laisse un rejet NON GÉRÉ qui tue le processus —
          // un email raté (template absent, Resend KO) ne doit jamais faire tomber le
          // batch ni priver les collectes suivantes de leurs documents. §07/01, sans
          // destinataire dans le log.
          logger.error('api.external.failed', {
            service: 'resend',
            endpoint: 'sendEmail',
            template: 'attestation_don_disponible',
            error: e instanceof Error ? e.message : String(e),
          });
        });
      }

      // 11. L'attestation est partie : l'alerte « SIRET donateur manquant » posée par
      // un batch précédent n'a plus d'objet → résolue (sinon la file critique de
      // l'Ops grossit de cas réglés). Best-effort : jamais bloquant.
      const { error: resolErr } = await supabase
        .from('alertes_admin')
        .update({ statut: 'resolue', resolue_at: new Date().toISOString() })
        .eq('code', 'attestation_ag_siret_donateur_manquant')
        .eq('entity_type', 'collectes')
        .eq('entity_id', collecte.id)
        .eq('statut', 'ouverte');
      if (resolErr) {
        logger.error('attestation_ag.alerte_non_resolue', {
          job_name: JOB_NAME,
          collecte_id: collecte.id,
          error_code: resolErr.code,
          error: resolErr.message,
        });
      }

      result.enqueued++;
    } catch (err) {
      result.errors.push(`collecte AG ${collecte.id}: ${String(err)}`);
      logCollecteEnEchec(JOB_NAME, collecte.id, err);
    }
  }

  result.fatal = fatalSiAucuneProduite(result.enqueued, result.errors);
  return result;
}
