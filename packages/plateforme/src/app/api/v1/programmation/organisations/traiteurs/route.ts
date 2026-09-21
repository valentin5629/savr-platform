import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { sanitizeOrTerm, serverError } from '@/lib/api-helpers.js';

// Accessible aux rôles qui programment pour le compte d'un traiteur tiers
// (agence, gestionnaire_lieux) + admin_savr/ops_savr en programmation de support
// « tous périmètres » (CDC §06.01 l.15).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  if (
    auth.ctx.role !== 'agence' &&
    auth.ctx.role !== 'gestionnaire_lieux' &&
    !auth.ctx.isAdmin
  ) {
    return NextResponse.json(
      { error: 'Réservé aux rôles agence, gestionnaire_lieux et admin' },
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
  //
  // Cette route tourne en service_role : la RLS ne la borne PAS, le périmètre est
  // décidé ici. Le SIRET n'est rendu QU'AU staff (§06.05 : d'un traiteur tiers, un
  // gestionnaire ne voit rien au-delà du nom ; la liste déroulante §06.01 n'affiche
  // que `nom || raison_sociale`, le SIRET n'y était pas montré). Il reste lisible et
  // cherchable par admin_savr / ops_savr, en programmation de support.
  const colonnes = auth.ctx.isAdmin
    ? 'id, nom, raison_sociale, siret'
    : 'id, nom, raison_sociale';
  let query = supabase
    .from('organisations')
    .select(colonnes)
    .eq('type', 'traiteur')
    .eq('est_shadow', false)
    .eq('actif', true)
    .order('raison_sociale')
    .limit(20);

  if (q) {
    const motifs = [`raison_sociale.ilike.%${q}%`, `nom.ilike.%${q}%`];
    // Chercher par SIRET le confirmerait sans l'afficher : staff seul.
    if (auth.ctx.isAdmin) motifs.push(`siret.ilike.%${q}%`);
    query = query.or(motifs.join(','));
  }

  const { data, error } = await query;
  if (error)
    return serverError(error, 'programmation.organisations.traiteurs.list');

  return NextResponse.json(data ?? []);
}
