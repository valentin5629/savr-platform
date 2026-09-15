import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';
import { withApiTrace, businessError, serverError } from '@/lib/api-helpers.js';
import {
  validerAttributionAg,
  logAttributionAucuneReco,
} from '@/lib/attribution-ag/validation.js';

interface ValiderBody {
  association_id: string;
  transporteur_id: string;
  branche_attribution: string;
  mode_validation: 'manuel_top1' | 'manuel_override' | 'auto_accept';
  motif_override?: string;
  motif_override_libre?: string;
  // BL-P1-ALGO-03 — true quand l'Admin valide via recherche libre faute de
  // recommandation association (algo no_asso) → audit attribution_manuelle_aucune_reco.
  aucune_reco?: boolean;
}

// POST /api/v1/admin/attributions-ag/[collecteId]/valider
async function postHandler(
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
    // BL-P1-ALGO-03 — audit aucune-reco (best-effort, hors transaction de validation)
    if (body.aucune_reco === true) {
      await logAttributionAucuneReco(
        collecteId,
        result.attribution_id,
        auth.ctx.userId,
      );
    }
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    const error = err as Error & { code?: string };
    // Codes applicatifs levés par nos propres validations (lib/attribution-ag) :
    // message écrit par nous → conservé. Toute AUTRE erreur (dont une
    // PostgrestError remontée par ce même catch) retombe sur un message neutre.
    if (error.code === 'DUPLICATE')
      return businessError(
        error,
        'admin.attributions_ag.valider.duplicate',
        ['DUPLICATE'],
        409,
      );
    if (error.code === 'INVALID_STATUS' || error.code === 'MISSING_MOTIF')
      return businessError(
        error,
        'admin.attributions_ag.valider.create',
        ['INVALID_STATUS', 'MISSING_MOTIF'],
        422,
      );
    return serverError(error, 'admin.attributions_ag.valider.handler');
  }
}

export const POST = withApiTrace(postHandler);
