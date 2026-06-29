import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  // Tarifs actifs : valide_du <= aujourd'hui ET (valide_jusqu_au IS NULL OR valide_jusqu_au >= aujourd'hui)
  const { data, error } = await supabase
    .from('tarifs_packs_ag')
    .select(
      'id, type_pack, credits, prix_unitaire_ht, montant_total_ht, mensualisable, nb_mensualites, valide_du, valide_jusqu_au',
    )
    .lte('valide_du', today)
    .or(`valide_jusqu_au.is.null,valide_jusqu_au.gte.${today}`)
    .order('type_pack');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Modification tarif = fermer ligne active + créer nouvelle (versioning)
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const {
    type_pack,
    credits,
    prix_unitaire_ht,
    mensualisable,
    nb_mensualites,
    valide_du,
  } = body as {
    type_pack?: string;
    credits?: number;
    prix_unitaire_ht?: number;
    mensualisable?: boolean;
    nb_mensualites?: number;
    valide_du?: string;
  };

  if (!type_pack || !credits || !prix_unitaire_ht || !valide_du) {
    return NextResponse.json(
      {
        error:
          'type_pack, credits, prix_unitaire_ht, valide_du sont obligatoires',
      },
      { status: 422 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  if (valide_du < today) {
    return NextResponse.json(
      { error: "valide_du doit être >= aujourd'hui" },
      { status: 422 },
    );
  }

  const montant_total_ht = Math.round(credits * prix_unitaire_ht * 100) / 100;
  const supabase = createAdminSupabaseClient();

  // Fermer la ligne active pour ce type_pack
  const veilleDePriseEffet = new Date(valide_du);
  veilleDePriseEffet.setDate(veilleDePriseEffet.getDate() - 1);
  const veilleStr = veilleDePriseEffet.toISOString().slice(0, 10);

  await supabase
    .from('tarifs_packs_ag')
    .update({ valide_jusqu_au: veilleStr })
    .eq('type_pack', type_pack)
    .is('valide_jusqu_au', null);

  const { data, error } = await supabase
    .from('tarifs_packs_ag')
    .insert({
      type_pack,
      credits,
      prix_unitaire_ht,
      montant_total_ht,
      mensualisable: mensualisable ?? false,
      nb_mensualites,
      valide_du,
    })
    .select('*')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });

  try {
    await supabase.from('audit_log').insert({
      table_name: 'tarifs_packs_ag',
      record_id: data.id,
      action: 'modification_tarif_pack',
      user_id: auth.ctx.userId,
      new_values: { type_pack, credits, prix_unitaire_ht, valide_du },
    });
  } catch {
    /* audit failure non-bloquante */
  }

  return NextResponse.json(data, { status: 201 });
}
