import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { envoyerRecapProgrammation } from '@/lib/programmation/recap-email.js';
import { notifierTraiteurOperationnel } from '@/lib/notifications/traiteur-operationnel.js';
import { evaluerAutoAcceptAg } from '@/lib/attribution-ag/auto-accept.js';
import { serverError } from '@/lib/api-helpers.js';
import { validerCartes } from '@/lib/programmation/cartes.js';
import { lienCollectesProgrammeur } from '@/lib/programmation/apres-confirmation.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';
import {
  controleAccesEvenement,
  evenementEnBrouillon,
} from '@/lib/programmation/niveau-evenement.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

// Cible de l'action « Ajouter une collecte à cet événement » de l'écran de
// confirmation (§06.01 étape 13), de la fiche événement du gestionnaire et des
// fiches collecte → ouverte à l'admin en mode support comme le POST de création.
// L'org de rattachement n'est jamais celle du JWT ici : elle est lue sur
// l'événement (`evt.organisation_id`), ce qui vaut identité pour un rôle client
// (garanti par le prédicat org ci-dessous) et désigne l'org cible pour le staff.
//
// Ajout possible sur TOUT événement confirmé, quel que soit l'état de ses
// autres collectes (en cours, réalisées, clôturées, annulées), tant que la
// nouvelle collecte est datée d'aujourd'hui ou après (décision Val 2026-10-21).
// La fenêtre d'édition de l'événement (`f_collecte_editable`) ne s'applique
// donc pas ici : elle reste celle de la modification. Un événement en
// brouillon est refusé, et le niveau événement (contrôle d'accès compris) est
// lu sur l'événement, jamais dans le corps (§06.01, décisions Val 2026-10-21).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const supabase = createAdminSupabaseClient();

  // Carte de la collecte ajoutée (refonte du formulaire, lot B2) : date,
  // heure, convives, type d'événement, contacts et informations
  // supplémentaires, validés comme ceux du formulaire de création (422).
  const cartesValides = await validerCartes(supabase, [body], {
    plafond: false,
  });
  if ('error' in cartesValides) return cartesValides.error;
  const carte = cartesValides.cartes[0]!;

  // Vérification de propriété — même cloisonnement que le GET. Les collectes
  // de l'événement portent son contrôle d'accès (cf. lib/programmation/
  // niveau-evenement).
  const evtQuery = supabase
    .from('evenements')
    .select(
      'id, organisation_id, lieu_id, nom_evenement, collectes(statut, controle_acces_requis)',
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

  // Événement pas encore confirmé : refusé (décision Val 2026-10-21), le
  // bouton étant déjà masqué sur un brouillon. Après la garde de propriété,
  // pour ne rien dire d'un événement hors périmètre.
  if (evenementEnBrouillon(evt.collectes)) {
    return NextResponse.json(
      {
        error:
          'Événement en brouillon : confirmez-le avant d’y ajouter une collecte.',
      },
      { status: 422 },
    );
  }

  // Aucune garde pack AG (décision Val 2026-10-16) : sans pack actif, la collecte
  // AG ajoutée sera facturée à l'unité.

  // Débit des écritures clientes (cf. lib/frein-ecritures-client).
  const frein = freinerEcritureCliente({
    organisationId: evt.organisation_id,
    equipeSavr: auth.ctx.isAdmin,
  });
  if (frein) return frein;

  // fn_creer_collecte_carte : fn_creer_collecte (ordre E1 pour une ZD), puis
  // type d'événement et contacts de la carte, dans la même transaction ; sans
  // garde de statut. Pas fn_ajouter_collecte_evenement : elle refuse l'ajout
  // dès qu'aucune collecte de l'événement n'est en brouillon, programmée ou
  // validée.
  const { data: collecteId, error: rpcErr } = await supabase.rpc(
    'fn_creer_collecte_carte',
    {
      p_evenement_id: evenementId,
      p_carte: carte,
      // Niveau événement figé (§06.01) : le contrôle d'accès est celui de
      // l'événement, jamais une valeur du navigateur.
      p_controle_acces: controleAccesEvenement(evt.collectes),
      p_lieu_overrides: null,
      p_confirmer: true,
    },
  );

  if (rpcErr)
    return serverError(rpcErr, 'programmation.evenements.collectes.create');

  // L'ordre de création est en file (et, après l'acceptation automatique AG
  // plus bas, l'ordre d'envoi) : traité après la réponse, sans attendre le
  // passage planifié (décision Val 2026-10-12).
  if (collecteId) envoyerOrdresSansAttendre(collecteId as string);

  // PROG-05 : auto-accept si la collecte ajoutée est AG (§06.01 l.398 + §09 §6).
  if (carte.type === 'ag' && collecteId) {
    await evaluerAutoAcceptAg(collecteId as string).then(
      () => undefined,
      () => undefined,
    );
  }

  // PROG-04 : email récap au programmeur pour la collecte ajoutée.
  if (collecteId) {
    await envoyerRecapProgrammation(supabase, {
      programmeurUserId: auth.ctx.userId,
      evenementId,
      nomEvenement: evt.nom_evenement,
      organisationId: evt.organisation_id,
      lieuId: evt.lieu_id,
      collecteIds: [collecteId as string],
      lienCollectes: lienCollectesProgrammeur(req, auth.ctx.role),
    }).catch(() => undefined); // non-bloquant
  }

  // BL-P2-22 (tpl 20) : info-only au traiteur opérationnel si la collecte est
  // programmée par un tiers (garde tiers-non-shadow dans le helper). Best-effort.
  if (collecteId) {
    void notifierTraiteurOperationnel(supabase, {
      collecteId: collecteId as string,
      acteurOrgId: evt.organisation_id,
      changement: { kind: 'programmation', programmeurUserId: auth.ctx.userId },
    }).catch(() => undefined);
  }

  return NextResponse.json({ collecte_id: collecteId }, { status: 201 });
}
