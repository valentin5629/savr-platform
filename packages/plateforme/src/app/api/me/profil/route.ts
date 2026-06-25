import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { readJsonBody, serverError, writeError } from '@/lib/api-helpers.js';

// GET /api/me/profil — données d'identité de l'utilisateur authentifié (self, RLS),
// pour pré-remplir le formulaire de rectification.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, prenom, nom, email, role')
    .eq('id', auth.ctx.userId)
    .maybeSingle();

  if (error) return serverError(error, 'me.profil.get');
  if (!data) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }
  return NextResponse.json({ data });
}

// Allowlist stricte : rectification self-service limitée aux PII d'identité.
// email/role/organisation_id NON éditables ici (l'email est une PII gérée par le
// flux Auth ; role/organisation_id = escalade de privilège).
const CHAMPS_EDITABLES = new Set(['prenom', 'nom']);

// PATCH /api/me/profil
// RGPD Art.16 (§15 §3.3 l.106) — rectification self-service des données d'identité
// (transverse, tous rôles). RLS `usr_self_update` applique le périmètre self ;
// l'allowlist serveur empêche toute écriture hors {prenom, nom}.
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;

  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if ('error' in parsed) return parsed.error;

  const patch: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (CHAMPS_EDITABLES.has(k) && typeof v === 'string' && v.trim() !== '') {
      patch[k] = v.trim().slice(0, 200);
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni (prenom, nom)' },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', auth.ctx.userId)
    .select('id, prenom, nom, email')
    .single();

  if (error) return writeError(error, 'me.profil.update');
  return NextResponse.json({ data });
}
