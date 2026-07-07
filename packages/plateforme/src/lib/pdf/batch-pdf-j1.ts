// Batch J+1 6h — génère les PDFs ZD pour les collectes cloturees de la veille.
// Règles : R-PDF1 (cloturee only), R-PDF3 (skip si 0 ligne collecte_flux),
//          R-PDF4 (escalade R9 si > 48h sans bordereau).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

import { resolveRapportBenchmark } from './rapport-benchmark.js';
import { resolveRapportLogo } from './logo-cascade.js';

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
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  co2_induit_kg: number | null;
  co2_net_kg: number | null;
  energie_primaire_evitee_kwh: number | null;
  co2_facteurs_snapshot: Record<string, unknown> | null;
  nb_camions_demande: number;
  // Transporteur = prestataire logistique de la collecte (shared.prestataires).
  // tournees n'a pas de transporteur_id ; la FK est prestataire_logistique_id → shared.prestataires.
  prestataire_logistique_id: string | null;
  evenements: {
    id: string;
    nom_evenement: string;
    date_evenement: string;
    pax: number | null;
    organisation_id: string;
    traiteur_operationnel_organisation_id: string | null;
    // Cascade logo §1.2 (BL-P2-19).
    client_organisateur_organisation_id: string | null;
    logo_client_organisateur_url: string | null;
    organisations: {
      raison_sociale: string;
      siret: string | null;
      adresse: string | null;
      // Destinataire email rapport_disponible = programmeur de la collecte (§06.02).
      email_principal: string | null;
      // Cascade logo §1.2 : type (agence prime) + logo du programmateur.
      type: string | null;
      logo_url: string | null;
    } | null;
    traiteur_operationnel: {
      raison_sociale: string;
      siret: string | null;
      adresse: string | null;
      logo_url: string | null;
    } | null;
    // Organisation du client organisateur (compte Savr) — logo cascade §1.2 étape 2.
    client_organisateur: {
      logo_url: string | null;
    } | null;
    lieux: {
      nom: string;
      adresse_acces: string | null;
      code_postal: string | null;
      ville: string | null;
    } | null;
  } | null;
}

/** Ligne retournée par la RPC plateforme.f_taux_recyclage_moyen_parc (§12 §1.2 l.67). */
interface ParcMoyenRow {
  taux_moyen_pondere: number;
  nb_organisations: number;
  nb_collectes: number;
}

/**
 * Équivalences pédagogiques du CO₂ évité (§12 §1.2 l.63/l.65). Les facteurs sont figés
 * dans `co2_facteurs_snapshot.equivalences` à la clôture (reproductibilité) :
 *   - km_voiture / repas_boeuf = kgCO₂e par unité → compte = co2_evite_kg / facteur
 *   - foyer_kwh = kWh/an d'un foyer → compte = energie_primaire_evitee_kwh / facteur
 * Retourne undefined si pas de CO₂ évité ou pas de snapshot (bloc masqué côté PDF).
 */
export function buildEquivalences(
  co2EviteKg: number | null,
  energiePrimaireKwh: number | null,
  snapshot: Record<string, unknown> | null,
):
  | {
      km_voiture: number | null;
      repas_boeuf: number | null;
      foyer: number | null;
    }
  | undefined {
  if (co2EviteKg == null || !snapshot) return undefined;
  const eqv = (snapshot as { equivalences?: Record<string, unknown> })
    .equivalences;
  if (!eqv) return undefined;
  const feKm = Number(eqv.km_voiture);
  const feBoeuf = Number(eqv.repas_boeuf);
  const feFoyer = Number(eqv.foyer_kwh);
  return {
    km_voiture: feKm > 0 ? Math.round(co2EviteKg / feKm) : null,
    repas_boeuf: feBoeuf > 0 ? Math.round(co2EviteKg / feBoeuf) : null,
    foyer:
      energiePrimaireKwh != null && feFoyer > 0
        ? Math.round(energiePrimaireKwh / feFoyer)
        : null,
  };
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
      id, evenement_id, realisee_at,
      taux_recyclage, co2_evite_kg, co2_induit_kg, co2_net_kg, energie_primaire_evitee_kwh,
      co2_facteurs_snapshot, nb_camions_demande, prestataire_logistique_id,
      evenements (
        id, nom_evenement, date_evenement, pax,
        organisation_id, traiteur_operationnel_organisation_id,
        client_organisateur_organisation_id, logo_client_organisateur_url,
        organisations ( raison_sociale, siret, adresse, email_principal, type, logo_url ),
        traiteur_operationnel:organisations!traiteur_operationnel_organisation_id ( raison_sociale, siret, adresse, logo_url ),
        client_organisateur:organisations!client_organisateur_organisation_id ( logo_url ),
        lieux ( nom, adresse_acces, code_postal, ville )
      )
    `,
    )
    .eq('type', 'zero_dechet')
    .eq('statut', 'cloturee')
    // Embargo H+24 (§12 énoncé canonique : « ni généré ni accessible avant
    // realisee_at + 24h »). Le document figé (bordereau + rapport) ne doit pas
    // être généré avant la fin de la fenêtre de correction de pesée. Le client
    // Supabase ne sait pas exprimer now()-interval côté SQL → seuil calculé en JS
    // (realisee_at = timestamptz). Prédicat canonique : realisee_at + 24h <= now().
    .lte('realisee_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
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

  // Comparaison vs moyenne Savr anonymisée (§12 §1.2 l.67) — parc-wide, identique pour
  // toutes les collectes du batch → calculée une seule fois. Masquée si < 3 acteurs
  // (la fonction ne retourne aucune ligne). Distinct du benchmark kg/pax (k≥5, par collecte).
  const { data: parcRows } = await supabase.rpc(
    'f_taux_recyclage_moyen_parc',
    {},
  );
  const parc = ((parcRows ?? []) as ParcMoyenRow[])[0];
  const comparaisonSavr = parc
    ? {
        taux_moyen_pondere: Number(parc.taux_moyen_pondere),
        nb_organisations: parc.nb_organisations,
      }
    : undefined;

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

        // R-PDF4 / R9 : escalade si skip > 48h (base realisee_at, alignée embargo H+24)
        const realiseeAt = collecte.realisee_at
          ? new Date(collecte.realisee_at)
          : null;
        if (
          realiseeAt &&
          now.getTime() - realiseeAt.getTime() > 48 * 3600 * 1000
        ) {
          await supabase.rpc('f_upsert_alerte_admin', {
            p_code: 'bordereau_pesees_manquantes_48h',
            p_titre: 'Saisie manuelle requise — pesées incomplètes',
            p_message: `Collecte ${collecte.id} réalisée depuis > 48h sans pesées. Vérifier la remontée MTS-1 ou saisir manuellement.`,
            p_entity_type: 'collectes',
            p_entity_id: collecte.id,
          });
          result.escalated_r9++;
        }
        continue;
      }

      // 4. Charger les flux pour le payload (équivalent bacs/rolls inclus, §12 §1.1)
      const { data: flux } = await supabase
        .from('collecte_flux')
        .select(
          'flux_id, poids_reel_kg, nb_bacs, equivalent_roll, flux:flux_id ( nom )',
        )
        .eq('collecte_id', collecte.id);

      const fluxDetails = (flux ?? []).map((f: Record<string, unknown>) => ({
        nom: (f.flux as { nom: string } | null)?.nom ?? String(f.flux_id),
        poids_kg: Number(f.poids_reel_kg),
        nb_bacs: f.nb_bacs != null ? Number(f.nb_bacs) : null,
        equivalent_roll:
          f.equivalent_roll != null ? Number(f.equivalent_roll) : null,
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

      // Transporteur = prestataire logistique de la collecte (snapshot bordereau).
      // Source : shared.prestataires via collectes.prestataire_logistique_id (cf. v_registre_dechets).
      let transporteurNom = 'Non renseigné';
      let transporteurSiret: string | null = null;
      if (collecte.prestataire_logistique_id) {
        const { data: prestataire } = await supabase
          .schema('shared')
          .from('prestataires')
          .select('nom, siret')
          .eq('id', collecte.prestataire_logistique_id)
          .single();
        const p = prestataire as { nom: string; siret: string | null } | null;
        if (p) {
          transporteurNom = p.nom ?? 'Non renseigné';
          transporteurSiret = p.siret ?? null;
        }
      }

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
        nb_pax: ev.pax,
        flux: fluxDetails,
        poids_total_kg: poidsTotalKg,
      };

      const disponibleA = new Date(
        new Date(collecte.realisee_at).getTime() + 24 * 3600 * 1000,
      );

      // 5bis. Bloc benchmark §12 §1.2 (BL-P1-RPT-01) — 5 jauges kg/pax + point rouge
      // parc. Défaut batch auto (pas de filtres) : segment = type d'événement + taille
      // de la collecte ; le helper résout filtres, légende et snapshot (k-anonymat ≥5).
      const benchmark = await resolveRapportBenchmark(supabase, collecte.id);
      const filtresBenchmark = benchmark.filtres_benchmark;

      // Équivalences pédagogiques du CO₂ évité (§12 §1.2 l.63) — comptes dérivés des
      // FACTEURS figés dans co2_facteurs_snapshot.equivalences (km_voiture/repas_boeuf =
      // kgCO₂e/unité ; foyer_kwh = kWh/an). Absent si pas de snapshot / pas de CO₂.
      const equivalences = buildEquivalences(
        collecte.co2_evite_kg,
        collecte.energie_primaire_evitee_kwh,
        collecte.co2_facteurs_snapshot,
      );

      // Cascade logo client §12 §1.2 (BL-P2-19) : agence prime → client organisateur
      // (compte Savr, sinon upload) → traiteur opérationnel → Savr (fallback template).
      const logo = resolveRapportLogo({
        programmateur: ev.organisations,
        client_organisateur: ev.client_organisateur,
        evenement_logo_client_url: ev.logo_client_organisateur_url,
        traiteur_operationnel: ev.traiteur_operationnel ?? ev.organisations,
      });

      const rapportPayload = {
        nom_evenement: ev.nom_evenement,
        date_evenement: dateEvenementStr,
        date_collecte: dateCollecteStr,
        lieu_nom: lieu?.nom ?? '',
        lieu_adresse: adresseLieu,
        nb_pax: ev.pax,
        traiteur_nom: organisationProd?.raison_sociale ?? '',
        logo_url: logo.logo_url,
        taux_recyclage: collecte.taux_recyclage,
        flux: fluxDetails,
        poids_total_kg: poidsTotalKg,
        co2_evite_kg: collecte.co2_evite_kg,
        co2_induit_kg: collecte.co2_induit_kg,
        co2_net_kg: collecte.co2_net_kg,
        energie_primaire_evitee_kwh: collecte.energie_primaire_evitee_kwh,
        co2_facteurs_version: (
          collecte.co2_facteurs_snapshot as Record<string, unknown> | null
        )?.version_parametres_at as string | undefined,
        equivalences,
        comparaison_savr: comparaisonSavr,
        benchmark_flux: benchmark.benchmark_flux,
        benchmark_legende: benchmark.benchmark_legende,
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
          filtres_benchmark: filtresBenchmark,
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

      // 10. Email rapport_disponible au programmeur de la collecte (async, non bloquant).
      // Destinataire = email_principal de l'organisation programmante (§06.02 ; pas de
      // contact_principal_email sur evenements en V1 — différé V1.1, cf. §04 Data Model).
      const emailDestinataire = ev.organisations?.email_principal;
      if (emailDestinataire) {
        const { sendEmail } = await import('@savr/shared/src/email/index.js');
        void sendEmail(
          'rapport_disponible',
          emailDestinataire,
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
