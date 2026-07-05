import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { verifySiret, isValidSiretFormat } from '@savr/shared/src/api/siret.js';
import { enqueueSiretRevalidation } from '@savr/shared/src/siret/revalidation.js';

// CDC §06.04 §6 (l.661) — Entités de facturation (multi-SIRET) : ajout/modif/
// suppression par le MANAGER. Chaque SIRET déclenche une re-vérification INSEE
// (mêmes règles que l'onboarding ONB-01/02 : echec→422, down→async, verifie→ok).
// Lecture own-org : manager + commercial (RLS ef_select_own_org).
// Écriture : manager only (RLS ef_manager_write, own-org scoped).

const READ_ROLES: ClientRole[] = ['traiteur_manager', 'traiteur_commercial'];
const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];

const SELECT_COLS =
  'id, raison_sociale, siret, tva_intracom, adresse_facturation, code_postal, ' +
  'ville, pays, email_facturation, contact_compta_nom, siret_verification, ' +
  'tva_verification, entite_par_defaut, actif, created_at';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, READ_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('entites_facturation')
    .select(SELECT_COLS)
    .eq('organisation_id', auth.ctx.organisationId)
    .order('entite_par_defaut', { ascending: false })
    .order('created_at', { ascending: true });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const raison_sociale = String(body.raison_sociale ?? '').trim();
  const siret = String(body.siret ?? '').trim();
  const adresse_facturation = String(body.adresse_facturation ?? '').trim();
  const code_postal = String(body.code_postal ?? '').trim();
  const ville = String(body.ville ?? '').trim();
  if (
    !raison_sociale ||
    !siret ||
    !adresse_facturation ||
    !code_postal ||
    !ville
  )
    return NextResponse.json(
      {
        error:
          'raison_sociale, siret, adresse_facturation, code_postal et ville sont requis',
      },
      { status: 422 },
    );
  if (!isValidSiretFormat(siret))
    return NextResponse.json(
      { error: 'SIRET invalide (14 chiffres attendus)' },
      { status: 422 },
    );

  const supabase = createSupabaseServerClient();
  const admin = createAdminSupabaseClient();

  // Doublon SIRET (index UNIQUE partiel uniq_entites_facturation_siret). Pré-check
  // via service_role : le doublon peut appartenir à une AUTRE org (invisible en RLS).
  const { data: doublon } = await admin
    .from('entites_facturation')
    .select('id')
    .eq('siret', siret)
    .maybeSingle();
  if (doublon)
    return NextResponse.json(
      { error: 'Ce SIRET est déjà rattaché à une entité de facturation.' },
      { status: 409 },
    );

  // Re-vérification SIRET synchrone (ONB-01) : echec → 422 bloquant.
  const verdict = await verifySiret(siret);
  if (verdict === 'echec')
    return NextResponse.json(
      { error: 'SIRET inexistant ou entreprise inactive (INSEE).' },
      { status: 422 },
    );
  const siret_verification = verdict === 'verifie' ? 'verifie' : 'en_attente';

  const entite_par_defaut = body.entite_par_defaut === true;
  // Un seul entite_par_defaut actif par org (index partiel) : dé-flag les autres.
  if (entite_par_defaut) {
    await supabase
      .from('entites_facturation')
      .update({ entite_par_defaut: false })
      .eq('organisation_id', auth.ctx.organisationId)
      .eq('entite_par_defaut', true);
  }

  const { data, error } = await supabase
    .from('entites_facturation')
    .insert({
      organisation_id: auth.ctx.organisationId,
      raison_sociale,
      siret,
      tva_intracom: body.tva_intracom ? String(body.tva_intracom).trim() : null,
      adresse_facturation,
      code_postal,
      ville,
      email_facturation: body.email_facturation
        ? String(body.email_facturation).trim()
        : null,
      contact_compta_nom: body.contact_compta_nom
        ? String(body.contact_compta_nom).trim()
        : null,
      entite_par_defaut,
      siret_verification,
      siret_verifie_le:
        siret_verification === 'verifie' ? new Date().toISOString() : null,
    })
    .select(SELECT_COLS)
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });

  // INSEE injoignable → planifier la revalidation async (3 paliers 15min/1h/24h).
  if (verdict === 'down' && data)
    await enqueueSiretRevalidation(
      admin,
      (data as unknown as { id: string }).id,
    ).catch(() => null);

  return NextResponse.json({ data }, { status: 201 });
}
