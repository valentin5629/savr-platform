import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { parseCleLogo } from '@/lib/logo-key.js';
import { servirLogo } from '@/lib/logo-proxy.js';

// GET /api/v1/gestionnaire/traiteurs/[id]/logo
// Proxy d'affichage du logo d'un traiteur tiers (§06.05 §5 : « Nom + logo » en
// liste et en fiche). `organisations.logo_url` porte une CLÉ R2 et non une URL
// publique depuis 20260919100000 — la poser dans le src d'une balise <img> ne
// peut donc rien afficher : ce proxy est le seul chemin de rendu.
//
// Périmètre : la clé est résolue DEPUIS la vue restreinte v_traiteurs_gestionnaire
// (20260921090000), jamais reçue en paramètre. Le prédicat de lignes de la vue
// (rôle gestionnaire_lieux + traiteur intervenu sur ses lieux) est donc le seul
// périmètre servi : un id hors périmètre ne rend aucune ligne → 404, sans que la
// route ait à le savoir. Aucune colonne de `organisations` n'est exposée au-delà
// du logo lui-même. Un `?key=` est ignoré : cette route ne lit que la base.

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('v_traiteurs_gestionnaire')
    .select('logo_url')
    .eq('id', id)
    .maybeSingle();
  if (error) return serverError(error, 'gestionnaire.traiteurs.logo.read');

  // Bucket applicatif + logos/<uuid>.(png|jpg) seulement (lib/logo-key.ts) : une
  // valeur héritée hors format ne fait télécharger aucun autre objet R2.
  const cle = parseCleLogo(data?.logo_url as string | null | undefined);
  if (!cle) return NextResponse.json({ error: 'Aucun logo' }, { status: 404 });

  return servirLogo(cle);
}
