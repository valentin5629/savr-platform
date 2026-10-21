import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { envoyerRecapProgrammation } from '@/lib/programmation/recap-email.js';
import { validerChampsTexteLibre } from '@/lib/champs-texte-libre.js';
import { notifierTraiteurOperationnel } from '@/lib/notifications/traiteur-operationnel.js';
import { evaluerAutoAcceptAg } from '@/lib/attribution-ag/auto-accept.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { serverError } from '@/lib/api-helpers.js';
import { refusHeureCollecte } from '@/lib/heure-collecte.js';
import { refusPaxCollecte } from '@/lib/pax-collecte.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';

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
// Ajout possible sur TOUT événement, quel que soit l'état de ses autres
// collectes (en cours, réalisées, clôturées, annulées), tant que la nouvelle
// collecte est datée d'aujourd'hui ou après (décision Val 2026-10-21). La
// fenêtre d'édition de l'événement (`f_collecte_editable`) ne s'applique donc
// pas ici : elle reste celle de la modification.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const { type, date_collecte, heure_collecte, pax } = body;

  if (!type || !date_collecte || !heure_collecte) {
    return NextResponse.json(
      {
        error: 'Champs obligatoires : type, date_collecte, heure_collecte',
      },
      { status: 422 },
    );
  }
  const refusHeure = refusHeureCollecte(heure_collecte);
  if (refusHeure) return refusHeure;
  // Pax de la collecte, saisi avec sa date (décision Val 2026-10-20).
  const refusPax = refusPaxCollecte(pax);
  if (refusPax) return refusPax;

  // Borne d'entrée du texte libre transmis au transporteur (voir la route de
  // programmation initiale) : la RPC stocke `p_info_suppl` sans rien vérifier.
  const texteValide = validerChampsTexteLibre(body);
  if ('error' in texteValide) return texteValide.error;
  const infoSuppl = texteValide.valeurs.informations_supplementaires ?? null;

  const today = jourParis();
  if (String(date_collecte) < today) {
    return NextResponse.json(
      { error: 'Date de collecte dans le passé' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Vérification de propriété — même cloisonnement que le GET.
  const evtQuery = supabase
    .from('evenements')
    .select('id, organisation_id, lieu_id, nom_evenement')
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

  // Aucune garde pack AG (décision Val 2026-10-16) : sans pack actif, la collecte
  // AG ajoutée sera facturée à l'unité.

  // Débit des écritures clientes (cf. lib/frein-ecritures-client).
  const frein = freinerEcritureCliente({
    organisationId: evt.organisation_id,
    equipeSavr: auth.ctx.isAdmin,
  });
  if (frein) return frein;

  // fn_creer_collecte (gère E1 pour ZD), sans garde de statut. Pas
  // fn_ajouter_collecte_evenement : elle refuse l'ajout dès qu'aucune collecte
  // de l'événement n'est en brouillon, programmée ou validée.
  const { data: collecteId, error: rpcErr } = await supabase.rpc(
    'fn_creer_collecte',
    {
      p_evenement_id: evenementId,
      p_type: String(type),
      p_date_collecte: String(date_collecte),
      p_heure_collecte: String(heure_collecte),
      p_controle_acces: body.controle_acces_requis ?? false,
      p_info_suppl: infoSuppl,
      p_pax: pax,
    },
  );

  if (rpcErr)
    return serverError(rpcErr, 'programmation.evenements.collectes.create');

  // L'ordre de création est en file (et, après l'acceptation automatique AG
  // plus bas, l'ordre d'envoi) : traité après la réponse, sans attendre le
  // passage planifié (décision Val 2026-10-12).
  if (collecteId) envoyerOrdresSansAttendre(collecteId as string);

  // PROG-05 : auto-accept si la collecte ajoutée est AG (§06.01 l.398 + §09 §6).
  if (String(type) === 'ag' && collecteId) {
    await evaluerAutoAcceptAg(collecteId as string).then(
      () => undefined,
      () => undefined,
    );
  }

  // PROG-04 : email récap au programmeur pour la collecte ajoutée (tarif ZD inclus).
  await envoyerRecapProgrammation(supabase, {
    programmeurUserId: auth.ctx.userId,
    evenementId,
    nomEvenement: evt.nom_evenement,
    organisationId: evt.organisation_id,
    lieuId: evt.lieu_id,
    collectes: [
      {
        type: String(type),
        date_collecte: String(date_collecte),
        pax: pax as number,
      },
    ],
  }).catch(() => undefined); // non-bloquant

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
