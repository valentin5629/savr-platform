import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { readJsonBody, serverError } from '@/lib/api-helpers.js';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('collectes')
    .select(
      `*,
       evenements!inner(
         *, organisations!organisation_id(raison_sociale, siret),
         lieux!lieu_id(*), types_evenements!type_evenement_id(nom)
       ),
       collecte_flux(flux_id, poids_reel_kg, equivalent_roll, nb_bacs, flux_dechets!flux_id(code, nom)),
       collecte_tournees(
         *, tournees(id, statut_tms, tms_reference, external_ref_commande)
       ),
       packs_antgaspi!pack_antgaspi_id(id, type_pack, credits_restants),
       factures_collectes(id, montant_ht, statut)`,
    )
    .eq('id', id)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }
  if (error) return serverError(error, 'admin.collectes.get');

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = await readJsonBody(req);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const ALLOWED_FIELDS = [
    'date_collecte',
    'heure_collecte',
    'nb_camions_demande',
    'controle_acces_requis',
    'notes_internes',
    'informations_supplementaires',
    'prestataire_logistique_id',
    'motif_override_prestataire',
    'statut',
    'annulee_cote_savr',
    'annulee_cote_savr_motif',
    'lieu_overrides',
  ];
  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_FIELDS.includes(k)),
  );

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  // §07/06 collecte_statut_force — une bascule MANUELLE de statut exige un motif
  // (≥ 10 car., §07/06 pt2). Les éditions de routine (date, notes, camions…)
  // restent une simple action 'UPDATE' sans motif.
  const forceStatut = 'statut' in updates;
  const motif = typeof body.motif === 'string' ? body.motif.trim() : '';
  if (forceStatut && motif.length < 10) {
    return NextResponse.json(
      {
        error:
          'Un motif d’au moins 10 caractères est requis pour forcer le statut d’une collecte',
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data: before, error: fetchErr } = await supabase
    .from('collectes')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !before) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }

  // fn_modifier_collecte : UPDATE + outbox E2 conditionnel dans la même transaction (G4)
  const { data: updatedJson, error } = await supabase.rpc(
    'fn_modifier_collecte',
    {
      p_id: id,
      p_updates: updates,
      p_champs_modifies: Object.keys(updates),
    },
  );

  if (error) return serverError(error, 'admin.collectes.update');

  const data = updatedJson as Record<string, unknown>;

  if (forceStatut) {
    await supabase.from('audit_log').insert({
      table_name: 'collectes',
      record_id: id,
      action: 'collecte_statut_force',
      user_id: auth.ctx.userId,
      motif,
      old_values: { statut: (before as { statut?: unknown }).statut },
      new_values: { statut: updates.statut },
    });
  } else {
    await supabase.from('audit_log').insert({
      table_name: 'collectes',
      record_id: id,
      action: 'UPDATE',
      user_id: auth.ctx.userId,
      old_values: before,
      new_values: data,
    });
  }

  return NextResponse.json(data);
}
