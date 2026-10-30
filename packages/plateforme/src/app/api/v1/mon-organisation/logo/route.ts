import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { parseCleLogo } from '@/lib/logo-key.js';
import { servirLogo } from '@/lib/logo-proxy.js';

// Logo de SA propre organisation, affiché en avatar dans l'en-tête de tous les
// espaces clients (Val 2026-10-30). Proxy d'affichage (R2 n'est pas public) :
// la clé est lue en base sur l'organisation du jeton, jamais reçue du client,
// donc aucun moyen de lire un autre objet R2 par cette route.

const ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
  'client_organisateur',
];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('organisations')
    .select('logo_url')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();
  if (error) return serverError(error, 'mon_organisation.logo.read');

  // Bucket applicatif + logos/<uuid>.(png|jpg) seulement (lib/logo-key.ts).
  const cle = parseCleLogo(data?.logo_url as string | null | undefined);
  if (!cle) return NextResponse.json({ error: 'Aucun logo' }, { status: 404 });

  return servirLogo(cle);
}
