import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

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
