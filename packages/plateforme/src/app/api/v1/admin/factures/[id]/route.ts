import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';
import {
  patchFactureHeader,
  type FactureHeaderPatch,
} from '@/lib/facturation/edition-facture.js';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('factures')
    .select(
      `*,
       organisations!organisation_id(raison_sociale, siret, type_organisation),
       entites_facturation(
         raison_sociale, siret, tva_intracom, adresse_facturation,
         code_postal, ville, pays, conditions_paiement_jours,
         siret_verification, tva_verification, pennylane_customer_id
       ),
       factures_collectes(
         id, designation, libelle_ligne, quantite, montant_ligne_ht, taux_tva,
         tarif_applique_source, tarif_detail, montant_ht,
         collectes(
           id, type, statut,
           evenements(id, reference_affaire, date_evenement,
             lieux!lieu_id(nom_usuel)
           )
         )
       )`,
    )
    .eq('id', id)
    .single();

  if (error) {
    const status = error.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ data });
}

// PATCH — édition de l'en-tête facture (Blocs 1 & 5, brouillon uniquement).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  let body: FactureHeaderPatch;
  try {
    body = (await req.json()) as FactureHeaderPatch;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();
  const result = await patchFactureHeader(supabase, id, body);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.erreur },
      { status: result.statut ?? 422 },
    );
  }
  return NextResponse.json({ ok: true });
}
