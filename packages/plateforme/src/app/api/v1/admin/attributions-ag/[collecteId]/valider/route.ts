import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';
import { validerAttributionAg } from '@/lib/attribution-ag/validation.js';

interface ValiderBody {
  association_id: string;
  transporteur_id: string;
  branche_attribution: string;
  mode_validation: 'manuel_top1' | 'manuel_override' | 'auto_accept';
  motif_override?: string;
  motif_override_libre?: string;
}

// POST /api/v1/admin/attributions-ag/[collecteId]/valider
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ collecteId: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { collecteId } = await params;

  let body: ValiderBody;
  try {
    body = (await req.json()) as ValiderBody;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const {
    association_id,
    transporteur_id,
    branche_attribution,
    mode_validation,
  } = body;
  if (
    !association_id ||
    !transporteur_id ||
    !branche_attribution ||
    !mode_validation
  ) {
    return NextResponse.json(
      {
        error:
          'association_id, transporteur_id, branche_attribution, mode_validation obligatoires',
      },
      { status: 422 },
    );
  }
  if (mode_validation === 'manuel_override' && !body.motif_override) {
    return NextResponse.json(
      { error: 'motif_override obligatoire en mode override' },
      { status: 422 },
    );
  }

  try {
    const result = await validerAttributionAg({
      collecteId,
      associationId: association_id,
      transporteurId: transporteur_id,
      brancheAttribution: branche_attribution,
      modeValidation: mode_validation,
      validePar: auth.ctx.userId,
      motifOverride: body.motif_override,
      motifOverrideLibre: body.motif_override_libre,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === 'DUPLICATE')
      return NextResponse.json({ error: error.message }, { status: 409 });
    if (error.code === 'INVALID_STATUS' || error.code === 'MISSING_MOTIF')
      return NextResponse.json({ error: error.message }, { status: 422 });
    return NextResponse.json(
      { error: error.message ?? 'Erreur interne' },
      { status: 500 },
    );
  }
}
