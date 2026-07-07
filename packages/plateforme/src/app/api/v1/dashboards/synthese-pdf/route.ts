import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { generatePdf } from '@/lib/pdf/railway-client.js';
import { uploadPdf, getPresignedUrl } from '@/lib/pdf/r2-client.js';
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

  // Nom de l'organisation courante (page de garde). RLS organisations = self.
  const { data: org } = await supabase
    .from('organisations')
    .select('nom')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();

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
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Erreur agrégation synthèse',
      },
      { status: 500 },
    );
  }

  // Rendu Railway + dépôt R2 éphémère + URL pré-signée.
  try {
    const { pdfBuffer } = await generatePdf(
      'synthese-dashboard',
      snapshot as unknown as Record<string, unknown>,
    );
    const key = `synthese/${auth.ctx.organisationId}/${randomUUID()}.pdf`;
    const storageKey = await uploadPdf('rapports', key, pdfBuffer);
    const url = await getPresignedUrl(storageKey, PRESIGN_TTL_SECONDS);
    return NextResponse.json({ url, expires_in: PRESIGN_TTL_SECONDS });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Erreur génération PDF synthèse',
      },
      { status: 502 },
    );
  }
}
