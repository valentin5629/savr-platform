import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';
import { withApiTrace, businessError, serverError } from '@/lib/api-helpers.js';
import {
  validerAttributionAg,
  logAttributionAucuneReco,
} from '@/lib/attribution-ag/validation.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import {
  ecrireBesoinVehicule,
  refusBesoinVehicule,
} from '@/lib/collectes/besoin-vehicule.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche, la moitié du bail de réservation des ordres. Elle ne borne pas
// seule la durée de vie du passage (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

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
  // Besoin véhicule saisi dans le même formulaire (décision Val 2026-10-01) :
  // écrit AVANT la validation, qui émet l'event de dispatch — le worker lit la
  // collecte à la consommation, les deux valeurs partent donc au prestataire
  // (N commandes MTS-1 ; type + nombre dans le canal libre des deux adapters).
  nb_camions_demande?: number;
  type_vehicule_souhaite?: string | null;
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

  const nbCamions = body.nb_camions_demande;
  const typeVehicule = body.type_vehicule_souhaite;
  const refusBesoin = refusBesoinVehicule(body);
  if (refusBesoin) return refusBesoin;

  // Besoin véhicule : posé avant l'event de dispatch (émis par la RPC ci-dessous).
  // Les écritures précèdent les gardes de la RPC (P0042/P0043/P0044) et ne sont
  // pas dans sa transaction : on rejoue donc ces gardes AVANT d'écrire — collecte
  // AG encore `programmee`, aucune attribution existante — sinon 404/422/409 ici
  // et rien n'est écrit. L'UPDATE du type reste en plus borné par le WHERE.
  if (nbCamions !== undefined || typeVehicule !== undefined) {
    const supabase = createAdminSupabaseClient();
    const { data: etat, error: errEtat } = await supabase
      .from('collectes')
      .select('type, statut')
      .eq('id', collecteId)
      .single();
    if (errEtat?.code === 'PGRST116' || (!etat && !errEtat)) {
      return NextResponse.json(
        { error: 'Collecte introuvable' },
        { status: 404 },
      );
    }
    if (errEtat) {
      return serverError(errEtat, 'admin.attributions_ag.valider.collecte');
    }
    const c = etat as { type: string; statut: string };
    if (c.type !== 'anti_gaspi' || c.statut !== 'programmee') {
      return NextResponse.json(
        {
          error: `Attribution impossible : collecte ${c.type === 'anti_gaspi' ? `au statut '${c.statut}'` : 'non Anti-Gaspi'} (attendu : Anti-Gaspi programmée)`,
        },
        { status: 422 },
      );
    }
    const { data: existante, error: errExistante } = await supabase
      .from('attributions_antgaspi')
      .select('id')
      .eq('collecte_id', collecteId)
      .maybeSingle();
    if (errExistante) {
      return serverError(
        errExistante,
        'admin.attributions_ag.valider.attribution',
      );
    }
    if (existante) {
      return NextResponse.json(
        { error: 'Attribution déjà existante' },
        { status: 409 },
      );
    }
    const refusEcriture = await ecrireBesoinVehicule(
      supabase,
      collecteId,
      { nb_camions_demande: nbCamions, type_vehicule_souhaite: typeVehicule },
      { statuts: ['programmee'], type: 'anti_gaspi' },
      'admin.attributions_ag.valider',
    );
    if (refusEcriture) return refusEcriture;
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
    // La validation a mis l'ordre de dispatch en file : il part vers le
    // prestataire sans attendre le passage planifié (décision Val 2026-10-12).
    envoyerOrdresSansAttendre(collecteId);
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
