import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';
import { jourParis } from '@savr/shared/src/temps/index.js';

// Valeurs acceptées par chk_tarif_type_pack (migration 20260615200000). La base
// reste l'autorité ; ce garde-fou applicatif n'est là que pour rendre un 422
// lisible plutôt que le texte d'une violation de contrainte.
const TYPES_PACK = ['unitaire', 'pack_10', 'pack_30', 'pack_60'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const today = jourParis();

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

  // `prix_unitaire_ht` est testé sur sa PRÉSENCE, pas sur sa véracité : 0 est une
  // valeur légitime (chk_tarif_pack_ag_prix_positif borne à >= 0), c'est le garde
  // de signe plus bas qui tranche.
  if (
    !type_pack ||
    !credits ||
    prix_unitaire_ht === undefined ||
    prix_unitaire_ht === null ||
    !valide_du
  ) {
    return NextResponse.json(
      {
        error:
          'type_pack, credits, prix_unitaire_ht, valide_du sont obligatoires',
      },
      { status: 422 },
    );
  }

  // Le corps est du JSON arbitraire : les types de la destructuration ne sont
  // que déclaratifs. Sans ces gardes, `credits: -5` / `prix_unitaire_ht: -100`
  // partaient tels quels en base (les CHECK legacy ayant été emportés par le
  // DROP COLUMN de convergence — recollés par la migration 20260914160000).
  if (!TYPES_PACK.includes(type_pack)) {
    return NextResponse.json(
      { error: `type_pack doit être l'un de : ${TYPES_PACK.join(', ')}` },
      { status: 422 },
    );
  }
  if (!Number.isInteger(credits) || credits <= 0) {
    return NextResponse.json(
      { error: 'credits doit être un entier strictement positif' },
      { status: 422 },
    );
  }
  if (!Number.isFinite(prix_unitaire_ht) || prix_unitaire_ht < 0) {
    return NextResponse.json(
      { error: 'prix_unitaire_ht doit être un nombre positif ou nul' },
      { status: 422 },
    );
  }
  if (typeof valide_du !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valide_du)) {
    return NextResponse.json(
      { error: 'valide_du doit être une date au format YYYY-MM-DD' },
      { status: 422 },
    );
  }

  const today = jourParis();
  if (valide_du < today) {
    return NextResponse.json(
      { error: "valide_du doit être >= aujourd'hui" },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Versionnement ATOMIQUE (migration 20260914160000) : la RPC ferme la ligne en
  // vigueur à la veille de la prise d'effet ET insère la nouvelle version dans la
  // même transaction. En deux appels PostgREST, un INSERT en échec laissait le
  // type_pack sans aucune ligne ouverte — plus aucun tarif AG actif, en silence.
  // montant_total_ht est calculé en base (credits × prix_unitaire_ht).
  const { data, error } = await supabase.rpc('rpc_creer_tarif_pack_ag', {
    p_type_pack: type_pack,
    p_credits: credits,
    p_prix_unitaire_ht: prix_unitaire_ht,
    p_valide_du: valide_du,
    p_mensualisable: mensualisable ?? false,
    p_nb_mensualites: nb_mensualites,
  });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });

  const tarif = data as { id?: string } | null;

  try {
    await supabase.from('audit_log').insert({
      table_name: 'tarifs_packs_ag',
      record_id: tarif?.id,
      action: 'modification_tarif_pack',
      user_id: auth.ctx.userId,
      new_values: { type_pack, credits, prix_unitaire_ht, valide_du },
    });
  } catch {
    /* audit failure non-bloquante */
  }

  return NextResponse.json(data, { status: 201 });
}
