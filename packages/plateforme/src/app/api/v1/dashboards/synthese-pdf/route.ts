import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { logger } from '@savr/shared/src/logger/index.js';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { generatePdf } from '@/lib/pdf/railway-client.js';
import { uploadPdf, getPresignedUrl } from '@/lib/pdf/r2-client.js';
import { logoKeyToDataUri } from '@/lib/pdf/logo-inline.js';
import {
  buildSyntheseSnapshot,
  type SyntheseParams,
  type SyntheseRole,
} from '@/lib/dashboards/synthese-snapshot.js';

/**
 * POST /api/v1/dashboards/synthese-pdf — Rapport de synthèse agrégé §12 §1.6
 * (Bloc 8 « Exporter une synthèse PDF », §06.04 / §06.05 / §06.11).
 *
 * Génération SYNCHRONE (décision Val 2026-07-07) : la route assemble le snapshot
 * SOUS LE JWT DU DEMANDEUR (RLS f_collecte_visible → 0 fuite inter-organisation),
 * appelle le renderer Railway (type_document 'synthese-dashboard'), dépose le PDF
 * dans un objet R2 ÉPHÉMÈRE (préfixe synthese/, aucune ligne DB — pas de jobs_pdf,
 * pas de shared.fichiers, table rapports_synthese supprimée) et renvoie une URL
 * pré-signée valable 1h. Régénération libre, aucun archivage (§1.6 l.251/273/328).
 *
 * Le canal « Edge Function + Supabase Storage » du CDC est le pipeline Railway + R2
 * de l'archi V1 (CLAUDE.md §2) — cf. _Divergences M3.5_20260707_canal-synthese.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // §1.6 : 5-30 s nominal, borne dure 2 min.

const ALLOWED_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
] as const;

const PRESIGN_TTL_SECONDS = 3600; // 1h (§1.6 l.271).

const ROUTE = '/api/v1/dashboards/synthese-pdf';
const MESSAGE_ECHEC = 'La génération a échoué. Réessayez.';

// generatePdf lève « Railway PDF <status>: <corps> » ; le renderer répond
// {error, ref} (apps/pdf-renderer). On n'en extrait QUE la ref au format UUID —
// jamais le reste du corps, quelle que soit la version du renderer déployée.
const RAILWAY_ERROR_PREFIX = /^Railway PDF \d{3}: /;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function railwayRef(message: string): string | null {
  if (!RAILWAY_ERROR_PREFIX.test(message)) return null;
  try {
    const body = JSON.parse(message.replace(RAILWAY_ERROR_PREFIX, '')) as {
      ref?: unknown;
    };
    return typeof body.ref === 'string' && UUID_RE.test(body.ref)
      ? body.ref
      : null;
  } catch {
    return null;
  }
}

/**
 * Échec interne → message générique au client, détail en log serveur
 * (`api_route.error`, §07/02). Le message brut peut porter un détail PostgREST
 * (tables/colonnes), un nom de variable d'env (railway-client) ou une erreur du
 * SDK R2 : il ne quitte jamais le serveur. Seule la ref Railway (UUID) est
 * renvoyée, pour retrouver la trace du renderer côté support.
 */
function echec(
  err: unknown,
  error_code: 'synthese_agregation_failed' | 'synthese_rendu_failed',
  status: 500 | 502,
  ctx: { userId: string; role: string; organisationId: string },
): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  const ref = railwayRef(message);
  logger.error(
    'api_route.error',
    { route: ROUTE, error_code, message, ...(ref ? { ref } : {}) },
    {
      actor_id: ctx.userId,
      actor_role: ctx.role,
      org_id: ctx.organisationId,
    },
  );
  return NextResponse.json(
    ref ? { error: MESSAGE_ECHEC, ref } : { error: MESSAGE_ECHEC },
    { status },
  );
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Horodatage de génération FR (DD/MM/YYYY HH:MM), indépendant de la locale serveur.
function frDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

  const role = auth.ctx.role as SyntheseRole;
  const supabase = createSupabaseServerClient();

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const rawTypes = asStringArray(body['types']).filter(
    (t) => t === 'zero_dechet' || t === 'anti_gaspi',
  ) as ('zero_dechet' | 'anti_gaspi')[];
  // Borne future interdite (§1.6) : clamp `to` à aujourd'hui.
  const today = todayIso();
  const toRaw = typeof body['to'] === 'string' ? (body['to'] as string) : null;
  const to = toRaw && toRaw > today ? today : toRaw;

  const params: SyntheseParams = {
    from: typeof body['from'] === 'string' ? (body['from'] as string) : null,
    to,
    types: rawTypes,
    lieuIds: asStringArray(body['lieu_ids']),
    traiteurIds: asStringArray(body['traiteur_ids']),
    clientOrgaIds: asStringArray(body['client_organisateur_ids']),
    commercialIds: asStringArray(body['commercial_ids']),
    typeEvtIds: asStringArray(body['type_evenement_ids']),
    tailleEvts: asStringArray(body['taille_evenements']),
  };

  // Nom + logo de l'organisation courante (page de garde). RLS organisations = self
  // → aucune fuite inter-org. Le logo (§12 §1.6 l.283, branding agence prioritaire
  // l.86-90/l.249) est celui de l'org demandeuse elle-même (l'agence pour une synthèse
  // agence). BL-P3-05 : inliné en data URI (le renderer ne présigne pas).
  const { data: org } = await supabase
    .from('organisations')
    .select('nom, logo_url')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();
  const logoDataUri = await logoKeyToDataUri(
    (org?.logo_url as string | null) ?? null,
  );

  const now = new Date();
  const clock = {
    nowIso: now.toISOString(),
    cutoffIso: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    dateGenerationLabel: frDateTime(now),
  };

  let snapshot;
  try {
    snapshot = await buildSyntheseSnapshot(
      supabase,
      {
        role,
        organisationId: auth.ctx.organisationId,
        organisationNom: (org?.nom as string) ?? '—',
      },
      params,
      clock,
    );
  } catch (err) {
    return echec(err, 'synthese_agregation_failed', 500, auth.ctx);
  }

  // Rendu Railway + dépôt R2 éphémère + URL pré-signée.
  try {
    const { pdfBuffer } = await generatePdf('synthese-dashboard', {
      ...(snapshot as unknown as Record<string, unknown>),
      logo_data_uri: logoDataUri,
    });
    const key = `synthese/${auth.ctx.organisationId}/${randomUUID()}.pdf`;
    const storageKey = await uploadPdf('rapports', key, pdfBuffer);
    const url = await getPresignedUrl(storageKey, PRESIGN_TTL_SECONDS);
    return NextResponse.json({ url, expires_in: PRESIGN_TTL_SECONDS });
  } catch (err) {
    return echec(err, 'synthese_rendu_failed', 502, auth.ctx);
  }
}
