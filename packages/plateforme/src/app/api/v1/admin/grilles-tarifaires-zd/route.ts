import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();

  // Colonnes réelles du schéma (vérifiées contre savr-dev, R17-BOA sl3) :
  // grilles_tarifaires_zd → actif, valide_jusqu (pas de `methode`, pas de
  // `valide_jusqu_au`) ; tarifs_zero_dechet → prix_base_ht, prix_par_couvert_ht
  // (pas de `montant_fixe_ht`/`montant_par_pax_ht`). L'ancien select renvoyait un
  // HTTP 400 (`column tarifs_zero_dechet.montant_fixe_ht does not exist`) → l'onglet
  // Grille ZD de la fiche organisation aurait affiché un écran blanc.
  const { data, error } = await supabase
    .from('grilles_tarifaires_zd')
    .select(
      'id, nom, description, est_defaut, actif, valide_du, valide_jusqu, tarifs_zero_dechet(id, pax_min, pax_max, prix_base_ht, prix_par_couvert_ht)',
    )
    .order('est_defaut', { ascending: false })
    .order('nom');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { nom, description, methode, est_defaut, valide_du } = body as {
    nom?: string;
    description?: string;
    methode?: string;
    est_defaut?: boolean;
    valide_du?: string;
  };

  if (!nom || !methode) {
    return NextResponse.json(
      { error: 'nom et methode sont obligatoires' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('grilles_tarifaires_zd')
    .insert({
      nom,
      description,
      methode,
      est_defaut: est_defaut ?? false,
      valide_du: valide_du ?? new Date().toISOString().slice(0, 10),
    })
    .select('*')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });

  return NextResponse.json(data, { status: 201 });
}
