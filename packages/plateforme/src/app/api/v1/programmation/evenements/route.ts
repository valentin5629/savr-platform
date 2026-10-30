import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import {
  lireEntiteFacturation,
  requireCompletedOrganisation,
} from '@/lib/onboarding-guards.js';
import { validerLieuOverrides } from '@/lib/programmation/lieu-override.js';
import { serverError } from '@/lib/api-helpers.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';
import { validerCartes } from '@/lib/programmation/cartes.js';
import {
  clientFinalRenseigne,
  MESSAGE_CLIENT_FINAL_OBLIGATOIRE,
} from '@/lib/evenements/client-final.js';
import { verifierPerimetreProgrammation } from '@/lib/programmation/perimetre-programmation.js';
import { apresConfirmation } from '@/lib/programmation/apres-confirmation.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const statut = searchParams.get('statut'); // 'brouillon' pour la liste brouillons

  let query = supabase
    .from('evenements')
    .select(
      `id, nom_evenement, nom_client_organisateur, reference_affaire, created_at,
       collectes!inner(type, date_collecte, statut)`,
    )
    .order('created_at', { ascending: false })
    .limit(50);

  // Cloisonnement porté par ce prédicat (client service-role → pas de RLS) :
  //  • rôles clients → leur organisation, miroir de la policy evt_*_select ;
  //  • staff en mode support → ses PROPRES créations (décision Val 2026-07-17).
  // Le staff n'a pas d'org cliente — son JWT porte `org_savr` (org interne,
  // users.organisation_id NOT NULL) : en prédicat, il ne cloisonne rien, il masque
  // tout. `created_by` est le périmètre qui sert le parcours : cette liste n'est
  // dans aucune nav, on n'y atterrit que par redirection depuis « Enregistrer en
  // brouillon », donc pour y retrouver ce qu'on vient d'enregistrer.
  query = auth.ctx.isAdmin
    ? query.eq('created_by', auth.ctx.userId)
    : query.eq('organisation_id', auth.ctx.organisationId);

  if (statut === 'brouillon') {
    query = query.eq('collectes.statut', 'brouillon');
  }

  const { data, error } = await query;
  if (error) return serverError(error, 'programmation.evenements.list');

  return NextResponse.json({ data: data ?? [] });
}

// Programmation (refonte du formulaire, lot B2 ; décisions Val 2026-10-22 et
// 2026-10-24) : le niveau événement (nom, client final, référence interne,
// lieu, contrôle d'accès, traiteur opérant) et une carte par collecte, chacune
// avec sa date, son heure, ses convives, son type d'événement, ses contacts et
// ses informations supplémentaires (cf. lib/programmation/cartes).
interface ProgrammationBody {
  nom_evenement?: string;
  nom_client_organisateur?: string;
  reference_affaire?: string;
  logo_client_organisateur_url?: string;
  lieu_id: string;
  lieu_overrides?: Record<string, unknown>;
  controle_acces_requis: boolean;
  // Rôles agence/gestionnaire et staff
  traiteur_operationnel_organisation_id?: string;
  // Admin support : organisation cible
  organisation_id?: string;
  collectes: unknown;
  confirmer: boolean; // true = programmee, false = brouillon
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as ProgrammationBody;

  // admin_savr/ops_savr programme POUR le compte d'une org → l'org cible vient
  // TOUJOURS du body (jamais du JWT du staff : les users staff sont rattachés à
  // l'org interne `org_savr`, `users.organisation_id` étant NOT NULL — s'appuyer
  // sur `!auth.ctx.organisationId` retombait à tort sur org_savr → 422 SIRET).
  const effectiveOrgId = auth.ctx.isAdmin
    ? (body.organisation_id as string | undefined)
    : auth.ctx.organisationId;

  if (!effectiveOrgId) {
    return NextResponse.json(
      {
        error:
          'Champ organisation_id requis pour la programmation de support admin',
      },
      { status: 422 },
    );
  }

  if (!body.lieu_id) {
    return NextResponse.json(
      { error: 'Champs obligatoires : lieu_id, collectes' },
      { status: 422 },
    );
  }

  // Nom de l'événement obligatoire à la confirmation (pas bloquant en
  // brouillon).
  // Une valeur qui n'est pas du texte est refusée ici, pas en erreur 500.
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
  // Client final obligatoire à la confirmation, pour tous les rôles
  // (décision Val 2026-10-30) ; pas bloquant en brouillon.
  if (body.confirmer && !clientFinalRenseigne(body.nom_client_organisateur)) {
    return NextResponse.json(
      {
        error: MESSAGE_CLIENT_FINAL_OBLIGATOIRE,
        champ: 'nom_client_organisateur',
      },
      { status: 422 },
    );
  }

  // `lieu_overrides` est un jsonb libre (aucun CHECK en base) et ses valeurs finissent
  // concaténées dans l'adresse transmise au transporteur : on borne ici les clés
  // (§06.01 § 2.a) ET le type/la longueur des valeurs, AVANT toute écriture.
  const overridesValides = validerLieuOverrides(body.lieu_overrides);
  if ('error' in overridesValides) return overridesValides.error;
  const lieuOverrides = overridesValides.overrides;

  const supabase = createAdminSupabaseClient();

  // Cartes des collectes : date, heure, convives, type d'événement, contacts,
  // informations supplémentaires ; au plus 10 par type (B2-Q4). Refus 422 avant
  // toute écriture.
  const cartesValides = await validerCartes(supabase, body.collectes, {
    plafond: true,
  });
  if ('error' in cartesValides) return cartesValides.error;
  const { cartes } = cartesValides;

  const perimetre = await verifierPerimetreProgrammation(supabase, auth.ctx, {
    effectiveOrgId,
    lieuId: body.lieu_id,
    traiteurDemande: body.traiteur_operationnel_organisation_id,
  });
  if ('error' in perimetre) return perimetre.error;

  // Entité de facturation de l'orga programmatrice (evenements.entite_facturation_id
  // NOT NULL). Le SIRET n'est PAS exigé pour programmer (décision Val 2026-09-28) ;
  // il ne bloque que l'émission de facture (§05 §8 étape 3). Lecture seule ici :
  // une organisation qui n'en a pas la voit créée plus bas, après le frein.
  const entiteLue = await lireEntiteFacturation(supabase, effectiveOrgId);
  if (!entiteLue.ok) return entiteLue.error;

  // Aucune garde pack AG : sans pack actif, la collecte AG se programme et sera
  // facturée à l'unité (décision Val 2026-10-16, ex-gate R3).

  // Débit des écritures clientes (cf. lib/frein-ecritures-client), brouillon
  // compris : la route est la même.
  const frein = freinerEcritureCliente({
    organisationId: effectiveOrgId,
    equipeSavr: auth.ctx.isAdmin,
  });
  if (frein) return frein;

  // Organisation sans entité de facturation : créée ici, après le frein.
  const completude = await requireCompletedOrganisation(
    supabase,
    effectiveOrgId,
    entiteLue,
  );
  if (!completude.ok) return completude.error;

  const hasOverride = !!(
    lieuOverrides && Object.keys(lieuOverrides).length > 0
  );

  // Événement et collectes en UNE transaction (fn_enregistrer_programmation) :
  // une carte refusée par la base n'en laisse aucune, ni l'événement. Chaque
  // collecte confirmée passe par fn_creer_collecte (ordre de création E1 pour
  // une ZD, dans la même transaction) ; un brouillon n'émet rien.
  const { data: resultat, error: rpcErr } = await supabase.rpc(
    'fn_enregistrer_programmation',
    {
      p_evenement: {
        organisation_id: effectiveOrgId,
        traiteur_operationnel_organisation_id: perimetre.traiteurOperationnelId,
        entite_facturation_id: completude.entiteFacturationId,
        lieu_id: body.lieu_id,
        created_by: auth.ctx.userId,
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
  if (rpcErr) return serverError(rpcErr, 'programmation.evenements.create');

  const { evenement_id: evenementId, collecte_ids: collecteIds } = resultat as {
    evenement_id: string;
    collecte_ids: string[];
  };

  if (body.confirmer) {
    // Les ordres de création sont en file (et, après l'acceptation automatique
    // AG, l'ordre d'envoi) : traités après la réponse, sans attendre le passage
    // planifié (décision Val 2026-10-12).
    envoyerOrdresSansAttendre(collecteIds);

    await apresConfirmation(supabase, req, {
      ctx: auth.ctx,
      evenementId,
      nomEvenement: body.nom_evenement ?? null,
      organisationId: effectiveOrgId,
      lieuId: body.lieu_id,
      collectes: collecteIds.map((id, rang) => ({
        id,
        type: cartes[rang]!.type,
      })),
      lieuOverrides: hasOverride ? lieuOverrides : null,
    });
  }

  return NextResponse.json(
    { evenement_id: evenementId, collecte_ids: collecteIds },
    { status: 201 },
  );
}
