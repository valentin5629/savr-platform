// Batch des bordereaux ZD — émet le bordereau d'une collecte dès que ses pesées
// sont là (realisee ou cloturee, Val 2026-11-04), et le met à jour quand elles
// changent. Passe toutes les 15 min, et sur-le-champ après une saisie Admin
// (documents-sans-attendre). L'email « rapport disponible » part à la clôture
// (emails-documents-disponibles), plus d'ici.
// Le bordereau n'a plus de PDF (décision Val 2026-11-13) : sa ligne
// `bordereaux_savr` (numéro BSAV gapless, pesées figées) reste, émise ici sans
// document ; elle alimente le rapport de recyclage, le registre et l'email.
// Le rapport de recyclage n'est plus fabriqué ici (décision Val 2026-10-16) : le
// batch pose seulement sa ligne `rapports_rse` (disponible_a = instant
// d'émission) ; le PDF est fabriqué au clic, au choix de celui qui le
// télécharge (lib/collectes/rapport-a-la-demande).
// Règles : R-PDF3 (skip si 0 ligne collecte_flux),
//          R-PDF4 (escalade R9 si > 48h sans bordereau).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

import {
  type BatchFatal,
  fatalSelection,
  fatalSiAucuneProduite,
  logCollecteEnEchec,
} from './batch-fatal.js';
import {
  TAILLE_LOT,
  TAILLE_PAGE,
  lireParPages,
  lireParLots,
} from './selection-par-pages.js';
import { anneeParis, jourParis } from '@savr/shared/src/temps/index.js';
import { ROUTES } from '@/lib/routes';
import { erreurInterne } from '@/lib/api-helpers.js';

export interface BatchPdfJ1Result {
  enqueued: number;
  skipped_no_flux: number;
  escalated_r9: number;
  already_done: number;
  errors: string[];
  /** Bordereaux mis à jour après un changement de pesées. */
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
  // affichée « Intervention le … » sur le rapport (§12 §1.2).
  date_collecte: string;
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
      id, statut, evenement_id, realisee_at, date_collecte,
      taux_recyclage, co2_evite_kg, nb_camions_demande, prestataire_logistique_id,
      evenements (
        id, nom_evenement, date_evenement,
        organisation_id, traiteur_operationnel_organisation_id,
        organisations!organisation_id ( nom, raison_sociale, siret, adresse ),
        traiteur_operationnel:organisations!traiteur_operationnel_organisation_id ( nom, raison_sociale, siret, adresse )
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
    numero: string | null;
    detail_flux: unknown;
    version: number;
  };
  const { data: existingBordereaux, error: bordSelErr } =
    await lireParLots<BordRow>(
      collectes.map((c) => c.id),
      (lot) =>
        supabase
          .from('bordereaux_savr')
          .select('id, collecte_id, statut, numero, detail_flux, version')
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

  // Un bordereau déjà créé n'est jamais recréé : il a son numéro BSAV gapless
  // (ou le prendra, cf. reprise ci-dessous). Seule exception : une ligne restée
  // sans numéro (échec entre sa création et le tirage du numéro), reprise ici.
  const existants = new Map(existingBordereaux.map((b) => [b.collecte_id, b]));
  const toProcess = collectes.filter((c) => {
    const b = existants.get(c.id);
    // Reprise : seulement un brouillon sans numéro (création interrompue). Un
    // document émis sans numéro (jeu de données, import) n'est jamais renuméroté.
    return !b || (b.numero == null && b.statut === 'brouillon');
  });
  result.already_done = collectes.length - toProcess.length;

  // 2bis. Bordereau existant : refait si les pesées ont changé. Revu pour la
  //       collecte nommée (saisie Admin) et pour toute collecte dont une pesée a
  //       été écrite dans les 48 dernières heures (MTS-1 jusqu'à la clôture,
  //       Admin à tout moment) : une correction tombée pendant un rendu en cours
  //       est ainsi reprise au passage suivant, même après la clôture.
  let aRevoir = new Set<string>();
  const numerotes = existingBordereaux.some((b) => b.numero != null);
  if (options.collecteId) {
    aRevoir = new Set([options.collecteId]);
  } else if (numerotes) {
    const depuis = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    // Par pages (cf. selection-par-pages) : une lecture unique est amputée à
    // 1 000 lignes sans erreur, et les bordereaux des collectes laissées de
    // côté ne seraient pas revus à ce passage. Un chargement en masse de
    // pesées suffit à dépasser ce nombre en 48 h.
    const { data: recents, error: recErr } = await lireParPages<{
      id: string;
      collecte_id: string;
    }>((apresId) => {
      const pesees = supabase
        .from('collecte_flux')
        .select('id, collecte_id')
        .gte('updated_at', depuis);
      return (apresId ? pesees.gt('id', apresId) : pesees)
        .order('id', { ascending: true })
        .limit(TAILLE_PAGE);
    });
    if (recErr) {
      result.fatal = fatalSelection(
        result.errors,
        'Sélection pesées récentes',
        recErr,
      );
      return result;
    }
    aRevoir = new Set(recents.map((r) => r.collecte_id));
  }
  for (const collecte of collectes) {
    const bordereau = existants.get(collecte.id);
    if (!bordereau || bordereau.numero == null || !aRevoir.has(collecte.id)) {
      continue;
    }
    try {
      if (await refaireSiPeseesChangees(supabase, collecte.id, bordereau)) {
        result.refaits++;
      }
    } catch (err) {
      result.errors.push(`collecte ${collecte.id}: ${String(err)}`);
      logCollecteEnEchec(JOB_NAME, collecte.id, err);
    }
  }

  // 2ter. Bordereau numéroté resté en brouillon (rendu PDF en attente au
  //       passage au bordereau sans PDF, Val 2026-11-13) : émis ici. Un
  //       producteur fantôme sans SIRET reste en brouillon (la base l'y garde,
  //       trg_bordereau_gate_shadow_siret) jusqu'à l'arrivée du SIRET.
  const brouillonsNumerotes = existingBordereaux
    .filter((b) => b.numero != null && b.statut === 'brouillon')
    .map((b) => b.id);
  for (let i = 0; i < brouillonsNumerotes.length; i += TAILLE_LOT) {
    const { error: emisErr } = await supabase
      .from('bordereaux_savr')
      .update({ statut: 'emis', genere_at: new Date().toISOString() })
      .in('id', brouillonsNumerotes.slice(i, i + TAILLE_LOT))
      .eq('statut', 'brouillon');
    if (emisErr) {
      result.errors.push(
        `Émission des bordereaux numérotés : ${String(erreurInterne(emisErr, 'pdf.batch_zd.emission_brouillons'))}`,
      );
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

        // R-PDF4 / R9 : escalade si skip > 48h (base realisee_at)
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

      const ev = collecte.evenements!;
      // Producteur = traiteur opérationnel si désigné, sinon l'organisation programmante
      const organisationProd = ev.traiteur_operationnel ?? ev.organisations;

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

      // Disponible tout de suite (plus d'embargo, Val 2026-11-04).
      const disponibleA = new Date();

      // 5. Créer la ligne bordereaux_savr (snapshot), SANS numéro : l'unicité de
      //    collecte_id départage deux fabrications simultanées (passage planifié
      //    et saisie Admin) avant qu'un numéro gapless soit tiré. Une ligne
      //    restée sans numéro est reprise telle quelle.
      let bordereauId = existants.get(collecte.id)?.id;
      if (!bordereauId) {
        const { data: bordereauRow, error: bordErr } = await supabase
          .from('bordereaux_savr')
          .insert({
            collecte_id: collecte.id,
            numero: null,
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

        if (bordErr?.code === '23505') {
          // Créé à l'instant par une autre fabrication : rien à faire ici.
          result.already_done++;
          continue;
        }
        if (bordErr || !bordereauRow) {
          throw erreurInterne(bordErr, 'pdf.batch_zd.insert_bordereau');
        }
        bordereauId = bordereauRow.id as string;
      }

      // 6. Numéro BSAV (gapless), tiré une fois la ligne acquise.
      // Année PARISIENNE : une reprise juste après minuit le 1er janvier aurait
      // tiré le numéro sur la séquence de l'année écoulée (process UTC).
      const { data: numeroData, error: numErr } = await supabase
        .rpc('f_next_numero_bordereau', { p_annee: anneeParis() })
        .single();
      if (numErr || !numeroData) {
        throw erreurInterne(numErr, 'pdf.batch_zd.numero');
      }
      const numero = numeroData as string;
      // Émis avec son numéro, sans PDF (Val 2026-11-13). Producteur fantôme
      // sans SIRET : la base le garde en brouillon (trg_bordereau_gate_shadow_siret)
      // et l'émet à l'arrivée du SIRET (trg_cerfa_debloque_siret).
      const { data: numerote, error: numMajErr } = await supabase
        .from('bordereaux_savr')
        .update({ numero, statut: 'emis', genere_at: new Date().toISOString() })
        .eq('id', bordereauId)
        .is('numero', null)
        .select('id');
      if (numMajErr) throw erreurInterne(numMajErr, 'pdf.batch_zd.numero_maj');
      // Numéroté entre-temps par une autre reprise : la suite est la sienne.
      if (!numerote?.length) continue;

      // 7. Créer la ligne rapports_rse : le rapport devient téléchargeable (fabriqué
      //    au clic) tout de suite. Aucun PDF n'est fabriqué ici. Une reprise ne
      //    la recrée pas.
      const { data: rapportExistant, error: rseLecErr } = await supabase
        .from('rapports_rse')
        .select('id')
        .eq('collecte_id', collecte.id)
        .limit(1)
        .maybeSingle();
      if (rseLecErr)
        throw erreurInterne(rseLecErr, 'pdf.batch_zd.lecture_rapport');
      if (!rapportExistant) {
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
          throw erreurInterne(rseErr, 'pdf.batch_zd.insert_rapport');
        }
      }

      result.enqueued++;
    } catch (err) {
      result.errors.push(`collecte ${collecte.id}: ${String(err)}`);
      logCollecteEnEchec(JOB_NAME, collecte.id, err);
    }
  }

  // Un passage qui n'a fait que mettre à jour des bordereaux a produit quelque chose.
  result.fatal = fatalSiAucuneProduite(
    result.enqueued + result.refaits,
    result.errors,
  );
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
  if (error) throw erreurInterne(error, 'pdf.batch_zd.lecture_flux');

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
 * Met le bordereau à jour quand les pesées ont changé : même numéro, pesées et
 * total du moment ; version suivante s'il était déjà émis. Rend `true` s'il est
 * mis à jour.
 */
async function refaireSiPeseesChangees(
  supabase: SupabaseClient,
  collecteId: string,
  bordereau: {
    id: string;
    statut: string;
    detail_flux: unknown;
    version: number;
  },
): Promise<boolean> {
  const { fluxDetails, poidsTotalKg } = await lireFlux(supabase, collecteId);
  if (!fluxDetails.length) return false;
  if (empreinteFlux(fluxDetails) === empreinteFlux(bordereau.detail_flux)) {
    return false;
  }

  const emis = bordereau.statut !== 'brouillon';
  const { error: majErr } = await supabase
    .from('bordereaux_savr')
    .update({
      detail_flux: fluxDetails,
      poids_total_kg: poidsTotalKg,
      ...(emis ? { version: bordereau.version + 1 } : {}),
    })
    .eq('id', bordereau.id);
  if (majErr) throw erreurInterne(majErr, 'pdf.batch_zd.maj_bordereau');
  return true;
}
