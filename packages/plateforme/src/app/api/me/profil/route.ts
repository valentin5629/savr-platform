import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import {
  readJsonBody,
  serverError,
  writeError,
  withApiTrace,
} from '@/lib/api-helpers.js';

// GET /api/me/profil — données d'identité de l'utilisateur authentifié (self, RLS),
// pour pré-remplir le formulaire de rectification.
async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, prenom, nom, email, telephone, poste, role')
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
// prenom/nom = NOT NULL (valeur non vide requise) ; telephone et poste =
// nullables (chaîne vide → null pour permettre l'effacement), avec leur longueur
// maximale. CDC §06.04 §7 « Mon profil » ; poste = champ libre sans effet sur les
// droits (Val 2026-11-01), borné à 100 caractères aussi par la table.
const CHAMPS_NON_VIDES = new Set(['prenom', 'nom']);
const CHAMPS_NULLABLES: Record<string, number> = { telephone: 30, poste: 100 };

// PATCH /api/me/profil
// RGPD Art.16 (§15 §3.3 l.106) — rectification self-service des données d'identité
// (transverse, tous rôles). RLS `usr_self_update` applique le périmètre self ;
// l'allowlist serveur empêche toute écriture hors {prenom, nom, telephone, poste}.
async function patchHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;

  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if ('error' in parsed) return parsed.error;

  const patch: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (typeof v !== 'string') continue;
    const val = v.trim();
    if (CHAMPS_NON_VIDES.has(k) && val !== '') {
      patch[k] = val.slice(0, 200);
    } else if (Object.hasOwn(CHAMPS_NULLABLES, k)) {
      patch[k] = val === '' ? null : val.slice(0, CHAMPS_NULLABLES[k]);
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        error: 'Aucun champ modifiable fourni (prenom, nom, telephone, poste)',
      },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', auth.ctx.userId)
    .select('id, prenom, nom, email, telephone, poste')
    .single();

  if (error) return writeError(error, 'me.profil.update');
  return NextResponse.json({ data });
}

export const GET = withApiTrace(getHandler);
export const PATCH = withApiTrace(patchHandler);
