import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

// GET /api/v1/admin/dashboard-client/organisations
// §06.06 §2 — liste légère des organisations pour l'autocomplete du sélecteur
// (« Toutes les organisations » + une ou plusieurs orgas). Types client uniquement :
// traiteur, agence, gestionnaire_lieux (cf. spec). `nom` est NOT NULL (colonne
// canonique de l'autocomplete) ; `raison_sociale` est nullable (fallback = nom).
// Lecture seule, service-role (l'admin voit tout). Tri par nom.
const TYPES_CLIENT = ['traiteur', 'agence', 'gestionnaire_lieux'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('organisations')
    .select('id, nom, raison_sociale, type')
    .in('type', TYPES_CLIENT)
    .order('nom');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
