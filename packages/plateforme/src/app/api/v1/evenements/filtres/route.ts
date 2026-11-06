import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAnyUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { LoaderError, type DbClient } from '@/lib/dashboards/loaders.js';
import {
  OptionsIndisponibles,
  optionsFiltresEvenements,
} from '@/lib/evenements/filtres-evenements.js';
import { espaceEvenementsDuRole } from '@/lib/evenements/liste-evenements.js';

// GET /api/v1/evenements/filtres — options de la barre de filtres de la liste
// Événements, pour tous les rôles (cf. lib/evenements/filtres-evenements.ts).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;
  const espace = espaceEvenementsDuRole(auth.ctx.role);
  if (!espace)
    return NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 });

  const supabase = (
    auth.ctx.isStaff
      ? createAdminSupabaseClient()
      : createSupabaseServerClient()
  ) as DbClient;
  try {
    return NextResponse.json({
      data: await optionsFiltresEvenements(supabase, espace),
    });
  } catch (e) {
    // Lecture en échec : 500 au libellé neutre (l'erreur réelle est déjà
    // journalisée), jamais des listes vides qui se liraient « aucun lieu ».
    if (e instanceof LoaderError || e instanceof OptionsIndisponibles)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
    throw e;
  }
}
