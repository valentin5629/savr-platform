import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { parseCleLogo } from '@/lib/logo-key.js';
import { servirLogo } from '@/lib/logo-proxy.js';
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

  // Bucket applicatif + logos/<uuid>.(png|jpg) seulement (lib/logo-key.ts) :
  // une valeur héritée hors format ne fait télécharger aucun autre objet R2.
  const cle = parseCleLogo(data?.logo_url as string | null | undefined);
  if (!cle) return NextResponse.json({ error: 'Aucun logo' }, { status: 404 });

  return servirLogo(cle);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return uploadLogo(req);
}
