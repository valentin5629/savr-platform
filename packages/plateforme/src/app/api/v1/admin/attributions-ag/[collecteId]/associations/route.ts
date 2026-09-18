import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { withApiTrace, serverError } from '@/lib/api-helpers.js';
import {
  trierAssociationsParDistance,
  type AssociationCandidate,
} from '@/lib/attribution-ag/associations-par-distance.js';

// GET /api/v1/admin/attributions-ag/[collecteId]/associations
// Toutes les associations actives, triées par distance croissante au lieu de la
// collecte AG (liste déroulante de l'écran d'attribution, décision Val 2026-09-17).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ collecteId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { collecteId } = await params;
  // Identifiant non-UUID : 404 direct (sinon Postgres 22P02 → 500 générique).
  if (!UUID_RE.test(collecteId)) {
    return NextResponse.json(
      { error: 'Collecte AG introuvable' },
      { status: 404 },
    );
  }
  const supabase = createAdminSupabaseClient();

  // collecte → événement → lieu : FK sortantes = embeds to-one (OBJETS).
  const { data: collecte, error: colErr } = await supabase
    .from('collectes')
    .select('id, evenements!inner(lieux!lieu_id(latitude, longitude))')
    .eq('id', collecteId)
    .eq('type', 'anti_gaspi')
    .maybeSingle();
  if (colErr)
    return serverError(colErr, 'admin.attributions_ag.associations.collecte');
  if (!collecte) {
    return NextResponse.json(
      { error: 'Collecte AG introuvable' },
      { status: 404 },
    );
  }
  const lieu = (
    collecte as unknown as {
      evenements: {
        lieux: { latitude: number | null; longitude: number | null } | null;
      };
    }
  ).evenements.lieux ?? { latitude: null, longitude: null };

  const { data: assos, error: assoErr } = await supabase
    .from('associations')
    .select(
      'id, nom, ville, region, capacite_max_beneficiaires, habilitee_attestation_fiscale, latitude, longitude',
    )
    .eq('actif', true)
    // Borne explicite (référentiel de quelques dizaines/centaines de lignes) :
    // au-delà, PostgREST tronquerait en silence à max_rows (1000).
    .limit(2000);
  if (assoErr)
    return serverError(assoErr, 'admin.attributions_ag.associations.list');

  return NextResponse.json({
    data: trierAssociationsParDistance(
      lieu,
      (assos ?? []) as AssociationCandidate[],
    ),
  });
}

export const GET = withApiTrace(getHandler);
