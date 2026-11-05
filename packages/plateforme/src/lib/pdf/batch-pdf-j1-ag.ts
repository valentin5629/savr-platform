// Batch des attestations de don AG — émet l'attestation dès que le poids est
// saisi (collecte realisee ou cloturee, Val 2026-11-04). Passe toutes les 15 min,
// et sur-le-champ après la saisie Admin (documents-sans-attendre). Une correction
// de poids refait l'attestation (trg_regenerer_attestation). L'email « rapport
// de don disponible » part à la clôture (emails-documents-disponibles).
// Règles : R1 (realisee|cloturee + anti_gaspi + volume_repas_realise IS NOT NULL),
//          R2 (realisee_sans_collecte exclue par le filtre de statut),
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
import { makeLogoResolver } from './logo-inline.js';
import {
  SELECT_LOGOS_EVENEMENT,
  cleLogoAttestation,
  type LogosEvenementRow,
} from './logo-rapport-de-don.js';
import { erreurInterne } from '@/lib/api-helpers.js';

export interface BatchPdfJ1AgResult {
  enqueued: number;
  skipped_no_attribution: number;
  /** Donateur sans SIRET vérifié → attestation différée + alerte Ops in-app. */
  skipped_siret_donateur: number;
  already_done: number;
  /** Attestations en brouillon mises à jour après une correction de poids. */
  refaits: number;
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
  evenements:
    | (LogosEvenementRow & {
        // Nullable en base : le formulaire de programmation peut l'envoyer vide.
        nom_evenement: string | null;
        date_evenement: string;
        organisation_id: string;
      })
    | null;
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
  options: { collecteId?: string } = {},
): Promise<BatchPdfJ1AgResult> {
  const result: BatchPdfJ1AgResult = {
    enqueued: 0,
    skipped_no_attribution: 0,
    skipped_siret_donateur: 0,
    already_done: 0,
    refaits: 0,
    errors: [],
  };

  // 1. Collectes AG realisee ou cloturee (par pages — cf. selection-par-pages).
  //    Plus d'embargo : l'attestation sort dès que le poids est là.
  const { data: collectes, error: selErr } = await lireParPages<CollecteAgRow>(
    (apresId) => {
      const pages = supabase
        .from('collectes')
        .select(
          `
      id, evenement_id, realisee_at, date_collecte,
      co2_evite_kg, co2_facteurs_snapshot,
      evenements (
        nom_evenement, date_evenement, organisation_id,
        ${SELECT_LOGOS_EVENEMENT}
      ),
      attributions_antgaspi (
        id, volume_repas_realise, poids_repas_kg, association_id,
        associations ( nom, adresse, habilitee_attestation_fiscale, numero_rup )
      )
    `,
        )
        .eq('type', 'anti_gaspi')
        .in('statut', ['realisee', 'cloturee'])
        .not('evenement_id', 'is', null);
      const filtrees = options.collecteId
        ? pages.eq('id', options.collecteId)
        : pages;
      return (apresId ? filtrees.gt('id', apresId) : filtrees)
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
  type AttRow = {
    id: string;
    collecte_id: string;
    statut: string;
    version: number;
    numero: string | null;
    volume_repas: number | null;
  };
  const { data: existingAtts, error: attSelErr } = await lireParLots<AttRow>(
    eligible.map((c) => c.id),
    (lot) =>
      supabase
        .from('attestations_don')
        .select('id, collecte_id, statut, version, numero, volume_repas')
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

  // Dernière version de chaque collecte.
  const derniere = new Map<string, AttRow>();
  for (const a of existingAtts) {
    const d = derniere.get(a.collecte_id);
    if (!d || a.version > d.version) derniere.set(a.collecte_id, a);
  }
  const volumeDe = (c: CollecteAgRow) =>
    c.attributions_antgaspi?.volume_repas_realise ?? null;

  // Une attestation existante n'est pas recréée (son numéro ATT-DON gapless est
  // tiré). Restent à faire : la collecte sans attestation, la ligne restée sans
  // numéro (reprise), et l'attestation émise dont le nombre de repas ne suit
  // plus le poids (correction tombée pendant son rendu, que
  // trg_regenerer_attestation n'a pas vue) → nouvelle version.
  const toProcess = eligible.filter((c) => {
    const d = derniere.get(c.id);
    // Reprise : seulement un brouillon sans numéro (création interrompue). Une
    // attestation émise sans numéro (jeu de données, import) n'est jamais renumérotée.
    if (!d || (d.numero == null && d.statut === 'brouillon')) return true;
    return d.statut === 'emise' && d.volume_repas !== volumeDe(c);
  });

  // 3bis. Attestation numérotée encore en brouillon (1er rendu en attente ou en
  //       échec) dont le nombre de repas a changé : elle et son rendu prennent
  //       les valeurs du moment. Rendu en cours : repris au passage suivant.
  for (const c of eligible) {
    const d = derniere.get(c.id);
    if (!d || d.numero == null || d.statut !== 'brouillon') continue;
    if (d.volume_repas === volumeDe(c)) continue;
    try {
      if (await reprendreBrouillon(supabase, c, d.id)) result.refaits++;
    } catch (err) {
      result.errors.push(`collecte AG ${c.id}: ${String(err)}`);
      logCollecteEnEchec(JOB_NAME, c.id, err);
    }
  }
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
  // Logo du client inliné (data URI), mémoïsé pour le lot.
  const resoudreLogo = makeLogoResolver();

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
            p_message: `Collecte ${collecte.id} : l'attestation de don (Cerfa 2041-GE) ne sera émise qu'une fois le SIRET de l'entité de facturation du client vérifié. Compléter ou corriger le SIRET dans la fiche de l'organisation.`,
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

      // Disponible tout de suite (plus d'embargo, Val 2026-11-04).
      const disponibleA = new Date();

      // 5. INSERT attestations_don (snapshot figé), SANS numéro : l'unicité de
      //    (collecte_id, version) départage deux fabrications simultanées avant
      //    qu'un numéro gapless soit tiré. Une ligne restée sans numéro est
      //    reprise telle quelle ; une version émise dépassée est suivie d'une
      //    nouvelle version.
      const precedente = derniere.get(collecte.id);
      const reprise =
        precedente?.numero == null && precedente?.statut === 'brouillon'
          ? precedente
          : undefined;
      let attestationId = reprise?.id;
      if (!attestationId) {
        const { data: attRow, error: attErr } = await supabase
          .from('attestations_don')
          .insert({
            collecte_id: collecte.id,
            attribution_antgaspi_id: attr.id,
            association_id: attr.association_id,
            mention_fiscale_2041ge: mentionFiscale,
            poids_kg: attr.poids_repas_kg ?? null,
            nb_repas: attr.volume_repas_realise,
            numero: null,
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
            version: (precedente?.version ?? 0) + 1,
            statut: 'brouillon',
            eligible_at: disponibleA.toISOString(),
          })
          .select('id')
          .single();

        if (attErr?.code === '23505') {
          // Créée à l'instant par une autre fabrication : rien à faire ici.
          result.already_done++;
          continue;
        }
        if (attErr || !attRow) {
          throw erreurInterne(attErr, 'pdf.batch_ag.insert_attestation');
        }
        attestationId = (attRow as { id: string }).id;
      }

      // 6. Numéro ATT-DON (gapless), tiré une fois la ligne acquise.
      const { data: numeroData, error: numErr } = await supabase
        .rpc('f_next_numero_attestation', { p_annee: annee })
        .single();
      if (numErr || !numeroData) {
        throw erreurInterne(numErr, 'pdf.batch_ag.numero');
      }
      const numero = numeroData as string;
      const { data: numerotee, error: numMajErr } = await supabase
        .from('attestations_don')
        .update({ numero })
        .eq('id', attestationId)
        .is('numero', null)
        .select('id');
      if (numMajErr) throw erreurInterne(numMajErr, 'pdf.batch_ag.numero_maj');
      // Numérotée entre-temps par une autre reprise : la suite est la sienne.
      if (!numerotee?.length) continue;

      // Nouvelle version d'une attestation émise : l'ancienne est corrigée.
      if (precedente && !reprise) {
        const { error: corrErr } = await supabase
          .from('attestations_don')
          .update({ statut: 'corrigee' })
          .eq('id', precedente.id)
          .eq('statut', 'emise');
        if (corrErr)
          throw erreurInterne(corrErr, 'pdf.batch_ag.version_corrigee');
      }

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
        // Logo du client (Val 2026-10-30) : emplacement « client » de la cascade.
        logo_client_url: await resoudreLogo(cleLogoAttestation(ev)),
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

  result.fatal = fatalSiAucuneProduite(
    result.enqueued + result.refaits,
    result.errors,
  );
  return result;
}

/**
 * Attestation numérotée encore en brouillon : nombre de repas, poids et CO₂ du
 * moment, sur la ligne et sur ses rendus en attente ou en échec. Aucun rendu à
 * reprendre (rendu en cours) : rien n'est touché, le passage suivant recommence.
 * Rend `true` si l'attestation est mise à jour.
 */
async function reprendreBrouillon(
  supabase: SupabaseClient,
  collecte: CollecteAgRow,
  attestationId: string,
): Promise<boolean> {
  const attr = collecte.attributions_antgaspi!;
  const { data: rendus, error: lecErr } = await supabase
    .from('jobs_pdf')
    .select('id, payload')
    .eq('entity_type', 'attestations_don')
    .eq('entity_id', attestationId)
    .in('statut', ['pending', 'failed']);
  if (lecErr) throw erreurInterne(lecErr, 'pdf.batch_ag.lecture_rendu');
  if (!rendus?.length) return false;

  for (const r of rendus as Array<{
    id: string;
    payload: Record<string, unknown>;
  }>) {
    const { error } = await supabase
      .from('jobs_pdf')
      .update({
        payload: {
          ...r.payload,
          volume_repas: attr.volume_repas_realise,
          poids_kg: attr.poids_repas_kg,
          co2_evite_kg: collecte.co2_evite_kg,
        },
      })
      .eq('id', r.id)
      .in('statut', ['pending', 'failed']);
    if (error) throw erreurInterne(error, 'pdf.batch_ag.rendu_en_attente');
  }

  const { error: majErr } = await supabase
    .from('attestations_don')
    .update({
      volume_repas: attr.volume_repas_realise,
      nb_repas: attr.volume_repas_realise,
      poids_kg: attr.poids_repas_kg,
      co2_evite_kg: collecte.co2_evite_kg,
    })
    .eq('id', attestationId)
    .eq('statut', 'brouillon');
  if (majErr) throw erreurInterne(majErr, 'pdf.batch_ag.maj_brouillon');
  return true;
}
