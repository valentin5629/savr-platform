import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { requireCompletedOrganisation } from '@/lib/onboarding-guards.js';
import { envoyerRecapProgrammation } from '@/lib/programmation/recap-email.js';
import { notifierOverrideLieu } from '@/lib/programmation/lieu-override.js';
import { notifierTraiteurOperationnel } from '@/lib/notifications/traiteur-operationnel.js';
import { evaluerAutoAcceptAg } from '@/lib/attribution-ag/auto-accept.js';

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
    .select('id, organisation_id, nom_evenement, pax, lieu_id')
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

  // Vérification collectes brouillon présentes
  const { data: collectes } = await supabase
    .from('collectes')
    .select('id, type, date_collecte, lieu_overrides')
    .eq('evenement_id', evenementId)
    .eq('statut', 'brouillon');

  if (!collectes?.length) {
    return NextResponse.json(
      { error: 'Aucune collecte en brouillon à confirmer' },
      { status: 422 },
    );
  }

  // Gate facturation (R1) — profil entreprise complet (SIRET vérifié), §09 §5,
  // même règle que le chemin direct.
  const completude = await requireCompletedOrganisation(
    supabase,
    evt.organisation_id,
    'Complétez votre profil entreprise (SIRET vérifié requis pour confirmer la programmation)',
  );
  if (!completude.ok) return completude.error;

  // Gate pack AG (R3) — si des collectes AG sont présentes dans ce brouillon.
  // ⚠ Les collectes viennent de la DB : type = 'anti_gaspi' (valeur enum), jamais 'ag'
  // (alias d'entrée). L'ancienne comparaison `=== 'ag'` était toujours fausse → la gate
  // pack ne se déclenchait jamais à la confirmation d'un brouillon (bug latent PROG-05).
  const hasAg = collectes.some((c) => c.type === 'anti_gaspi');
  if (hasAg) {
    const { data: pack } = await supabase
      .from('packs_antgaspi')
      .select('id, credits_restants')
      .eq('organisation_id', evt.organisation_id)
      .eq('statut', 'actif')
      .maybeSingle();
    if (!pack || (pack.credits_restants ?? 0) <= 0) {
      return NextResponse.json(
        { error: 'Aucun pack Anti-Gaspi actif disponible pour confirmer' },
        { status: 422 },
      );
    }
  }

  // RPC atomique : brouillon → programmee + E1 pour ZD
  const { error: rpcErr } = await supabase.rpc(
    'fn_confirmer_programmation_brouillon',
    { p_evenement_id: evenementId },
  );

  if (rpcErr)
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });

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

  // PROG-04 : email récap au programmeur (un seul email, tarif ZD inclus).
  await envoyerRecapProgrammation(supabase, {
    programmeurUserId: auth.ctx.userId,
    evenementId,
    nomEvenement: evt.nom_evenement,
    pax: evt.pax,
    organisationId: evt.organisation_id,
    collectes: collectes.map((c) => ({
      type: c.type,
      date_collecte: c.date_collecte,
    })),
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
