import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { verifySiret, isValidSiretFormat } from '@savr/shared/src/api/siret.js';
import { enqueueSiretRevalidation } from '@savr/shared/src/siret/revalidation.js';
import { requireStaff } from '@/lib/api-auth.js';
import { writeError } from '@/lib/api-helpers.js';

// Ajout d'une entité de facturation par l'équipe Savr, depuis la fiche
// organisation (Val 2026-10-30). Mêmes règles que l'espace du manager traiteur
// (CDC §06.04 §6) : SIRET au format, unique, vérifié à l'INSEE (échec → 422,
// INSEE injoignable → revalidation planifiée), une seule entité par défaut.
// Écriture sous service_role : `organisation_id` vient de l'URL, jamais du corps.

const SELECT_ENTITE =
  'id, raison_sociale, siret, tva_intracom, adresse_facturation, code_postal, ' +
  'ville, pays, email_facturation, contact_compta_nom, siret_verification, ' +
  'tva_verification, entite_par_defaut, actif, created_at';

function texteOuNull(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const raison_sociale = String(body.raison_sociale ?? '').trim();
  const siret = String(body.siret ?? '').replace(/\s/g, '');
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
          'Raison sociale, SIRET, adresse, code postal et ville sont requis.',
      },
      { status: 422 },
    );
  if (!isValidSiretFormat(siret))
    return NextResponse.json(
      { error: 'SIRET invalide (14 chiffres attendus)' },
      { status: 422 },
    );

  const supabase = createAdminSupabaseClient();

  const { data: doublon } = await supabase
    .from('entites_facturation')
    .select('id')
    .eq('siret', siret)
    .maybeSingle();
  if (doublon)
    return NextResponse.json(
      { error: 'Ce SIRET est déjà rattaché à une entité de facturation.' },
      { status: 409 },
    );

  const verdict = await verifySiret(siret);
  if (verdict === 'echec')
    return NextResponse.json(
      { error: 'SIRET inexistant ou entreprise inactive (INSEE).' },
      { status: 422 },
    );
  const siret_verification = verdict === 'verifie' ? 'verifie' : 'en_attente';

  const entite_par_defaut = body.entite_par_defaut === true;
  if (entite_par_defaut) {
    // L'index unique impose de libérer le drapeau AVANT l'INSERT ; une erreur
    // ici arrête tout, sans création.
    const { error: defautErr } = await supabase
      .from('entites_facturation')
      .update({ entite_par_defaut: false })
      .eq('organisation_id', id)
      .eq('entite_par_defaut', true);
    if (defautErr)
      return writeError(
        defautErr,
        'admin.organisations.entites_facturation.defaut',
      );
  }

  const { data, error } = await supabase
    .from('entites_facturation')
    .insert({
      organisation_id: id,
      raison_sociale,
      siret,
      tva_intracom: texteOuNull(body.tva_intracom),
      adresse_facturation,
      code_postal,
      ville,
      email_facturation: texteOuNull(body.email_facturation),
      contact_compta_nom: texteOuNull(body.contact_compta_nom),
      entite_par_defaut,
      siret_verification,
      siret_verifie_le:
        siret_verification === 'verifie' ? new Date().toISOString() : null,
    })
    .select(SELECT_ENTITE)
    .maybeSingle();

  if (error) {
    if (error.code === '23503')
      return NextResponse.json(
        { error: 'Organisation non trouvée' },
        { status: 404 },
      );
    return writeError(error, 'admin.organisations.entites_facturation.create');
  }

  if (data)
    await supabase.from('audit_log').insert({
      table_name: 'entites_facturation',
      record_id: (data as unknown as { id: string }).id,
      action: 'INSERT',
      user_id: auth.ctx.userId,
      old_values: null,
      new_values: data,
    });

  if (verdict === 'down' && data)
    await enqueueSiretRevalidation(
      supabase,
      (data as unknown as { id: string }).id,
    ).catch(() => null);

  return NextResponse.json({ data }, { status: 201 });
}
