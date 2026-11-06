import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  lireFiltresGlobaux,
  loadKpiCollectes,
} from '@/lib/dashboards/kpi-collectes.js';

/**
 * GET /api/v1/dashboards/kpi-client-organisateur — cadrans du dashboard client
 * organisateur (§11 §7), lignes mensuelles par type de collecte.
 *
 * Calculées depuis les collectes dont l'organisation est le client organisateur
 * rattaché, filtres de la barre globale appliqués (Lieux, Traiteurs, Type et
 * Taille d'événement, décision Val du 2026-10-30). Sans `type` : les deux types
 * (bandeau YTD). Paramètres : from, to, type, lieu_ids[], traiteur_ids[],
 * type_evenement_ids[], taille_evenements[].
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ['client_organisateur']);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type');

  try {
    const { data } = await loadKpiCollectes(supabase, auth.ctx, {
      from: sp.get('from'),
      to: sp.get('to'),
      type: type === 'zero_dechet' || type === 'anti_gaspi' ? type : null,
      filtres: { ...lireFiltresGlobaux(sp), clientNoms: [] },
    });
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (e) {
    return serverError(e, 'dashboards.kpi_client_organisateur.list');
  }
}
