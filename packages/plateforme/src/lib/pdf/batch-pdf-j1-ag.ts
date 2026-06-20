// Batch J+1 6h — génère les attestations de don AG pour les collectes cloturees.
// Règles : R1 (cloturee + anti_gaspi + volume_repas_realise IS NOT NULL),
//          R2 (exclusion realisee_sans_collecte déjà filtrée sur statut=cloturee),
//          R8 (idempotence : skip si attestation emise/corrigee).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

export interface BatchPdfJ1AgResult {
  enqueued: number;
  skipped_no_attribution: number;
  already_done: number;
  errors: string[];
}

interface AttributionRow {
  id: string;
  volume_repas_realise: number | null;
  poids_repas_kg: number | null;
  association_id: string;
  associations: {
    nom: string;
    numero_rup: string | null;
    habilitee_attestation_fiscale: boolean;
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
}

export async function runBatchPdfJ1Ag(
  supabase: SupabaseClient,
): Promise<BatchPdfJ1AgResult> {
  const result: BatchPdfJ1AgResult = {
    enqueued: 0,
    skipped_no_attribution: 0,
    already_done: 0,
    errors: [],
  };

  // 1. Collectes AG cloturees (statut cloturee filtre déjà realisee_sans_collecte)
  const { data: collectes, error: selErr } = await supabase
    .from('collectes')
    .select(
      `
      id, evenement_id, realisee_at, date_collecte,
      co2_evite_kg, co2_facteurs_snapshot,
      evenements ( nom_evenement, date_evenement, organisation_id ),
      attributions_antgaspi (
        id, volume_repas_realise, poids_repas_kg, association_id,
        associations ( nom, numero_rup, habilitee_attestation_fiscale )
      )
    `,
    )
    .eq('type', 'anti_gaspi')
    .eq('statut', 'cloturee')
    // Embargo H+24 (§12 énoncé canonique + §05 SLAs : s'applique à l'attestation
    // de don au même titre que bordereau/rapport). L'attestation (snapshot juridique
    // 2041-GE) ne doit pas être figée avant realisee_at + 24h. realisee_sans_collecte
    // reste exclu par .eq('statut','cloturee') (exempté d'embargo, cf. §12).
    .lte('realisee_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .not('evenement_id', 'is', null);

  if (selErr) {
    result.errors.push(`Sélection collectes AG : ${selErr.message}`);
    return result;
  }

  if (!collectes?.length) return result;

  // 2. Exclure celles sans attribution ou sans volume
  const eligible = (collectes as unknown as CollecteAgRow[]).filter((c) => {
    const attr = c.attributions_antgaspi;
    return attr && attr.volume_repas_realise != null;
  });
  result.skipped_no_attribution = collectes.length - eligible.length;

  if (!eligible.length) return result;

  // 3. Exclure collectes déjà attestées (idempotence R8)
  const collecteIds = eligible.map((c) => c.id);
  const { data: existingAtts } = await supabase
    .from('attestations_don')
    .select('collecte_id, statut')
    .in('collecte_id', collecteIds);

  type AttRow = { collecte_id: string; statut: string };
  const doneIds = new Set(
    ((existingAtts ?? []) as AttRow[])
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
  const { data: entites } = await supabase
    .from('entites_facturation')
    .select('id, organisation_id, raison_sociale, siret')
    .in('organisation_id', orgIds)
    .eq('entite_par_defaut', true);

  const entiteByOrg = new Map<string, EntiteFacturation>(
    ((entites ?? []) as EntiteFacturation[]).map((e) => [e.organisation_id, e]),
  );

  const annee = new Date().getFullYear();

  for (const collecte of toProcess) {
    try {
      const attr = collecte.attributions_antgaspi!;
      const asso = attr.associations;
      const ev = collecte.evenements!;
      const orgId = ev.organisation_id;
      const entite = entiteByOrg.get(orgId);
      const mentionFiscale = asso?.habilitee_attestation_fiscale ?? false;

      // 5. Allouer le numéro ATT-DON gapless
      const { data: numeroData } = await supabase
        .rpc('f_next_numero_attestation', { p_annee: annee })
        .single();
      const numero = numeroData as string;

      const today = new Date().toISOString().split('T')[0]!;
      const dateEvenementStr = new Date(ev.date_evenement).toLocaleDateString(
        'fr-FR',
      );
      const co2Snapshot = collecte.co2_facteurs_snapshot ?? {};
      const co2FacteursVersion = (co2Snapshot as Record<string, unknown>)
        ?.version as string | undefined;

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
          donateur_entite_facturation_id: entite?.id ?? null,
          donateur_raison_sociale: entite?.raison_sociale ?? '',
          donateur_siret: entite?.siret ?? '',
          association_nom: asso?.nom ?? '',
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

      // 7. Payload PDF pour Railway/Puppeteer
      const attestationPayload = {
        numero,
        date_emission: new Date().toLocaleDateString('fr-FR'),
        date_collecte: new Date(collecte.date_collecte).toLocaleDateString(
          'fr-FR',
        ),
        nom_evenement: ev.nom_evenement,
        date_evenement: dateEvenementStr,
        donateur_raison_sociale: entite?.raison_sociale ?? '',
        donateur_siret: entite?.siret ?? '',
        association_nom: asso?.nom ?? '',
        association_numero_rup: asso?.numero_rup ?? null,
        mention_fiscale_2041ge: mentionFiscale,
        volume_repas: attr.volume_repas_realise,
        poids_kg: attr.poids_repas_kg,
        co2_evite_kg: collecte.co2_evite_kg,
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

      // 9. Créer la ligne rapports_rse AG (page RSE) avec embargo H+24
      await supabase.from('rapports_rse').insert({
        collecte_id: collecte.id,
        evenement_id: collecte.evenement_id,
        version: 1,
        disponible_a: disponibleA.toISOString(),
        genere_par: 'automatique',
        filtres_benchmark: {},
      });

      // 10. Email attestation_disponible (non bloquant)
      const { data: contactData } = await supabase
        .from('evenements')
        .select('contact_principal_email')
        .eq('id', collecte.evenement_id)
        .single();

      const contactEmail = (
        contactData as { contact_principal_email: string | null } | null
      )?.contact_principal_email;
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
        );
      }

      result.enqueued++;
    } catch (err) {
      result.errors.push(`collecte AG ${collecte.id}: ${String(err)}`);
    }
  }

  return result;
}
