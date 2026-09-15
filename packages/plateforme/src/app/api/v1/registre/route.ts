// GET /api/v1/registre — liste paginée du registre réglementaire ZD (§06.03).
// Tous les rôles autorisés (sauf agence) ; cloisonnement par la vue RLS-safe
// `v_registre_dechets`. Filtres : période, lieu, traiteur, flux, statut bordereau.

import { NextRequest, NextResponse } from 'next/server';

import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';

import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { requireRegistreUser } from '@/lib/registre/guard.js';
import {
  parseRegistreFilters,
  fetchRegistre,
} from '@/lib/registre/registre.js';
import { serverError } from '@/lib/api-helpers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireRegistreUser(req);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient;
  const filters = parseRegistreFilters(new URL(req.url).searchParams);

  try {
    const result = await fetchRegistre(supabase, filters);
    return NextResponse.json(result);
  } catch (e) {
    // Le message est déjà neutralisé à la source (`erreurInterne`), mais le
    // renvoyer via une variable intermédiaire rendait le cliquet aveugle à ce
    // chemin (contre-revue sécurité) : on passe par le helper, comme partout.
    return serverError(e, 'registre.lecture');
  }
}
