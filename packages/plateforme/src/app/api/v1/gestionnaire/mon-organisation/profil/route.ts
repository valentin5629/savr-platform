import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/mon-organisation/profil
// PATCH /api/v1/gestionnaire/mon-organisation/profil
// Profil de SA propre organisation (§06.05 nav 8 → réutilise §06.04 §6).
// Filtre explicite `id = organisationId` : la RLS laisse aussi le gestionnaire
// lire les traiteurs intervenus sur ses lieux (org_gestionnaire_traiteur_select),
// une lecture non filtrée renverrait plusieurs lignes.
// Colonnes = colonnes RÉELLES de plateforme.organisations.
// Champs éditables (§06.05 §6 Bloc Organisation) : adresse, logo_url.
// Nom en lecture seule (modification via support) ; raison_sociale et siret
// réservés à l'Admin.

const PROFIL_COLUMNS =
  'id, nom, raison_sociale, siret, adresse, email_principal, telephone, logo_url';

const EDITABLE_FIELDS = new Set(['adresse', 'logo_url']);

const ADRESSE_MAX = 500;
// Format des clés rendues par POST /gestionnaire/mon-organisation/logo
// (le bucket est vérifié à part : celui de l'environnement).
const LOGO_KEY = /^logos\/[0-9a-f-]{36}\.(png|jpg)$/;

function estCleLogo(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const bucket = process.env['R2_BUCKET_NAME'] || 'savr-dev';
  return (
    v.startsWith(`${bucket}/`) && LOGO_KEY.test(v.slice(bucket.length + 1))
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('organisations')
    .select(PROFIL_COLUMNS)
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();

  if (error)
    return serverError(error, 'gestionnaire.mon_organisation.profil.list');
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

  if ('adresse' in patch) {
    if (typeof patch.adresse !== 'string')
      return NextResponse.json({ error: 'Adresse invalide' }, { status: 422 });
    const adresse = patch.adresse.trim();
    if (adresse.length > ADRESSE_MAX)
      return NextResponse.json(
        { error: `Adresse trop longue (${ADRESSE_MAX} caractères maximum)` },
        { status: 422 },
      );
    patch.adresse = adresse === '' ? null : adresse;
  }
  // logo_url = uniquement une clé produite par POST /logo (défense en
  // profondeur sur ce chemin : une valeur libre ferait télécharger un autre
  // objet R2 dans la synthèse PDF via logoKeyToDataUri).
  if ('logo_url' in patch && !estCleLogo(patch.logo_url))
    return NextResponse.json({ error: 'Logo invalide' }, { status: 422 });

  const { data, error } = await supabase
    .from('organisations')
    .update(patch)
    .eq('id', auth.ctx.organisationId)
    .select(PROFIL_COLUMNS)
    .maybeSingle();

  if (error)
    return writeError(error, 'gestionnaire.mon_organisation.profil.update');
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}
