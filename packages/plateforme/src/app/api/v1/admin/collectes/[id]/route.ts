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
         lieux!lieu_id(*), types_evenements!type_evenement_id(libelle)
       ),
       collecte_flux(flux_id, poids_reel_kg, equivalent_roll, nb_bacs, flux_dechets!flux_id(code, nom)),
       collecte_tournees(
         *, tournees(id, statut, tms_reference, external_ref_commande)
       ),
       packs_antgaspi!pack_antgaspi_id(id, type_pack, credits_restants),
       factures_collectes(id, montant_ht, factures!facture_id(statut))`,
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

  if (error) {
    const msg = error.message ?? '';
    // RM-05 : réduction du nombre de camions bloquée < 1h avant la mission →
    // alerte Ops (créée hors de la transaction rollbackée) + refus 409.
    if (msg.includes('REDUCTION_CANCEL_WINDOW_CLOSED')) {
      await supabase.rpc('f_upsert_alerte_admin', {
        p_code: 'reduction_camions_bloquee',
        p_titre: 'Réduction de camions bloquée (< 1h avant mission)',
        p_message: `La réduction du nombre de camions de la collecte ${id} a été bloquée (moins d’1h avant la mission). Intervention manuelle requise (contacter le transporteur).`,
        p_entity_type: 'collectes',
        p_entity_id: id,
      });
      return NextResponse.json(
        {
          error:
            'Réduction du nombre de camions impossible à moins d’1h de la mission (alerte Ops créée)',
        },
        { status: 409 },
      );
    }
    // RM-02 : nb_camions_demande non modifiable sur un statut terminal.
    if (msg.includes('NB_CAMIONS_STATUT_TERMINAL')) {
      return NextResponse.json(
        {
          error:
            'Le nombre de camions n’est plus modifiable (collecte à un statut terminal)',
        },
        { status: 409 },
      );
    }
    return serverError(error, 'admin.collectes.update');
  }

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
