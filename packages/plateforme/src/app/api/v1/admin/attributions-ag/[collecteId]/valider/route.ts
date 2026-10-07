import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
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
  // Besoin véhicule saisi dans le même formulaire (décision Val 2026-10-01) :
  // écrit AVANT la validation, qui émet l'event de dispatch — le worker lit la
  // collecte à la consommation, les deux valeurs partent donc au prestataire
  // (N commandes MTS-1 ; type + nombre dans le canal libre des deux adapters).
  nb_camions_demande?: number;
  type_vehicule_souhaite?: string | null;
}

// Valeurs de l'enum plateforme.type_vehicule (lieux.type_vehicule_max, tournees.type_vehicule).
const TYPES_VEHICULE = [
  'velo_cargo',
  'camionnette',
  'fourgon',
  'vul',
  'poids_lourd',
] as const;

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
  if (
    nbCamions !== undefined &&
    (!Number.isInteger(nbCamions) || nbCamions < 1 || nbCamions > 20)
  ) {
    return NextResponse.json(
      { error: 'nb_camions_demande doit être un entier entre 1 et 20' },
      { status: 422 },
    );
  }
  const typeVehicule = body.type_vehicule_souhaite;
  if (
    typeVehicule !== undefined &&
    typeVehicule !== null &&
    !(TYPES_VEHICULE as readonly string[]).includes(typeVehicule)
  ) {
    return NextResponse.json(
      {
        error: `type_vehicule_souhaite invalide (attendu : ${TYPES_VEHICULE.join(', ')})`,
      },
      { status: 422 },
    );
  }

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
    // Le nombre passe par fn_modifier_collecte (gardes RM-02/RM-05, E2 si une
    // commande existait déjà).
    if (nbCamions !== undefined) {
      const { error: errNb } = await supabase.rpc('fn_modifier_collecte', {
        p_id: collecteId,
        p_updates: { nb_camions_demande: nbCamions },
        p_champs_modifies: ['nb_camions_demande'],
      });
      if (errNb) {
        const msg = errNb.message ?? '';
        if (msg.includes('NB_CAMIONS_STATUT_TERMINAL')) {
          return NextResponse.json(
            {
              error:
                'Le nombre de véhicules n’est plus modifiable (statut terminal)',
            },
            { status: 409 },
          );
        }
        if (msg.includes('NB_CAMIONS_INVALIDE')) {
          return NextResponse.json(
            { error: 'nb_camions_demande doit être un entier >= 1' },
            { status: 422 },
          );
        }
        if (msg.includes('REDUCTION_CANCEL_WINDOW_CLOSED')) {
          return NextResponse.json(
            {
              error:
                'Réduction du nombre de véhicules impossible à moins d’1h de la mission',
            },
            { status: 409 },
          );
        }
        return serverError(errNb, 'admin.attributions_ag.valider.nb_camions');
      }
    }
    // Le type est une colonne sans règle de transition : UPDATE borné. Colonne
    // absente (migration 20261001213000 pas encore appliquée : 42703 / PGRST204)
    // → la validation continue sans le type, tracé en warn, jamais un 500.
    if (typeVehicule !== undefined) {
      const { error: errType } = await supabase
        .from('collectes')
        .update({ type_vehicule_souhaite: typeVehicule })
        .eq('id', collecteId)
        .eq('type', 'anti_gaspi')
        .eq('statut', 'programmee');
      if (errType) {
        if (errType.code === '42703' || errType.code === 'PGRST204') {
          logger.warn('attribution.type_vehicule_colonne_absente', {
            collecte_id: collecteId,
            error_code: errType.code,
          });
        } else {
          return serverError(
            errType,
            'admin.attributions_ag.valider.type_vehicule',
          );
        }
      }
    }
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
