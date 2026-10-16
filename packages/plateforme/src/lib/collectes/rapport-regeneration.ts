import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import {
  createSupabaseServerClient,
  type UserAuthContext,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { reponseFiltreInterdit } from '@/lib/collectes/benchmark-fiche.js';
import {
  regenerateCollecteDocument,
  type VersionRapportRecyclage,
} from '@/lib/pdf/regenerate.js';
import {
  construireRadarRapport,
  lireFiltresRadar,
  type FiltresRadar,
} from '@/lib/pdf/rapport-radar.js';

// Régénération du rapport de recyclage d'UNE collecte ZD depuis la fiche client —
// commune aux routes POST
// /api/v1/{traiteur,agence,gestionnaire}/collectes/[id]/documents/[type]/regenerate.
//
// Qui : tout utilisateur qui peut télécharger le rapport (§12 §1.2, décision Val
// 2026-10-02 ; gestionnaire compris, décision Val 2026-10-06). Le droit n'est pas
// retranscrit ici : la collecte puis le rapport sont lus SOUS L'IDENTITÉ du
// demandeur (RLS collectes, policy rr_select), comme le fait le téléchargement.
// Embargo H+24 jamais contourné : un rapport non encore disponible ne se régénère
// pas, et `disponible_a` n'est jamais écrit.
//
// Quoi : le corps choisit la version du rapport — `{ options: { benchmark } }`,
// avec ou sans le radar de comparaison au parc, et `benchmark_filters` (les
// filtres réglés dans la fiche). Sans corps, le dernier rendu est reproduit.
// Le radar est calculé sous l'identité du demandeur (construireRadarRapport) ;
// seule l'écriture (file de rendu, marquage du rapport, audit) passe en
// service-role : la policy rr_write_admin reste inchangée.

const TYPE_RAPPORT = 'rapport-recyclage-zd';
const RADAR_INDISPONIBLE =
  'La comparaison au parc n’est pas disponible pour cette collecte.';

const refus = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

export type VersionDemandee =
  | { version: VersionRapportRecyclage | undefined }
  | { refus: NextResponse };

/**
 * Lit dans le corps la version demandée du rapport de recyclage — commun aux
 * espaces clients et à l'Admin. Corps vide ou sans « options » = reproduction du
 * dernier rendu (`version` indéfinie).
 *
 * Le radar est toujours calculé par `construireRadarRapport` avec le client et
 * le contexte de l'appelant : mêmes chiffres que l'écran, même k-anonymat.
 *
 * `filtresParDefaut` sert l'Admin quand le corps ne porte pas de filtres (pas de
 * radar à l'écran) : il les fournit.
 */
export async function lireVersionDemandee(
  req: NextRequest,
  rls: ReturnType<typeof createSupabaseServerClient>,
  ctx: UserAuthContext,
  id: string,
  evenementLog: string,
  filtresParDefaut?: () => Promise<FiltresRadar>,
): Promise<VersionDemandee> {
  const texte = await req.text();
  let corps: unknown = null;
  if (texte.trim()) {
    try {
      corps = JSON.parse(texte);
    } catch {
      return { refus: refus('Requête invalide', 400) };
    }
  }
  if (corps == null) return { version: undefined };
  if (typeof corps !== 'object' || Array.isArray(corps)) {
    return { refus: refus('Requête invalide', 400) };
  }
  const { options, benchmark_filters } = corps as {
    options?: unknown;
    benchmark_filters?: unknown;
  };
  if (options === undefined) return { version: undefined };
  const choix =
    options != null && typeof options === 'object'
      ? (options as { benchmark?: unknown }).benchmark
      : undefined;
  if (typeof choix !== 'boolean') {
    return { refus: refus('Option du rapport invalide', 422) };
  }
  if (!choix) return { version: { avecRadar: false } };

  let filtres: FiltresRadar | null;
  if (benchmark_filters === undefined && filtresParDefaut) {
    try {
      filtres = await filtresParDefaut();
    } catch (e) {
      return { refus: serverError(e, evenementLog) };
    }
  } else {
    filtres = lireFiltresRadar(benchmark_filters);
  }
  if (!filtres) {
    return { refus: refus('Filtres de comparaison invalides', 422) };
  }
  const r = await construireRadarRapport(rls, ctx, id, filtres);
  switch (r.etat) {
    case 'ok':
      // Aucun flux rapporté au nombre de convives (pax absent ou nul) : rien à
      // comparer. On le dit, plutôt que de rendre un rapport sans le radar demandé.
      if (!r.radar.benchmark_flux.some((g) => g.collecte_kg_pax != null)) {
        return { refus: refus(RADAR_INDISPONIBLE, 422) };
      }
      return { version: { avecRadar: true, radar: r.radar } };
    case 'sans_radar':
      return { refus: refus(RADAR_INDISPONIBLE, 422) };
    case 'introuvable':
      return { refus: refus('Collecte introuvable', 404) };
    case 'filtre_interdit':
      return { refus: reponseFiltreInterdit(r.motif) };
    case 'erreur':
      return { refus: serverError(r.erreur, evenementLog) };
  }
}

export async function repondreRegenerationRapport(
  req: NextRequest,
  id: string,
  type: string,
  ctx: UserAuthContext,
  evenementLog: string,
): Promise<NextResponse> {
  // Seul le rapport de recyclage ZD se régénère côté client. Le bordereau ZD
  // (§12 §1.1) et les documents AG (§12 §1.3) restent réservés à l'Admin Savr.
  if (type !== TYPE_RAPPORT) {
    return refus(
      'Régénération réservée à l’Admin Savr pour ce type de document (bordereau / attestation).',
      403,
    );
  }

  const rls = createSupabaseServerClient();
  const { data: collecte, error: collecteErr } = await rls
    .from('collectes')
    .select('id, type')
    .eq('id', id)
    .maybeSingle();
  if (collecteErr) return serverError(collecteErr, evenementLog);

  const admin = createAdminSupabaseClient();
  if (!collecte) {
    // Distinguer hors périmètre (existe → 403) d'un identifiant inconnu (→ 404).
    const { data: existe } = await admin
      .from('collectes')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    return existe
      ? refus('Accès refusé', 403)
      : refus('Collecte introuvable', 404);
  }
  // Une collecte AG n'a pas de rapport de recyclage : sans cette garde, le type
  // de l'URL ferait rendre un gabarit ZD sur la ligne d'un rapport AG.
  if ((collecte as { type: string }).type !== 'zero_dechet') {
    return refus(
      'Régénération réservée à l’Admin Savr pour ce type de document (bordereau / attestation).',
      403,
    );
  }

  // Le rapport, lu sous la policy rr_select : celui que le demandeur télécharge.
  const { data: rapport, error: rapportErr } = await rls
    .from('rapports_rse')
    .select('id, disponible_a, genere_at')
    .eq('collecte_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rapportErr) return serverError(rapportErr, evenementLog);
  if (!rapport) return refus('Rapport introuvable', 404);
  const { disponible_a, genere_at } = rapport as {
    disponible_a: string;
    genere_at: string | null;
  };
  if (Date.now() < new Date(disponible_a).getTime()) {
    return NextResponse.json(
      { error: 'Rapport sous embargo H+24', disponible_a },
      { status: 425 },
    );
  }
  if (!genere_at) {
    return refus('Document non encore généré — régénération impossible', 409);
  }

  const lu = await lireVersionDemandee(req, rls, ctx, id, evenementLog);
  if ('refus' in lu) return lu.refus;
  const version = lu.version;

  const result = await regenerateCollecteDocument(
    admin,
    id,
    type,
    { userId: ctx.userId, role: ctx.role },
    version,
  );

  if (!result.ok) {
    const status =
      result.code === 'UNKNOWN_TYPE'
        ? 422
        : result.code === 'NO_DOCUMENT' || result.code === 'NO_PRIOR_JOB'
          ? 409
          : 500;
    return refus(result.message, status);
  }

  // 202 Accepted : le rendu est asynchrone (worker PDF).
  return NextResponse.json(
    { job_id: result.jobId, type: result.type },
    { status: 202 },
  );
}
