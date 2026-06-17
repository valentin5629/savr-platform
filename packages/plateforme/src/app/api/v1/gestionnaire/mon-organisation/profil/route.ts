import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/mon-organisation/profil
// PATCH /api/v1/gestionnaire/mon-organisation/profil
// Profil de la propre organisation (champs non-sensibles).
// Champs éditables : nom_affichage, description_activite, logo_url,
//                    telephone_standard, site_web.
// Champs protégés (Admin only) : siren, siret, tva_intra, statut_verification_*.

const EDITABLE_FIELDS = new Set([
  'nom_affichage',
  'description_activite',
  'logo_url',
  'telephone_standard',
  'site_web',
]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('organisations')
    .select(
      `id, nom, nom_affichage, type, logo_url, description_activite,
       site_web, telephone_standard, ville, code_postal,
       domaine_email, siret_verification, actif`,
    )
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const supabase = createSupabaseServerClient();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  // Filtrer les champs non autorisés
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE_FIELDS.has(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ éditable fourni' },
      { status: 400 },
    );

  const { data, error } = await supabase
    .from('organisations')
    .update(patch)
    .select(
      `id, nom, nom_affichage, type, logo_url, description_activite,
       site_web, telephone_standard, ville, code_postal, actif`,
    )
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}
