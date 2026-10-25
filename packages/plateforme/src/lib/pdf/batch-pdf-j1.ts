// Batch J+1 6h — émet le bordereau ZD des collectes cloturees de la veille.
// Le rapport de recyclage n'est plus fabriqué ici (décision Val 2026-10-16) : le
// batch pose seulement sa ligne `rapports_rse` (fin d'embargo = disponible_a) et
// prévient le programmateur ; le PDF est fabriqué au clic, au choix de celui qui
// le télécharge (lib/collectes/rapport-a-la-demande).
// Règles : R-PDF1 (cloturee only), R-PDF3 (skip si 0 ligne collecte_flux),
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
import { logger } from '@savr/shared/src/logger/index.js';
import {
  anneeParis,
  formatDateParis,
  jourParis,
} from '@savr/shared/src/temps/index.js';
import { urlCanonique } from '@/lib/url-application.js';
import { ROUTES } from '@/lib/routes';

export interface BatchPdfJ1Result {
  enqueued: number;
  skipped_no_flux: number;
  escalated_r9: number;
  already_done: number;
  errors: string[];
  /** Échec global (sélection KO / 0 produit sur N tentés) → job.cron.failed. */
  fatal?: BatchFatal;
}

const JOB_NAME = 'bordereaux_rapports_batch';

interface CollecteRow {
  id: string;
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
    // Programmeur de la collecte (evenements.created_by → users, FK unique
    // evenements_created_by_fkey) → variable `prenom` de l'email (§06.02 §6).
    programmeur: { prenom: string | null } | null;
    traiteur_operationnel_organisation_id: string | null;
    organisations: {
      nom: string;
      raison_sociale: string;
      siret: string | null;
      adresse: string | null;
      // Destinataire email rapport_disponible = programmeur de la collecte (§06.02).
      email_principal: string | null;
      // Espace du programmateur → lien de l'email vers la fiche collecte.
      type: string | null;
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
): Promise<BatchPdfJ1Result> {
  const result: BatchPdfJ1Result = {
    enqueued: 0,
    skipped_no_flux: 0,
    escalated_r9: 0,
    already_done: 0,
    errors: [],
  };

  // Embargo H+24 (§12 énoncé canonique : « ni généré ni accessible avant
  // realisee_at + 24h »). Le document figé (bordereau + rapport) ne doit pas
  // être généré avant la fin de la fenêtre de correction de pesée. Le client
  // Supabase ne sait pas exprimer now()-interval côté SQL → seuil calculé en JS
  // (realisee_at = timestamptz), une seule fois pour toutes les pages.
  // Prédicat canonique : realisee_at + 24h <= now().
  const finEmbargo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // 1. Collectes ZD cloturees (toutes, par pages — cf. selection-par-pages)
  const { data: collectes, error: selErr } = await lireParPages<CollecteRow>(
    (apresId) => {
      const pages = supabase
        .from('collectes')
        .select(
          `
      id, evenement_id, realisee_at, date_collecte, pax,
      taux_recyclage, co2_evite_kg, nb_camions_demande, prestataire_logistique_id,
      evenements (
        id, nom_evenement, date_evenement,
        organisation_id, traiteur_operationnel_organisation_id,
        programmeur:users!created_by ( prenom ),
        organisations!organisation_id ( nom, raison_sociale, siret, adresse, email_principal, type ),
        traiteur_operationnel:organisations!traiteur_operationnel_organisation_id ( nom, raison_sociale, siret, adresse ),
        lieux ( nom, adresse_acces, code_postal, ville )
      )
    `,
        )
        .eq('type', 'zero_dechet')
        .eq('statut', 'cloturee')
        .lte('realisee_at', finEmbargo)
        .not('evenement_id', 'is', null);
      return (apresId ? pages.gt('id', apresId) : pages)
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
  type BordRow = { collecte_id: string; statut: string };
  const { data: existingBordereaux, error: bordSelErr } =
    await lireParLots<BordRow>(
      collectes.map((c) => c.id),
      (lot) =>
        supabase
          .from('bordereaux_savr')
          .select('collecte_id, statut')
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

  const doneIds = new Set(
    existingBordereaux
      .filter((b) => b.statut !== 'brouillon')
      .map((b) => b.collecte_id),
  );

  const toProcess = collectes.filter((c) => !doneIds.has(c.id));
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
          'flux_id, poids_reel_kg, nb_bacs, equivalent_roll, flux:flux_id ( nom, code )',
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

      const disponibleA = new Date(
        new Date(collecte.realisee_at).getTime() + 24 * 3600 * 1000,
      );

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
      //    au clic) à la fin de l'embargo. Aucun PDF n'est fabriqué ici.
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

      // 9. Email rapport_disponible au programmeur de la collecte (async, non bloquant).
      // Destinataire = email_principal de l'organisation programmante (§06.02 ; pas de
      // contact_principal_email sur evenements en V1 — différé V1.1, cf. §04 Data Model).
      // Variables = EXACTEMENT la liste du §06.02 §6 (prenom, date_collecte, lieu_nom,
      // poids_total, co2_evite, taux_recyclage, lien_rapport) : sendEmail refuse l'envoi
      // (MISSING_VARIABLE, §08 §4) dès qu'une variable déclarée au template manque.
      // Divergence M1.6 tranchée Val 2026-09-14 — l'ancien payload (nom_evenement /
      // date_evenement, CO₂ en tonnes) n'était pas celui du template.
      const emailDestinataire = ev.organisations?.email_principal;
      if (emailDestinataire) {
        const { sendEmail } = await import('@savr/shared/src/email/index.js');
        void sendEmail(
          'rapport_disponible',
          emailDestinataire,
          {
            // Programmeur = evenements.created_by, comme l'email d'annulation (tpl 5).
            // '' si inconnu : valeur fournie, l'envoi n'est pas refusé.
            prenom: ev.programmeur?.prenom ?? '',
            date_collecte: new Date(collecte.date_collecte).toLocaleDateString(
              'fr-FR',
              { timeZone: 'Europe/Paris' },
            ),
            lieu_nom: lieu?.nom ?? '',
            // Nombres nus : le corps du template porte les unités (« kg », « kg CO₂e », « % »).
            poids_total: formatNombre(poidsTotalKg),
            co2_evite: formatNombre(collecte.co2_evite_kg),
            taux_recyclage: formatNombre(collecte.taux_recyclage),
            lien_rapport: urlCanonique(
              cheminFicheCollecte(ev.organisations?.type, collecte.id),
            ),
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
            template: 'rapport_disponible',
            error: e instanceof Error ? e.message : String(e),
          });
        });
      }

      result.enqueued++;
    } catch (err) {
      result.errors.push(`collecte ${collecte.id}: ${String(err)}`);
      logCollecteEnEchec(JOB_NAME, collecte.id, err);
    }
  }

  result.fatal = fatalSiAucuneProduite(result.enqueued, result.errors);
  return result;
}

// ─── Helpers email rapport_disponible (§06.02 §6) ────────────────────────────

/** Nombre pour le corps de l'email, 1 décimale max, format FR (ex. « 12,5 ») ; « — » si absent. */
function formatNombre(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
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
