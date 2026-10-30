import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { validerLieuOverrides } from '@/lib/programmation/lieu-override.js';
import { typedRpcError } from '@/lib/api-helpers.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';
import { validerCartes } from '@/lib/programmation/cartes.js';
import { verifierPerimetreProgrammation } from '@/lib/programmation/perimetre-programmation.js';
import { apresConfirmation } from '@/lib/programmation/apres-confirmation.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

// Rôles dont le périmètre d'écriture sur un brouillon est leur propre création
// (§06.01 Sauvegarde brouillon, matrice §09) ; le traiteur manager et le
// commercial (Val 2026-10-30) écrivent sur les brouillons de leur organisation.
// Miroir de la suppression d'un brouillon.
const ROLES_PROPRIETAIRE: string[] = ['agence', 'gestionnaire_lieux'];

interface RepriseBody {
  nom_evenement?: string;
  nom_client_organisateur?: string;
  reference_affaire?: string;
  logo_client_organisateur_url?: string;
  lieu_id: string;
  lieu_overrides?: Record<string, unknown>;
  controle_acces_requis: boolean;
  traiteur_operationnel_organisation_id?: string;
  collectes: unknown;
  confirmer: boolean;
}

/**
 * Reprise d'un brouillon dans le formulaire complet (décision Val 2026-10-24,
 * B2-Q2) : le formulaire renvoie l'événement et toutes ses cartes ; les
 * collectes du brouillon sont remplacées en une transaction
 * (fn_enregistrer_programmation), et confirmées si `confirmer`. Mêmes
 * validations et mêmes gardes de périmètre que la création. Route d'ITEM :
 * l'organisation se lit sur l'événement, jamais sur le JWT (staff en support).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const body = (await req.json()) as RepriseBody;
  const supabase = createAdminSupabaseClient();

  const evtQuery = supabase
    .from('evenements')
    .select(
      'id, organisation_id, created_by, traiteur_operationnel_organisation_id, collectes(statut)',
    )
    .eq('id', evenementId);
  const { data: evt } = await (
    auth.ctx.isAdmin
      ? evtQuery
      : evtQuery.eq('organisation_id', auth.ctx.organisationId)
  ).single();
  if (!evt) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }
  if (
    ROLES_PROPRIETAIRE.includes(auth.ctx.role ?? '') &&
    evt.created_by !== auth.ctx.userId
  ) {
    return NextResponse.json(
      { error: 'Modification du brouillon non autorisée' },
      { status: 403 },
    );
  }
  const statuts = (evt.collectes ?? []) as { statut: string }[];
  if (statuts.length === 0 || statuts.some((c) => c.statut !== 'brouillon')) {
    return NextResponse.json(
      { error: "Cet événement n'est pas un brouillon." },
      { status: 422 },
    );
  }

  if (!body.lieu_id) {
    return NextResponse.json(
      { error: 'Champs obligatoires : lieu_id, collectes' },
      { status: 422 },
    );
  }
  if (
    body.confirmer &&
    (typeof body.nom_evenement !== 'string' || !body.nom_evenement.trim())
  ) {
    return NextResponse.json(
      {
        error: "Nom de l'événement obligatoire pour confirmer la programmation",
      },
      { status: 422 },
    );
  }
  const overridesValides = validerLieuOverrides(body.lieu_overrides);
  if ('error' in overridesValides) return overridesValides.error;
  const lieuOverrides = overridesValides.overrides;
  const hasOverride = !!(
    lieuOverrides && Object.keys(lieuOverrides).length > 0
  );

  const cartesValides = await validerCartes(supabase, body.collectes, {
    plafond: true,
  });
  if ('error' in cartesValides) return cartesValides.error;
  const { cartes } = cartesValides;

  // Traiteur opérant : celui du corps (agence, gestionnaire) ; absent, celui
  // du brouillon, jamais l'organisation programmatrice par défaut (l'équipe
  // Savr qui reprend le brouillon d'une agence ne le change pas). Revalidé par
  // les gardes de périmètre comme à la création.
  const perimetre = await verifierPerimetreProgrammation(supabase, auth.ctx, {
    effectiveOrgId: evt.organisation_id,
    lieuId: body.lieu_id,
    traiteurDemande:
      body.traiteur_operationnel_organisation_id ??
      evt.traiteur_operationnel_organisation_id ??
      undefined,
  });
  if ('error' in perimetre) return perimetre.error;

  // Débit des écritures clientes (cf. lib/frein-ecritures-client).
  const frein = freinerEcritureCliente({
    organisationId: evt.organisation_id,
    equipeSavr: auth.ctx.isAdmin,
  });
  if (frein) return frein;

  const { data: resultat, error: rpcErr } = await supabase.rpc(
    'fn_enregistrer_programmation',
    {
      p_evenement_id: evenementId,
      p_evenement: {
        traiteur_operationnel_organisation_id: perimetre.traiteurOperationnelId,
        lieu_id: body.lieu_id,
        nom_evenement: body.nom_evenement ?? null,
        nom_client_organisateur: body.nom_client_organisateur ?? null,
        logo_client_organisateur_url: body.logo_client_organisateur_url ?? null,
        reference_affaire: body.reference_affaire ?? null,
        controle_acces_requis: body.controle_acces_requis === true,
        lieu_overrides: hasOverride ? lieuOverrides : null,
      },
      p_collectes: cartes,
      p_confirmer: body.confirmer === true,
    },
  );
  if (rpcErr) {
    return typedRpcError(rpcErr, 'programmation.evenements.brouillon', {
      message422: "Cet événement n'est plus un brouillon.",
      message404: 'Événement introuvable',
    });
  }
  const { collecte_ids: collecteIds } = resultat as {
    evenement_id: string;
    collecte_ids: string[];
  };

  if (body.confirmer) {
    // Ordres de création traités sans attendre le passage planifié (décision
    // Val 2026-10-12).
    envoyerOrdresSansAttendre(collecteIds);

    await apresConfirmation(supabase, req, {
      ctx: auth.ctx,
      evenementId,
      nomEvenement: body.nom_evenement ?? null,
      organisationId: evt.organisation_id,
      lieuId: body.lieu_id,
      collectes: collecteIds.map((id, rang) => ({
        id,
        type: cartes[rang]!.type,
      })),
      lieuOverrides: hasOverride ? lieuOverrides : null,
    });
  }

  return NextResponse.json({
    evenement_id: evenementId,
    collecte_ids: collecteIds,
  });
}
