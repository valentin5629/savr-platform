import { NextRequest, NextResponse } from 'next/server';
import { getObject } from '@savr/shared/src/r2/upload.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { uploadLogo } from '@/lib/logo-upload.js';

// CDC §06.05 §6 Bloc Organisation — Logo (upload / remplacement).
// POST : upload R2, renvoie la clé "bucket/logos/..." que la page écrit ensuite
// dans `organisations.logo_url` via PATCH /profil (même flux que l'espace
// traiteur, route traiteur/mon-organisation/logo). Upload : lib/logo-upload.ts.
// GET : proxy d'affichage (R2 non public) du logo de SA propre organisation
// uniquement. La clé est lue en base, jamais reçue du client : aucun moyen de
// lire un autre objet R2 par cette route.

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('organisations')
    .select('logo_url')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();
  if (error)
    return serverError(error, 'gestionnaire.mon_organisation.logo.read');

  const storageKey = (data?.logo_url as string | null | undefined) ?? '';
  const slash = storageKey.indexOf('/');
  const key = slash > 0 ? storageKey.slice(slash + 1) : '';
  // On ne sert que des logos (valeur héritée hors format → 404).
  if (!key.startsWith('logos/'))
    return NextResponse.json({ error: 'Aucun logo' }, { status: 404 });

  try {
    const { body, contentType } = await getObject(
      storageKey.slice(0, slash),
      key,
    );
    return new NextResponse(Buffer.from(body), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Logo introuvable' }, { status: 404 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return uploadLogo(req);
}
