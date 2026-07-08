import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateur } from '@/lib/api-auth.js';
import { envoyerRecapProgrammation } from '@/lib/programmation/recap-email.js';
import { evaluerAutoAcceptAg } from '@/lib/attribution-ag/auto-accept.js';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const { type, date_collecte, heure_collecte } = body;

  if (!type || !date_collecte || !heure_collecte) {
    return NextResponse.json(
      { error: 'Champs obligatoires : type, date_collecte, heure_collecte' },
      { status: 422 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  if (String(date_collecte) < today) {
    return NextResponse.json(
      { error: 'Date de collecte dans le passé' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Vérification propriété et éditabilité
  const { data: evt } = await supabase
    .from('evenements')
    .select('id, organisation_id, nom_evenement, pax')
    .eq('id', evenementId)
    .eq('organisation_id', auth.ctx.organisationId)
    .single();

  if (!evt) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }

  const { data: editable } = await supabase.rpc('f_collecte_editable', {
    p_evenement_id: evenementId,
  });

  if (!editable) {
    return NextResponse.json(
      { error: 'Cet événement ne peut plus être modifié (statut terminal)' },
      { status: 422 },
    );
  }

  // Vérification pack AG si type=ag (même gate que la programmation initiale, R3)
  if (String(type) === 'ag') {
    const { data: pack } = await supabase
      .from('packs_antgaspi')
      .select('id, credits_restants')
      .eq('organisation_id', auth.ctx.organisationId)
      .eq('statut', 'actif')
      .maybeSingle();
    if (!pack || (pack.credits_restants ?? 0) <= 0) {
      return NextResponse.json(
        {
          error:
            'Aucun pack Anti-Gaspi actif disponible pour cette organisation',
        },
        { status: 422 },
      );
    }
  }

  // fn_ajouter_collecte_evenement : délègue à fn_creer_collecte (gère E1 pour ZD)
  const { data: collecteId, error: rpcErr } = await supabase.rpc(
    'fn_ajouter_collecte_evenement',
    {
      p_evenement_id: evenementId,
      p_type: String(type),
      p_date_collecte: String(date_collecte),
      p_heure_collecte: String(heure_collecte),
      p_controle_acces: body.controle_acces_requis ?? false,
      p_info_suppl: body.informations_supplementaires ?? null,
    },
  );

  if (rpcErr)
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });

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
    pax: evt.pax,
    organisationId: evt.organisation_id,
    collectes: [{ type: String(type), date_collecte: String(date_collecte) }],
  }).catch(() => undefined); // non-bloquant

  return NextResponse.json({ collecte_id: collecteId }, { status: 201 });
}
