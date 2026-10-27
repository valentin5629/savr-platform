import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import {
  createSupabaseServerClient,
  type UserAuthContext,
} from '@/lib/api-auth.js';
import { messageErreur, serverError } from '@/lib/api-helpers.js';
import { reponseFiltreInterdit } from '@/lib/collectes/benchmark-fiche.js';
import { lireBordereauxVisibles } from '@/lib/pdf/bordereaux-visibles.js';
import { construirePayloadRapport } from '@/lib/pdf/payload-rapport.js';
import { generatePdf } from '@/lib/pdf/railway-client.js';
import {
  construireRadarRapport,
  lireFiltresRadar,
  type FiltresRadar,
  type RadarRapport,
  type RadarRapportResultat,
} from '@/lib/pdf/rapport-radar.js';

// Rapport de recyclage ZD fabriqué AU CLIC (décision Val 2026-10-16) : aucun
// rapport n'est plus fabriqué automatiquement ; l'utilisateur le télécharge
// depuis la plateforme et choisit à ce moment-là s'il porte le radar de
// comparaison. Chaque téléchargement fabrique SON rapport, selon le choix de
// celui qui clique : rien n'est stocké, personne n'écrase la version d'un autre.
//
// Routes : POST /api/v1/{traiteur,agence,gestionnaire,admin}/collectes/[id]/rapport-rse
// Corps   : { options: { benchmark: boolean }, benchmark_filters?: {…} } — sans
//           « options », le rapport sort sans radar.
// Réponse : le PDF lui-même (application/pdf, en pièce jointe).
//
// Accès client : la collecte puis le rapport sont lus SOUS L'IDENTITÉ du
// demandeur (RLS collectes, policy rr_select) — le droit est celui du
// téléchargement, il n'est pas retranscrit. Accès staff : lecture service-role.
// Dans les deux cas l'embargo H+24 (`rapports_rse.disponible_a`, posé par le batch
// J+1) n'est jamais contourné, et le radar est calculé par la fonction de l'écran
// sous l'identité de l'appelant : même k-anonymat pour l'Admin que pour un client,
// ce PDF part chez le client. Les données mesurées sont lues en service-role
// (construirePayloadRapport), une fois l'accès établi — sauf le numéro du
// bordereau, imprimé seulement si le demandeur lit ce bordereau sous sa RLS
// (décision Val 2026-10-27, cf. bordereaux-visibles).

const radarIndisponible = (sujet: string) =>
  `La comparaison au parc n’est pas disponible pour ${sujet}.`;
const PAS_ENCORE_DISPONIBLE = 'Le rapport n’est pas encore disponible.';
const FABRICATION_ECHEC =
  'La fabrication du rapport a échoué. Réessayez dans un instant.';

const refus = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

export type VersionRapport =
  | { avecRadar: false }
  | { avecRadar: true; radar: RadarRapport };

export type VersionDemandee =
  | { version: VersionRapport }
  | { refus: NextResponse };

/**
 * Lit dans le corps la version demandée. Corps vide ou sans « options » = sans
 * radar. Le radar est calculé par `construireRadar` avec le client et le
 * contexte de l'appelant (`construireRadarRapport` pour une collecte) : mêmes
 * chiffres que l'écran, même k-anonymat. `sujet` nomme ce qui est comparé dans
 * le refus (« cette collecte », « cet événement »).
 *
 * `filtresParDefaut` sert l'Admin quand le corps ne porte pas de filtres (pas de
 * radar affiché dans l'onglet) : il les fournit.
 */
export async function lireVersionDemandee(
  req: NextRequest,
  construireRadar: (filtres: FiltresRadar) => Promise<RadarRapportResultat>,
  evenementLog: string,
  filtresParDefaut?: () => Promise<FiltresRadar>,
  sujet = 'cette collecte',
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
  if (corps == null) return { version: { avecRadar: false } };
  if (typeof corps !== 'object' || Array.isArray(corps)) {
    return { refus: refus('Requête invalide', 400) };
  }
  const { options, benchmark_filters } = corps as {
    options?: unknown;
    benchmark_filters?: unknown;
  };
  if (options === undefined) return { version: { avecRadar: false } };
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
  const r = await construireRadar(filtres);
  switch (r.etat) {
    case 'ok':
      // Aucun flux rapporté au nombre de convives (pax absent ou nul) : rien à
      // comparer. On le dit, plutôt que de rendre un rapport sans le radar demandé.
      if (!r.radar.benchmark_flux.some((g) => g.collecte_kg_pax != null)) {
        return { refus: refus(radarIndisponible(sujet), 422) };
      }
      return { version: { avecRadar: true, radar: r.radar } };
    case 'sans_radar':
      return { refus: refus(radarIndisponible(sujet), 422) };
    case 'introuvable':
      return { refus: refus('Collecte introuvable', 404) };
    case 'filtre_interdit':
      return { refus: reponseFiltreInterdit(r.motif) };
    case 'erreur':
      return { refus: serverError(r.erreur, evenementLog) };
  }
}

/** « JJ/MM/AAAA » → « AAAA-MM-JJ » pour le nom du fichier (sinon la référence). */
function nomFichier(dateCollecte: unknown, id: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dateCollecte ?? ''));
  return `rapport-recyclage-${m ? `${m[3]}-${m[2]}-${m[1]}` : id.slice(0, 8)}.pdf`;
}

/**
 * Fabrique le PDF d'une collecte ZD dont l'accès est établi. `lecteur` = le
 * client sous l'identité du demandeur, qui dit si le numéro du bordereau
 * s'imprime ; 'staff' = l'équipe Savr, qui lit tous les bordereaux.
 */
export async function fabriquerRapport(
  id: string,
  version: VersionRapport,
  evenementLog: string,
  lecteur: ReturnType<typeof createSupabaseServerClient> | 'staff',
): Promise<NextResponse> {
  const admin = createAdminSupabaseClient();
  const [construit, visibles] = await Promise.all([
    construirePayloadRapport(admin, id),
    lecteur === 'staff' ? null : lireBordereauxVisibles(lecteur, [id]),
  ]);
  if (visibles && !visibles.ok)
    return serverError(visibles.erreur, evenementLog);
  if (!construit.ok) {
    return construit.code === 'DB_ERROR'
      ? serverError(construit.erreur, evenementLog)
      : refus(
          'Les données de la collecte sont incomplètes : le rapport ne peut pas être fabriqué.',
          409,
        );
  }
  const payload = construit.payload;
  if (visibles && !visibles.collectes.has(id)) {
    payload.bordereau = {
      ...(payload.bordereau as Record<string, unknown>),
      numero: '—',
    };
  }
  if (version.avecRadar) {
    payload.options = { benchmark: true };
    payload.benchmark_flux = version.radar.benchmark_flux;
    payload.benchmark_legende = version.radar.benchmark_legende;
  }

  let pdf: Buffer;
  try {
    pdf = (await generatePdf('rapport-recyclage-zd', payload)).pdfBuffer;
  } catch (e) {
    // Le message du client de rendu ne porte jamais le secret (railway-client).
    logger.error('pdf.rapport_a_la_demande.echec', {
      collecte_id: id,
      error: messageErreur(e),
    });
    return refus(FABRICATION_ECHEC, 502);
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename="${nomFichier(
        (payload.bordereau as { date_collecte?: unknown } | undefined)
          ?.date_collecte,
        id,
      )}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** Contrôles communs aux deux accès, une fois la collecte et le rapport lus. */
function controlerRapport(
  collecte: { type: string } | null,
  rapport: { disponible_a: string } | null,
): NextResponse | null {
  if (collecte && collecte.type !== 'zero_dechet') {
    return refus(
      'Le rapport de recyclage ne concerne que les collectes Zéro Déchet.',
      409,
    );
  }
  if (!rapport) return refus(PAS_ENCORE_DISPONIBLE, 404);
  if (Date.now() < new Date(rapport.disponible_a).getTime()) {
    return NextResponse.json(
      { error: PAS_ENCORE_DISPONIBLE, disponible_a: rapport.disponible_a },
      { status: 425 },
    );
  }
  return null;
}

/** Espaces clients (traiteur, agence, gestionnaire). */
export async function repondreRapportClient(
  req: NextRequest,
  id: string,
  ctx: UserAuthContext,
  evenementLog: string,
): Promise<NextResponse> {
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

  // Le rapport, lu sous la policy rr_select : celui que le demandeur peut lire.
  const { data: rapport, error: rapportErr } = await rls
    .from('rapports_rse')
    .select('id, disponible_a, consulte_par_user_at')
    .eq('collecte_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rapportErr) return serverError(rapportErr, evenementLog);
  const ligne = rapport as {
    id: string;
    disponible_a: string;
    consulte_par_user_at: string | null;
  } | null;
  const bloque = controlerRapport(collecte as { type: string }, ligne);
  if (bloque) return bloque;

  const lu = await lireVersionDemandee(
    req,
    (f) => construireRadarRapport(rls, ctx, id, f),
    evenementLog,
  );
  if ('refus' in lu) return lu.refus;

  const reponse = await fabriquerRapport(id, lu.version, evenementLog, rls);

  if (reponse.ok && ligne) {
    await marquerConsulte(ligne.id, ligne.consulte_par_user_at, evenementLog);
  }
  return reponse;
}

/**
 * Premier téléchargement par un client (espaces clients, client organisateur) :
 * l'équipe Savr le voit dans la liste Collectes (« Rapport consulté »). Jamais
 * réécrit, jamais posé par l'équipe Savr. Best-effort, jamais bloquant.
 */
export async function marquerConsulte(
  rapportId: string,
  dejaConsulte: string | null,
  evenementLog: string,
): Promise<void> {
  if (dejaConsulte) return;
  const { error } = await createAdminSupabaseClient()
    .from('rapports_rse')
    .update({ consulte_par_user_at: new Date().toISOString() })
    .eq('id', rapportId)
    .is('consulte_par_user_at', null);
  if (error) {
    logger.error('api_route.error', {
      route: `${evenementLog}.consultation`,
      error_code: error.code ?? 'UNKNOWN',
      error: messageErreur(error),
    });
  }
}

/** Fiche collecte Admin (staff). */
export async function repondreRapportStaff(
  req: NextRequest,
  id: string,
  ctx: UserAuthContext,
  evenementLog: string,
  filtresParDefaut: () => Promise<FiltresRadar>,
): Promise<NextResponse> {
  const admin = createAdminSupabaseClient();
  const [colRes, rapRes] = await Promise.all([
    admin.from('collectes').select('id, type').eq('id', id).maybeSingle(),
    admin
      .from('rapports_rse')
      .select('disponible_a')
      .eq('collecte_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (colRes.error) return serverError(colRes.error, evenementLog);
  if (rapRes.error) return serverError(rapRes.error, evenementLog);
  if (!colRes.data) return refus('Collecte introuvable', 404);
  const bloque = controlerRapport(
    colRes.data as { type: string },
    rapRes.data as { disponible_a: string } | null,
  );
  if (bloque) return bloque;

  const rls = createSupabaseServerClient();
  const lu = await lireVersionDemandee(
    req,
    (f) => construireRadarRapport(rls, ctx, id, f),
    evenementLog,
    filtresParDefaut,
  );
  if ('refus' in lu) return lu.refus;
  return fabriquerRapport(id, lu.version, evenementLog, 'staff');
}
