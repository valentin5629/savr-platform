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
  const q_ = sanitizeOrTerm(searchParams.get('q') ?? ''); // C2 : neutralise l'injection .or

  // ⚠ plateforme.organisations n'a NI colonne `nom_commercial` NI `ville` (le nom
  // commercial est stocké dans `nom` ; le SIRET vit sur entites_facturation). L'ancien
  // SELECT/filtre sur ces colonnes fantômes provoquait un PostgREST 400 au runtime
  // (bug latent colonne-DB PROG-02). On ne lit que des colonnes réelles.
  //
  // Cette route tourne en service_role : la RLS ne la borne PAS, le périmètre est
  // décidé ici. Le SIRET et la raison sociale ne sont rendus QU'AU staff (§06.05 :
  // d'un traiteur tiers, un rôle client ne voit rien au-delà du nom). La liste
  // déroulante §06.01 affichait `nom || raison_sociale` : ce repli est calculé ici,
  // comme le fait v_referentiel_traiteurs (20260922080000), et la raison sociale ne
  // sort plus de la route.
  //
  // Deux requêtes à liste de colonnes LITTÉRALE plutôt qu'un select construit : un
  // select dynamique est invisible au gate colonne-DB (G7) et casse le typage.
  if (auth.ctx.isAdmin) {
    let q = supabase
      .from('organisations')
      .select('id, nom, raison_sociale, siret')
      .eq('type', 'traiteur')
      .eq('est_shadow', false)
      .eq('actif', true)
      .order('raison_sociale')
      .limit(20);
    if (q_) {
      q = q.or(
        `raison_sociale.ilike.%${q_}%,nom.ilike.%${q_}%,siret.ilike.%${q_}%`,
      );
    }
    const { data, error } = await q;
    if (error)
      return serverError(error, 'programmation.organisations.traiteurs.list');
    return NextResponse.json(data ?? []);
  }

  let q = supabase
    .from('organisations')
    .select('id, nom, raison_sociale')
    .eq('type', 'traiteur')
    .eq('est_shadow', false)
    .eq('actif', true)
    .order('raison_sociale')
    .limit(20);
  if (q_) {
    // Chercher par SIRET le confirmerait sans l'afficher : staff seul.
    q = q.or(`raison_sociale.ilike.%${q_}%,nom.ilike.%${q_}%`);
  }
  const { data, error } = await q;
  if (error)
    return serverError(error, 'programmation.organisations.traiteurs.list');

  return NextResponse.json(
    (data ?? []).map((t) => ({
      id: t.id,
      nom: (t.nom ?? '').trim() || (t.raison_sociale ?? ''),
    })),
  );
}
