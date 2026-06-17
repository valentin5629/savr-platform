import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

// Lecture seule, manager + commercial (§06.04 §6 Facturation, révision 2026-05-29).
const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

// GET /api/v1/traiteur/factures — liste des factures de l'orga (lecture seule).
// La policy fac_client_select + masquage colonne F5 (M3.5) garantissent le
// périmètre org-scoped et l'exclusion des colonnes sensibles (marge, synchro).
// Les brouillons sont exclus (non visibles côté traiteur — §06.04 fiche).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const statut = searchParams.get('statut');
  const type = searchParams.get('type');

  let query = supabase
    .from('factures')
    .select(
      `id, numero_facture, type, statut, montant_ht, montant_ttc,
       date_emission, date_echeance, date_paiement, pdf_url_pennylane, pdf_url_savr`,
    )
    .neq('statut', 'brouillon')
    .order('date_emission', { ascending: false, nullsFirst: false });

  if (statut) query = query.eq('statut', statut);
  if (type) query = query.eq('type', type);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
