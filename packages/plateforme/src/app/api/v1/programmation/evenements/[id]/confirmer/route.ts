import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { envoyerRecapProgrammation } from '@/lib/programmation/recap-email.js';
import {
  lienCollectesProgrammeur,
  lienEvenementProgrammeur,
} from '@/lib/programmation/apres-confirmation.js';
import { notifierOverrideLieu } from '@/lib/programmation/lieu-override.js';
import { notifierTraiteurOperationnel } from '@/lib/notifications/traiteur-operationnel.js';
import { evaluerAutoAcceptAg } from '@/lib/attribution-ag/auto-accept.js';
import { serverError } from '@/lib/api-helpers.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

// Confirmation d'un brouillon. Ouverte à l'admin en mode support (§06.01 l.17
// « admin_savr : programmation de support, tous périmètres ») comme le POST de
// création (#223) : sans elle, l'admin créait un brouillon qu'il ne pouvait plus
// jamais confirmer — orphelin en base.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const supabase = createAdminSupabaseClient();

  // Vérification propriété de l'événement. Route d'ITEM clé par PK : l'id désigne
  // déjà la ligne, l'org se lit dessus — identité pour un rôle client (garantie
  // par le prédicat), org cible pour le staff (dont le JWT porte `org_savr` :
  // le poser en prédicat ne cloisonnerait rien, ça masquerait tout).
  const evtQuery = supabase
    .from('evenements')
    .select('id, organisation_id, nom_evenement, lieu_id, created_by')
    .eq('id', evenementId);

  const { data: evt, error: evtErr } = await (
    auth.ctx.isAdmin
      ? evtQuery
      : evtQuery.eq('organisation_id', auth.ctx.organisationId)
  ).single();

  if (evtErr || !evt) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }

  // Périmètre d'ÉCRITURE : le commercial confirme les brouillons de toute son
  // organisation, comme le manager (Val 2026-10-30). Le prédicat organisation
  // est posé par la lecture ci-dessus (route sous service-role).

  // Vérification collectes brouillon présentes
  const { data: collectes } = await supabase
    .from('collectes')
    .select('id, type, lieu_overrides')
    .eq('evenement_id', evenementId)
    .eq('statut', 'brouillon');

  if (!collectes?.length) {
    return NextResponse.json(
      { error: 'Aucune collecte en brouillon à confirmer' },
      { status: 422 },
    );
  }

  // Aucune garde « profil entreprise » ici : l'événement porte déjà son entité de
  // facturation (evenements.entite_facturation_id NOT NULL, résolue à la création),
  // et le SIRET ne bloque pas la programmation (décision Val 2026-09-28).
  // Pas de garde pack AG non plus : sans pack actif, la collecte AG est facturée à
  // l'unité (décision Val 2026-10-16, ex-gate R3).

  // Débit des écritures clientes (cf. lib/frein-ecritures-client).
  const frein = freinerEcritureCliente({
    organisationId: evt.organisation_id,
    equipeSavr: auth.ctx.isAdmin,
  });
  if (frein) return frein;

  // RPC atomique : brouillon → programmee + E1 pour ZD
  const { error: rpcErr } = await supabase.rpc(
    'fn_confirmer_programmation_brouillon',
    { p_evenement_id: evenementId },
  );

  if (rpcErr)
    return serverError(rpcErr, 'programmation.evenements.confirmer.update');

  // Les ordres de création sont en file (et, après l'acceptation automatique
  // AG plus bas, l'ordre d'envoi) : traités après la réponse, sans attendre le
  // passage planifié (décision Val 2026-10-12).
  envoyerOrdresSansAttendre(collectes.map((c) => c.id));

  // PROG-01 : override lieu persisté au brouillon → signalement Admin à la confirmation.
  const overrideCollecte = collectes.find(
    (c) => c.lieu_overrides && Object.keys(c.lieu_overrides).length > 0,
  );
  if (overrideCollecte && evt.lieu_id) {
    await notifierOverrideLieu(supabase, {
      evenementId,
      lieuId: evt.lieu_id,
      overrides: overrideCollecte.lieu_overrides as Record<string, unknown>,
      userId: auth.ctx.userId,
      role: auth.ctx.role,
    });
  }

  // PROG-05 : auto-accept de chaque collecte AG à la confirmation (§06.01 l.398 + §09 §6).
  await Promise.all(
    collectes
      .filter((c) => c.type === 'anti_gaspi')
      .map((c) =>
        evaluerAutoAcceptAg(c.id).then(
          () => undefined,
          () => undefined,
        ),
      ),
  );

  // PROG-04 : email récap au programmeur (un seul email, une ligne par collecte).
  await envoyerRecapProgrammation(supabase, {
    programmeurUserId: auth.ctx.userId,
    evenementId,
    nomEvenement: evt.nom_evenement,
    organisationId: evt.organisation_id,
    lieuId: evt.lieu_id,
    collecteIds: collectes.map((c) => c.id),
    lienCollectes: lienCollectesProgrammeur(req, auth.ctx.role),
    lienEvenement: lienEvenementProgrammeur(req, auth.ctx.role, evenementId),
  }).catch(() => undefined); // non-bloquant

  // BL-P2-22 (tpl 20) : info-only au traiteur opérationnel si programmé par un
  // tiers (garde tiers-non-shadow dans le helper). Best-effort, une notification.
  // L'acteur est l'org AU NOM DE laquelle on programme, jamais l'org du JWT : pour
  // un admin en support, `org_savr` ferait passer le traiteur opérationnel pour un
  // tiers → notification parasite. Miroir du POST de création (#223).
  if (collectes[0]) {
    void notifierTraiteurOperationnel(supabase, {
      collecteId: collectes[0].id,
      acteurOrgId: evt.organisation_id,
      changement: { kind: 'programmation', programmeurUserId: auth.ctx.userId },
    }).catch(() => undefined);
  }

  return NextResponse.json({ evenement_id: evenementId, statut: 'programmee' });
}
