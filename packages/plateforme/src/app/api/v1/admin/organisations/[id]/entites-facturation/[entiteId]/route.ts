import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { verifySiret, isValidSiretFormat } from '@savr/shared/src/api/siret.js';
import { enqueueSiretRevalidation } from '@savr/shared/src/siret/revalidation.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';

// Modification d'une entité de facturation par l'équipe Savr (Val 2026-10-30).
// Mêmes règles que l'espace du manager traiteur (CDC §06.04 §6) : un SIRET
// changé est revérifié à l'INSEE, une seule entité par défaut. Écriture sous
// service_role : chaque requête porte `.eq('organisation_id', id)`, sans quoi un
// id deviné modifierait l'entité d'une autre organisation.

const SELECT_ENTITE =
  'id, raison_sociale, siret, tva_intracom, adresse_facturation, code_postal, ' +
  'ville, pays, email_facturation, contact_compta_nom, siret_verification, ' +
  'tva_verification, entite_par_defaut, actif, created_at';

const REQUIS = new Set([
  'raison_sociale',
  'adresse_facturation',
  'code_postal',
  'ville',
]);
const FACULTATIFS = new Set([
  'tva_intracom',
  'email_facturation',
  'contact_compta_nom',
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entiteId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id, entiteId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (REQUIS.has(k)) {
      if (!t)
        return NextResponse.json(
          {
            error: 'Raison sociale, adresse, code postal et ville sont requis.',
          },
          { status: 422 },
        );
      patch[k] = t;
    } else if (FACULTATIFS.has(k)) {
      patch[k] = t || null;
    }
  }

  const supabase = createAdminSupabaseClient();

  const { data: cible, error: lectureErr } = await supabase
    .from('entites_facturation')
    .select('id, siret')
    .eq('id', entiteId)
    .eq('organisation_id', id)
    .maybeSingle();
  if (lectureErr)
    return serverError(
      lectureErr,
      'admin.organisations.entites_facturation.read',
    );
  if (!cible)
    return NextResponse.json({ error: 'Entité non trouvée' }, { status: 404 });

  let verdict: 'verifie' | 'echec' | 'down' | null = null;
  const siret =
    typeof body.siret === 'string' ? body.siret.replace(/\s/g, '') : null;
  if (siret !== null && siret !== (cible as { siret: string }).siret) {
    if (!isValidSiretFormat(siret))
      return NextResponse.json(
        { error: 'SIRET invalide (14 chiffres attendus)' },
        { status: 422 },
      );
    const { data: doublon } = await supabase
      .from('entites_facturation')
      .select('id')
      .eq('siret', siret)
      .neq('id', entiteId)
      .maybeSingle();
    if (doublon)
      return NextResponse.json(
        { error: 'Ce SIRET est déjà rattaché à une entité de facturation.' },
        { status: 409 },
      );
    verdict = await verifySiret(siret);
    if (verdict === 'echec')
      return NextResponse.json(
        { error: 'SIRET inexistant ou entreprise inactive (INSEE).' },
        { status: 422 },
      );
    patch.siret = siret;
    patch.siret_verification = verdict === 'verifie' ? 'verifie' : 'en_attente';
    patch.siret_verifie_le =
      verdict === 'verifie' ? new Date().toISOString() : null;
  }

  if (body.entite_par_defaut === true) {
    await supabase
      .from('entites_facturation')
      .update({ entite_par_defaut: false })
      .eq('organisation_id', id)
      .eq('entite_par_defaut', true)
      .neq('id', entiteId);
    patch.entite_par_defaut = true;
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );

  const { data, error } = await supabase
    .from('entites_facturation')
    .update(patch)
    .eq('id', entiteId)
    .eq('organisation_id', id)
    .select(SELECT_ENTITE)
    .maybeSingle();
  if (error)
    return writeError(error, 'admin.organisations.entites_facturation.update');
  if (!data)
    return NextResponse.json({ error: 'Entité non trouvée' }, { status: 404 });

  if (verdict === 'down')
    await enqueueSiretRevalidation(supabase, entiteId).catch(() => null);

  return NextResponse.json({ data });
}
