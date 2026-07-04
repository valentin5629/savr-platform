import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();

  // Colonnes réelles du schéma (vérifiées contre savr-dev, R17-BOA sl3) :
  // grilles_tarifaires_zd → actif, valide_jusqu, mode (colonne ajoutée R18/BL-P2-04
  // convergente DDL cible) ; tarifs_zero_dechet → prix_base_ht, prix_par_couvert_ht.
  // `organisations(count)` = nb d'organisations rattachées (catalogue §9 l.738).
  const { data, error } = await supabase
    .from('grilles_tarifaires_zd')
    .select(
      'id, nom, description, mode, est_defaut, actif, valide_du, valide_jusqu, organisations(count), tarifs_zero_dechet(id, pax_min, pax_max, prix_base_ht, prix_par_couvert_ht)',
    )
    .order('est_defaut', { ascending: false })
    .order('nom');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Aplatit organisations(count) → nb_organisations (champ propre pour le catalogue).
  const rows = (data ?? []).map((g) => {
    const { organisations, ...rest } = g as typeof g & {
      organisations?: { count: number }[];
    };
    return { ...rest, nb_organisations: organisations?.[0]?.count ?? 0 };
  });

  return NextResponse.json({ data: rows });
}

interface PalierInput {
  pax_min: number;
  pax_max: number | null;
  prix_base_ht: number;
  prix_par_couvert_ht?: number;
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

  const { nom, description, mode, est_defaut, valide_du, paliers } = body as {
    nom?: string;
    description?: string;
    mode?: string;
    est_defaut?: boolean;
    valide_du?: string;
    paliers?: PalierInput[];
  };

  if (!nom || !mode) {
    return NextResponse.json(
      { error: 'nom et mode sont obligatoires' },
      { status: 422 },
    );
  }
  if (mode !== 'paliers' && mode !== 'fixe_variable') {
    return NextResponse.json(
      { error: 'mode doit être « paliers » ou « fixe_variable »' },
      { status: 422 },
    );
  }
  if (!Array.isArray(paliers) || paliers.length === 0) {
    return NextResponse.json(
      { error: 'au moins un palier est obligatoire' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Création versionnée atomique (ferme l'ancienne grille par défaut + insère
  // entête + paliers). En mode « paliers », prix_par_couvert_ht est forcé à 0
  // côté RPC (CDC §9 l.740).
  const { data, error } = await supabase.rpc('rpc_creer_grille_zd', {
    p_nom: nom,
    p_description: description ?? undefined,
    p_mode: mode,
    p_est_defaut: est_defaut ?? false,
    p_valide_du: valide_du ?? new Date().toISOString().slice(0, 10),
    p_paliers: paliers,
  });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });

  return NextResponse.json(data, { status: 201 });
}
