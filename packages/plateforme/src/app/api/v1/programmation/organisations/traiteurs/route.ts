import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateur } from '@/lib/api-auth.js';
import { sanitizeOrTerm } from '@/lib/api-helpers.js';

// Accessible uniquement aux rôles qui programment pour le compte d'un traiteur tiers
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  if (auth.ctx.role !== 'agence' && auth.ctx.role !== 'gestionnaire_lieux') {
    return NextResponse.json(
      { error: 'Réservé aux rôles agence et gestionnaire_lieux' },
      { status: 403 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const q = sanitizeOrTerm(searchParams.get('q') ?? ''); // C2 : neutralise l'injection .or

  // ⚠ plateforme.organisations n'a NI colonne `nom_commercial` NI `ville` (le nom
  // commercial est stocké dans `nom` ; le SIRET vit sur entites_facturation). L'ancien
  // SELECT/filtre sur ces colonnes fantômes provoquait un PostgREST 400 au runtime
  // (bug latent colonne-DB PROG-02). On ne lit que des colonnes réelles.
  let query = supabase
    .from('organisations')
    .select('id, nom, raison_sociale, siret')
    .eq('type', 'traiteur')
    .eq('est_shadow', false)
    .eq('actif', true)
    .order('raison_sociale')
    .limit(20);

  if (q) {
    query = query.or(
      `raison_sociale.ilike.%${q}%,nom.ilike.%${q}%,siret.ilike.%${q}%`,
    );
  }

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
