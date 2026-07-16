// Route health-check logistique (ops) — GET /api/health/logistique
// =============================================================================
// Sonde la connectivité des transporteurs logistiques configurés (référentiel
// `transporteurs`), un provider par `type_tms` distinct présent en base, via
// l'interface logistique_provider. Garde-fou 3 : aucune référence directe à un
// transporteur nommé ici — la factory route par type (donnée DB, jamais un
// littéral). Sonde read-only, sans effet de bord métier (le ping trace juste une
// ligne dans integrations_logs).
//
// Auth : header `x-internal-token == HEALTH_INTERNAL_TOKEN` (monitoring/CI) OU
// session `admin_savr`. Renvoie 200 si tous les providers sont
// ok/non_applicable, 503 sinon.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import {
  getLogistiqueProvider,
  type HealthCheckResult,
  type Transporteur,
  type TypeTms,
} from '@savr/adapters/src/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Seul admin_savr existe côté Plateforme (ops_savr = rôle TMS/V2, cf. §09).
const ALLOWED_ROLES = ['admin_savr'];

function parseJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    return JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const internalToken = req.headers.get('x-internal-token');
  const expected = process.env.HEALTH_INTERNAL_TOKEN;
  if (expected && internalToken === expected) return true;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  // Le rôle métier vit dans le claim `user_role` (JWT hook fn_custom_access_token),
  // pas dans le claim réservé `role` (= authenticated).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const role = parseJwtClaims(session?.access_token ?? '')['user_role'] as
    | string
    | undefined;
  return !!role && ALLOWED_ROLES.includes(role);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const supabase = createAdminSupabaseClient();

  const { data: transporteurs, error } = await supabase
    .from('transporteurs')
    .select('id, type_tms, prestataire_logistique_id');

  if (error) {
    return NextResponse.json(
      { status: 'ko', erreur: `lecture transporteurs : ${error.message}` },
      { status: 503 },
    );
  }
  if (!transporteurs?.length) {
    return NextResponse.json(
      {
        status: 'ko',
        erreur: 'Aucun transporteur configuré — rien à sonder.',
        providers: [],
        ts: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  // Un provider par type_tms distinct : la config est globale (env), pas
  // par-transporteur → on évite les sondes redondantes.
  const parType = new Map<string, Transporteur>();
  for (const t of transporteurs) {
    const type = t.type_tms as string;
    if (!parType.has(type)) {
      parType.set(type, {
        id: t.id as string,
        type_tms: t.type_tms as TypeTms,
        prestataire_logistique_id: t.prestataire_logistique_id as string,
      });
    }
  }

  const providers: Array<{ type_tms: string } & HealthCheckResult> = [];
  for (const [type, transporteur] of parType) {
    let result: HealthCheckResult;
    try {
      result = await getLogistiqueProvider(
        transporteur,
        supabase,
      ).healthCheck();
    } catch (err) {
      // healthCheck ne devrait jamais lever, mais on reste fail-safe.
      result = { ok: false, etat: 'ko', message: String(err) };
    }
    providers.push({ type_tms: type, ...result });
  }

  const allOk = providers.every((p) => p.ok);
  return NextResponse.json(
    { status: allOk ? 'ok' : 'ko', providers, ts: new Date().toISOString() },
    { status: allOk ? 200 : 503 },
  );
}
