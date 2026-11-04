// Batch des bordereaux ZD — émet le bordereau d'une collecte dès que ses pesées
// sont là (realisee ou cloturee, Val 2026-11-04), et le refait quand elles
// changent. Passe toutes les 15 min, et sur-le-champ après une saisie Admin
// (documents-sans-attendre). L'email « rapport disponible » part à la clôture
// (emails-documents-disponibles), plus d'ici.
// Le rapport de recyclage n'est plus fabriqué ici (décision Val 2026-10-16) : le
// batch pose seulement sa ligne `rapports_rse` (fin d'embargo = disponible_a) et
// prévient le programmateur ; le PDF est fabriqué au clic, au choix de celui qui
// le télécharge (lib/collectes/rapport-a-la-demande).
// Règles : R-PDF3 (skip si 0 ligne collecte_flux),
//          R-PDF4 (escalade R9 si > 48h sans bordereau).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

import {
  type BatchFatal,
  fatalSelection,
  fatalSiAucuneProduite,
  logCollecteEnEchec,
} from './batch-fatal.js';
import { convivesImprimes } from './convives-imprimes.js';
import {
  TAILLE_PAGE,
  lireParPages,
  lireParLots,
} from './selection-par-pages.js';
import {
  anneeParis,
  formatDateParis,
  jourParis,
} from '@savr/shared/src/temps/index.js';
import { ROUTES } from '@/lib/routes';

export interface BatchPdfJ1Result {
  enqueued: number;
  skipped_no_flux: number;
  escalated_r9: number;
  already_done: number;
  errors: string[];
  /** Bordereaux refaits après un changement de pesées. */
  refaits: number;
  /** Échec global (sélection KO / 0 produit sur N tentés) → job.cron.failed. */
  fatal?: BatchFatal;
}

export interface BatchOptions {
  /** Une seule collecte (saisie Admin) : son bordereau est toujours revu. */
  collecteId?: string;
}

const JOB_NAME = 'bordereaux_rapports_batch';

interface CollecteRow {
  id: string;
  statut: string;
  evenement_id: string;
  realisee_at: string;
  // Date d'intervention du prestataire (§04 `collectes.date_collecte`, DATE
  // « YYYY-MM-DD »). Snapshotée sur le bordereau (§04 `bordereaux_savr.date_collecte`),
  // affichée « Intervention le … » sur bordereau + rapport (§12 §1.1 / §1.2) et
  // variable `date_collecte` de l'email rapport_disponible (§06.02 §6).
  date_collecte: string;
  // Convives de LA collecte, imprimés sur le bordereau (Val Q5 du 2026-10-24).
  pax: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  nb_camions_demande: number;
  // Transporteur = prestataire logistique de la collecte (shared.prestataires).
  // tournees n'a pas de transporteur_id ; la FK est prestataire_logistique_id → shared.prestataires.
  prestataire_logistique_id: string | null;
  evenements: {
    id: string;
    nom_evenement: string;
    date_evenement: string;
    organisation_id: string;
    traiteur_operationnel_organisation_id: string | null;
    organisations: {
      nom: string;
      raison_sociale: string;
      siret: string | null;
      adresse: string | null;
    } | null;
    traiteur_operationnel: {
      nom: string;
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
  } | null;
}

export async function runBatchPdfJ1(
  supabase: SupabaseClient,
  options: BatchOptions = {},
): Promise<BatchPdfJ1Result> {
  const result: BatchPdfJ1Result = {
    enqueued: 0,
    skipped_no_flux: 0,
    escalated_r9: 0,
    already_done: 0,
    refaits: 0,
    errors: [],
  };

  // 1. Collectes ZD realisee ou cloturee (par pages — cf. selection-par-pages).
  //    Plus d'embargo : le bordereau sort dès que les pesées sont là.
  const { data: collectes, error: selErr } = await lireParPages<CollecteRow>(
    (apresId) => {
      const pages = supabase
        .from('collectes')
        .select(
          `
      id, statut, evenement_id, realisee_at, date_collecte, pax,
      taux_recyclage, co2_evite_kg, nb_camions_demande, prestataire_logistique_id,
      evenements (
        id, nom_evenement, date_evenement,
        organisation_id, traiteur_operationnel_organisation_id,
        organisations!organisation_id ( nom, raison_sociale, siret, adresse ),
        traiteur_operationnel:organisations!traiteur_operationnel_organisation_id ( nom, raison_sociale, siret, adresse ),
        lieux ( nom, adresse_acces, code_postal, ville )
      )
    `,
        )
        .eq('type', 'zero_dechet')
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
    result.fatal = fatalSelection(result.errors, 'Sélection collectes', selErr);
    return result;
  }

  if (!collectes.length) return result;

  // 2. Exclure celles qui ont déjà un bordereau
  type BordRow = {
    id: string;
    collecte_id: string;
    statut: string;
    detail_flux: unknown;
    version: number;
  };
  const { data: existingBordereaux, error: bordSelErr } =
    await lireParLots<BordRow>(
      collectes.map((c) => c.id),
      (lot) =>
        supabase
          .from('bordereaux_savr')
          .select('id, collecte_id, statut, detail_flux, version')
          .in('collecte_id', lot),
    );

  // Fail-closed : sans la liste des bordereaux émis, traiter = ré-émettre (BSAV gapless
  // consommé, doublon de document réglementaire).
  if (bordSelErr) {
    result.fatal = fatalSelection(
      result.errors,
      'Sélection bordereaux existants',
      bordSelErr,
    );
    return result;
  }

  const emis = new Map(
    existingBordereaux
      .filter((b) => b.statut !== 'brouillon')
      .map((b) => [b.collecte_id, b]),
  );

  const toProcess = collectes.filter((c) => !emis.has(c.id));
  result.already_done = collectes.length - toProcess.length;

  // 2bis. Bordereau déjà émis : refait si les pesées ont changé depuis. Revu tant
  //       que MTS-1 peut encore les corriger (realisee), et toujours pour une
  //       collecte nommée (saisie Admin, possible même après la clôture).
  for (const collecte of collectes) {
    const bordereau = emis.get(collecte.id);
    if (!bordereau) continue;
    if (collecte.statut !== 'realisee' && !options.collecteId) continue;
    try {
      if (await refaireSiPeseesChangees(supabase, collecte.id, bordereau)) {
        result.refaits++;
      }
    } catch (err) {
      result.errors.push(`collecte ${collecte.id}: ${String(err)}`);
      logCollecteEnEchec(JOB_NAME, collecte.id, err);
    }
  }

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
      const { fluxDetails, poidsTotalKg } = await lireFlux(
        supabase,
        collecte.id,
      );

      // 5. Allouer le numéro BSAV (gapless)
      // Année PARISIENNE : le batch tourne à 6h, mais une reprise manuelle juste
      // après minuit le 1er janvier aurait tiré le numéro sur la séquence de
      // l'année écoulée (process UTC).
      const annee = anneeParis();
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

      // Date d'intervention = `collectes.date_collecte` (§12 §1.1 « intervention le
      // {{date_collecte}} », §04 bordereaux_savr.date_collecte = snapshot). Jamais la
      // date du jour : le batch tourne à J+1 au plus tôt, et peut rattraper des
      // collectes bien plus anciennes (relevé savr-dev 2026-10-02 : collecte du
      // 10/09 rendue « Intervention le 01/10 »). Valeur DATE « YYYY-MM-DD » →
      // formatDateParis la rend telle quelle, sans passer par un instant.
      const dateCollecteStr = formatDateParis(collecte.date_collecte);
      const dateEvenementStr = new Date(ev.date_evenement).toLocaleDateString(
        'fr-FR',
        { timeZone: 'Europe/Paris' },
      );
      const dateEmissionStr = new Date().toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris',
      });

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
        nb_pax: convivesImprimes(collecte.pax),
        flux: fluxDetails,
        poids_total_kg: poidsTotalKg,
      };

      // Disponible tout de suite (plus d'embargo, Val 2026-11-04).
      const disponibleA = new Date();

      // 6. Créer la ligne bordereaux_savr (snapshot)
      const { data: bordereauRow, error: bordErr } = await supabase
        .from('bordereaux_savr')
        .insert({
          collecte_id: collecte.id,
          numero,
          date_emission: jourParis(),
          // Snapshot de la date d'intervention (§04), pas du jour d'émission.
          date_collecte: collecte.date_collecte,
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

      // 7. Créer la ligne rapports_rse : le rapport devient téléchargeable (fabriqué
      //    au clic) tout de suite. Aucun PDF n'est fabriqué ici.
      const { data: rapportRow, error: rseErr } = await supabase
        .from('rapports_rse')
        .insert({
          collecte_id: collecte.id,
          evenement_id: collecte.evenement_id,
          version: 1,
          disponible_a: disponibleA.toISOString(),
          genere_par: 'automatique',
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

      result.enqueued++;
    } catch (err) {
      result.errors.push(`collecte ${collecte.id}: ${String(err)}`);
      logCollecteEnEchec(JOB_NAME, collecte.id, err);
    }
  }

  result.fatal = fatalSiAucuneProduite(result.enqueued, result.errors);
  return result;
}

/**
 * Fiche collecte de l'espace du programmeur (bouton « Voir le rapport »). Le
 * rapport se télécharge depuis la fiche collecte de chaque espace client ; le
 * chemin dépend du type de l'organisation programmatrice.
 */
export function cheminFicheCollecte(
  typeOrganisation: string | null | undefined,
  collecteId: string,
): string {
  if (typeOrganisation === 'agence') return ROUTES.agence.collecte(collecteId);
  if (typeOrganisation === 'gestionnaire_lieux')
    return ROUTES.gestionnaire.collecte(collecteId);
  return ROUTES.traiteur.collecte(collecteId);
}

// ─── Pesées et document refait ──────────────────────────────────────────────

interface FluxDetail {
  nom: string;
  poids_kg: number;
  nb_bacs: number | null;
  equivalent_roll: number | null;
}

async function lireFlux(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<{ fluxDetails: FluxDetail[]; poidsTotalKg: number }> {
  const { data: flux, error } = await supabase
    .from('collecte_flux')
    .select(
      'flux_id, poids_reel_kg, nb_bacs, equivalent_roll, flux:flux_id ( nom, code )',
    )
    .eq('collecte_id', collecteId)
    .order('flux_id', { ascending: true });
  if (error) throw new Error(`Lecture collecte_flux : ${error.message}`);

  const fluxDetails = (flux ?? []).map((f: Record<string, unknown>) => ({
    nom: (f.flux as { nom: string } | null)?.nom ?? String(f.flux_id),
    poids_kg: Number(f.poids_reel_kg),
    nb_bacs: f.nb_bacs != null ? Number(f.nb_bacs) : null,
    equivalent_roll:
      f.equivalent_roll != null ? Number(f.equivalent_roll) : null,
  }));
  const poidsTotalKg = fluxDetails.reduce((s, f) => s + f.poids_kg, 0);
  return { fluxDetails, poidsTotalKg };
}

/** Pesées comparées par filière, dans un ordre stable. */
function empreinteFlux(flux: unknown): string {
  if (!Array.isArray(flux)) return '';
  return JSON.stringify(
    (flux as FluxDetail[])
      .map((f) => [
        f.nom,
        Number(f.poids_kg),
        f.nb_bacs ?? null,
        f.equivalent_roll ?? null,
      ])
      .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
  );
}

/**
 * Refait le bordereau émis quand les pesées ont changé : même numéro, pesées et
 * total du moment, version suivante (le reste reprend le dernier rendu, comme la
 * régénération Admin). Rend `true` s'il est refait.
 */
async function refaireSiPeseesChangees(
  supabase: SupabaseClient,
  collecteId: string,
  bordereau: { id: string; detail_flux: unknown; version: number },
): Promise<boolean> {
  const { fluxDetails, poidsTotalKg } = await lireFlux(supabase, collecteId);
  if (!fluxDetails.length) return false;
  if (empreinteFlux(fluxDetails) === empreinteFlux(bordereau.detail_flux)) {
    return false;
  }

  const { data: dernierJob, error: jobErr } = await supabase
    .from('jobs_pdf')
    .select('payload')
    .eq('entity_type', 'bordereaux_savr')
    .eq('entity_id', bordereau.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobErr) throw new Error(`Lecture du dernier rendu : ${jobErr.message}`);
  if (!dernierJob) throw new Error('Bordereau émis sans rendu antérieur');

  const payload = {
    ...(dernierJob as { payload: Record<string, unknown> }).payload,
    flux: fluxDetails,
    poids_total_kg: poidsTotalKg,
    regenere_le: new Date().toLocaleDateString('fr-FR', {
      timeZone: 'Europe/Paris',
    }),
  };

  // Rendu d'abord, pesées du bordereau ensuite : un échec entre les deux laisse
  // l'écart visible au passage suivant, qui refera le rendu.
  const { error: insErr } = await supabase.from('jobs_pdf').insert({
    type_document: 'bordereau-zd',
    entity_type: 'bordereaux_savr',
    entity_id: bordereau.id,
    payload,
    statut: 'pending',
    attempts: 0,
  });
  if (insErr?.code === '23505') {
    // Un rendu attend déjà dans la file (index anti-doublon) : il prend les
    // nouvelles pesées. En cours de rendu, rien n'est touché et le passage
    // suivant recommence.
    const { data: repris, error: repErr } = await supabase
      .from('jobs_pdf')
      .update({ payload })
      .eq('entity_type', 'bordereaux_savr')
      .eq('entity_id', bordereau.id)
      .eq('statut', 'pending')
      .select('id');
    if (repErr) throw new Error(`Rendu en attente : ${repErr.message}`);
    if (!repris?.length) return false;
  } else if (insErr) {
    throw new Error(`Mise en file : ${insErr.message}`);
  }

  const { error: majErr } = await supabase
    .from('bordereaux_savr')
    .update({
      detail_flux: fluxDetails,
      poids_total_kg: poidsTotalKg,
      version: bordereau.version + 1,
    })
    .eq('id', bordereau.id);
  if (majErr) throw new Error(`Mise à jour bordereau : ${majErr.message}`);
  return true;
}
