// Batch J+1 6h — génère les PDFs ZD pour les collectes cloturees de la veille.
// Règles : R-PDF1 (cloturee only), R-PDF3 (skip si 0 ligne collecte_flux),
//          R-PDF4 (escalade R9 si > 48h sans bordereau).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

export interface BatchPdfJ1Result {
  enqueued: number;
  skipped_no_flux: number;
  escalated_r9: number;
  already_done: number;
  errors: string[];
}

interface CollecteRow {
  id: string;
  evenement_id: string;
  realisee_at: string;
  cloturee_at: string | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  co2_induit_kg: number | null;
  co2_net_kg: number | null;
  co2_net_kwh: number | null;
  co2_facteurs_snapshot: Record<string, unknown> | null;
  nb_camions_demande: number;
  evenements: {
    id: string;
    nom_evenement: string;
    date_evenement: string;
    nb_pax: number | null;
    organisation_id: string;
    traiteur_operationnel_organisation_id: string | null;
    organisations: {
      raison_sociale: string;
      siret: string | null;
      adresse: string | null;
    } | null;
    traiteur_operationnel: {
      raison_sociale: string;
      siret: string | null;
      adresse: string | null;
    } | null;
    lieux: {
      nom: string;
      adresse_acces: string | null;
      code_postal: string | null;
      ville: string | null;
    } | null;
    contact_principal_email: string | null;
  } | null;
  collecte_tournees: {
    tournees: {
      transporteur_id: string | null;
      transporteurs: { nom: string; siret: string | null } | null;
    } | null;
  }[];
}

export async function runBatchPdfJ1(
  supabase: SupabaseClient,
): Promise<BatchPdfJ1Result> {
  const result: BatchPdfJ1Result = {
    enqueued: 0,
    skipped_no_flux: 0,
    escalated_r9: 0,
    already_done: 0,
    errors: [],
  };

  // 1. Collectes ZD cloturees sans bordereau emis
  const { data: collectes, error: selErr } = await supabase
    .from('collectes')
    .select(
      `
      id, evenement_id, realisee_at, cloturee_at,
      taux_recyclage, co2_evite_kg, co2_induit_kg, co2_net_kg, co2_net_kwh,
      co2_facteurs_snapshot, nb_camions_demande,
      evenements (
        id, nom_evenement, date_evenement, nb_pax,
        organisation_id, traiteur_operationnel_organisation_id,
        contact_principal_email,
        organisations ( raison_sociale, siret, adresse ),
        traiteur_operationnel:organisations!traiteur_operationnel_organisation_id ( raison_sociale, siret, adresse ),
        lieux ( nom, adresse_acces, code_postal, ville )
      ),
      collecte_tournees (
        tournees (
          transporteur_id,
          transporteurs ( nom, siret )
        )
      )
    `,
    )
    .eq('type', 'zero_dechet')
    .eq('statut', 'cloturee')
    .not('evenement_id', 'is', null);

  if (selErr) {
    result.errors.push(`Sélection collectes : ${selErr.message}`);
    return result;
  }

  if (!collectes?.length) return result;

  // 2. Exclure celles qui ont déjà un bordereau
  const collecteIds = collectes.map((c: { id: string }) => c.id);
  const { data: existingBordereaux } = await supabase
    .from('bordereaux_savr')
    .select('collecte_id, statut')
    .in('collecte_id', collecteIds);

  type BordRow = { collecte_id: string; statut: string };
  const doneIds = new Set(
    ((existingBordereaux ?? []) as BordRow[])
      .filter((b) => b.statut !== 'brouillon')
      .map((b) => b.collecte_id),
  );

  const toProcess = (collectes as unknown as CollecteRow[]).filter(
    (c) => !doneIds.has(c.id),
  );
  result.already_done = collectes.length - toProcess.length;

  const now = new Date();

  for (const collecte of toProcess) {
    try {
      // 3. Vérifier qu'il y a des pesées dans collecte_flux
      const { count: fluxCount } = await supabase
        .from('collecte_flux')
        .select('*', { count: 'exact', head: true })
        .eq('collecte_id', collecte.id);

      if (!fluxCount) {
        // R-PDF3 : skip
        result.skipped_no_flux++;

        // R-PDF4 / R9 : escalade si skip > 48h
        const clotureAt = collecte.cloturee_at
          ? new Date(collecte.cloturee_at)
          : null;
        if (
          clotureAt &&
          now.getTime() - clotureAt.getTime() > 48 * 3600 * 1000
        ) {
          await supabase.rpc('f_upsert_alerte_admin', {
            p_code: 'bordereau_pesees_manquantes_48h',
            p_titre: 'Saisie manuelle requise — pesées incomplètes',
            p_message: `Collecte ${collecte.id} clôturée depuis > 48h sans pesées. Vérifier la remontée MTS-1 ou saisir manuellement.`,
            p_entity_type: 'collectes',
            p_entity_id: collecte.id,
          });
          result.escalated_r9++;
        }
        continue;
      }

      // 4. Charger les flux pour le payload
      const { data: flux } = await supabase
        .from('collecte_flux')
        .select('flux_id, poids_kg, flux:flux_id ( nom )')
        .eq('collecte_id', collecte.id);

      const fluxDetails = (flux ?? []).map((f: Record<string, unknown>) => ({
        nom: (f.flux as { nom: string } | null)?.nom ?? String(f.flux_id),
        poids_kg: Number(f.poids_kg),
      }));
      const poidsTotalKg = fluxDetails.reduce(
        (s: number, f: { poids_kg: number }) => s + f.poids_kg,
        0,
      );

      // 5. Allouer le numéro BSAV (gapless)
      const annee = new Date().getFullYear();
      const { data: numeroData } = await supabase
        .rpc('f_next_numero_bordereau', { p_annee: annee })
        .single();
      const numero = numeroData as string;

      const ev = collecte.evenements!;
      const lieu = ev.lieux;
      // Producteur = traiteur opérationnel si désigné, sinon l'organisation programmante
      const organisationProd = ev.traiteur_operationnel ?? ev.organisations;
      const adresseLieu = lieu
        ? [lieu.adresse_acces, lieu.code_postal, lieu.ville]
            .filter(Boolean)
            .join(' ')
        : '';

      // Prendre le premier transporteur de la première tournée
      const tournee = collecte.collecte_tournees?.[0]?.tournees;
      const transporteurNom = tournee?.transporteurs?.nom ?? 'Non renseigné';
      const transporteurSiret = tournee?.transporteurs?.siret ?? null;

      const dateCollecteStr = new Date().toLocaleDateString('fr-FR');
      const dateEvenementStr = new Date(ev.date_evenement).toLocaleDateString(
        'fr-FR',
      );
      const dateEmissionStr = new Date().toLocaleDateString('fr-FR');

      const bordereauPayload = {
        numero,
        date_emission: dateEmissionStr,
        date_collecte: dateCollecteStr,
        date_evenement: dateEvenementStr,
        nom_evenement: ev.nom_evenement,
        lieu_nom: lieu?.nom ?? '',
        lieu_adresse: adresseLieu,
        producteur_raison_sociale: organisationProd?.raison_sociale ?? '',
        producteur_siret: organisationProd?.siret ?? null,
        producteur_adresse: organisationProd?.adresse ?? '',
        transporteur_nom: transporteurNom,
        exutoire_nom: 'Prestataire Savr',
        nb_pax: ev.nb_pax,
        flux: fluxDetails,
        poids_total_kg: poidsTotalKg,
      };

      const disponibleA = new Date(
        new Date(collecte.realisee_at).getTime() + 24 * 3600 * 1000,
      );

      const rapportPayload = {
        nom_evenement: ev.nom_evenement,
        date_evenement: dateEvenementStr,
        date_collecte: dateCollecteStr,
        lieu_nom: lieu?.nom ?? '',
        lieu_adresse: adresseLieu,
        nb_pax: ev.nb_pax,
        traiteur_nom: organisationProd?.raison_sociale ?? '',
        taux_recyclage: collecte.taux_recyclage,
        flux: fluxDetails,
        poids_total_kg: poidsTotalKg,
        co2_evite_kg: collecte.co2_evite_kg,
        co2_induit_kg: collecte.co2_induit_kg,
        co2_net_kg: collecte.co2_net_kg,
        energie_primaire_evitee_kwh: collecte.co2_net_kwh,
        co2_facteurs_version: (
          collecte.co2_facteurs_snapshot as Record<string, unknown> | null
        )?.version as string | undefined,
        bordereau: bordereauPayload,
      };

      // 6. Créer la ligne bordereaux_savr (snapshot)
      const { data: bordereauRow, error: bordErr } = await supabase
        .from('bordereaux_savr')
        .insert({
          collecte_id: collecte.id,
          numero,
          date_emission: new Date().toISOString().split('T')[0],
          date_collecte: new Date().toISOString().split('T')[0],
          producteur_raison_sociale: organisationProd?.raison_sociale ?? '',
          producteur_siret: organisationProd?.siret ?? null,
          producteur_adresse: organisationProd?.adresse ?? '',
          transporteur_nom: transporteurNom,
          transporteur_siret: transporteurSiret,
          exutoire_nom: 'Prestataire Savr',
          detail_flux: fluxDetails,
          poids_total_kg: poidsTotalKg,
          statut: 'brouillon',
        })
        .select('id')
        .single();

      if (bordErr || !bordereauRow) {
        throw new Error(`INSERT bordereaux_savr : ${bordErr?.message}`);
      }

      // 7. Créer la ligne rapports_rse
      const { data: rapportRow, error: rseErr } = await supabase
        .from('rapports_rse')
        .insert({
          collecte_id: collecte.id,
          evenement_id: collecte.evenement_id,
          version: 1,
          disponible_a: disponibleA.toISOString(),
          genere_par: 'automatique',
          filtres_benchmark: {},
        })
        .select('id')
        .single();

      if (rseErr || !rapportRow) {
        throw new Error(`INSERT rapports_rse : ${rseErr?.message}`);
      }

      // 8. Enqueuer le job bordereau
      await supabase.from('jobs_pdf').insert({
        type_document: 'bordereau-zd',
        entity_type: 'bordereaux_savr',
        entity_id: bordereauRow.id,
        payload: bordereauPayload,
        statut: 'pending',
        attempts: 0,
      });

      // 9. Enqueuer le job rapport
      await supabase.from('jobs_pdf').insert({
        type_document: 'rapport-recyclage-zd',
        entity_type: 'rapports_rse',
        entity_id: rapportRow.id,
        payload: rapportPayload,
        statut: 'pending',
        attempts: 0,
      });

      // 10. Email rapport_disponible au traiteur (async, non bloquant)
      if (ev.contact_principal_email) {
        const { sendEmail } = await import('@savr/shared/src/email/index.js');
        void sendEmail(
          'rapport_disponible',
          ev.contact_principal_email,
          {
            nom_evenement: ev.nom_evenement,
            date_evenement: dateEvenementStr,
            taux_recyclage:
              collecte.taux_recyclage != null
                ? `${collecte.taux_recyclage.toFixed(1)} %`
                : '—',
            co2_evite:
              collecte.co2_evite_kg != null
                ? `${(collecte.co2_evite_kg / 1000).toFixed(3)} t CO₂e`
                : '—',
          },
          { entityType: 'collectes', entityId: collecte.id },
        );
      }

      result.enqueued++;
    } catch (err) {
      result.errors.push(`collecte ${collecte.id}: ${String(err)}`);
    }
  }

  return result;
}
