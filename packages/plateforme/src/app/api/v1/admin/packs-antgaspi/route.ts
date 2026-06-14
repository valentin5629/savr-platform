import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const organisation_id = searchParams.get('organisation_id');
  const statut = searchParams.get('statut');

  let query = supabase
    .from('packs_antgaspi')
    .select(
      'id, organisation_id, organisations(raison_sociale), type_pack, credits_initiaux, credits_consommes, statut, mode_facturation, commentaires, created_at',
    )
    .order('created_at', { ascending: false });

  if (organisation_id) query = query.eq('organisation_id', organisation_id);
  if (statut) query = query.eq('statut', statut);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  // Idempotency-Key obligatoire
  const idempotencyKey = req.headers.get('idempotency-key');
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: 'Idempotency-Key manquante' },
      { status: 422 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const {
    organisation_id,
    type_pack,
    credits_initiaux,
    prix_unitaire_ht,
    montant_total_ht,
    mode_facturation,
    commentaires,
  } = body as {
    organisation_id?: string;
    type_pack?: string;
    credits_initiaux?: number;
    prix_unitaire_ht?: number;
    montant_total_ht?: number;
    mode_facturation?: string;
    commentaires?: string;
  };

  if (
    !organisation_id ||
    !type_pack ||
    !credits_initiaux ||
    !mode_facturation
  ) {
    return NextResponse.json(
      {
        error:
          'organisation_id, type_pack, credits_initiaux, mode_facturation sont obligatoires',
      },
      { status: 422 },
    );
  }

  const TYPES_VALIDES = [
    'unitaire',
    'pack_10',
    'pack_30',
    'pack_60',
    'personnalise',
  ];
  if (!TYPES_VALIDES.includes(type_pack)) {
    return NextResponse.json({ error: 'type_pack invalide' }, { status: 422 });
  }

  const MODES_VALIDES = ['globale_achat', 'par_collecte'];
  if (!MODES_VALIDES.includes(mode_facturation)) {
    return NextResponse.json(
      { error: 'mode_facturation invalide' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Idempotence — vérifier si un pack avec cette clé existe déjà
  const { data: existant } = await supabase
    .from('packs_antgaspi')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existant) return NextResponse.json(existant, { status: 200 });

  // Vérifier qu'aucun pack actif n'existe pour cette organisation (index unique DB + vérif applicative)
  const { data: packActif } = await supabase
    .from('packs_antgaspi')
    .select('id, type_pack, credits_initiaux, credits_consommes')
    .eq('organisation_id', organisation_id)
    .eq('statut', 'actif')
    .maybeSingle();

  if (packActif) {
    const restants =
      (packActif.credits_initiaux as number) -
      (packActif.credits_consommes as number);
    return NextResponse.json(
      {
        error: `Cette organisation a déjà un pack actif (${packActif.type_pack} — ${restants} crédits restants). Annulez-le avant d'en créer un nouveau.`,
        pack_actif: packActif,
      },
      { status: 409 },
    );
  }

  const { data: pack, error } = await supabase
    .from('packs_antgaspi')
    .insert({
      organisation_id,
      type_pack,
      credits_initiaux,
      credits_consommes: 0,
      statut: 'actif',
      prix_unitaire_ht,
      montant_total_ht,
      mode_facturation,
      commentaires,
      idempotency_key: idempotencyKey,
      cree_par_user_id: auth.ctx.userId,
    })
    .select('*')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });

  // Audit log
  try {
    await supabase.from('audit_log').insert({
      table_name: 'packs_antgaspi',
      record_id: pack.id,
      action: 'creation_pack',
      user_id: auth.ctx.userId,
      new_values: {
        organisation_id,
        type_pack,
        credits_initiaux,
        mode_facturation,
      },
    });
  } catch {
    /* audit failure non-bloquante */
  }

  // Brouillon FPK pour achat global (mode_facturation=globale_achat)
  if (mode_facturation === 'globale_achat' && montant_total_ht) {
    try {
      const { data: ef } = await supabase
        .from('entites_facturation')
        .select('id')
        .eq('organisation_id', organisation_id)
        .eq('est_principale', true)
        .maybeSingle();

      if (ef) {
        const { data: facture } = await supabase
          .from('factures')
          .insert({
            organisation_id,
            entite_facturation_id: ef.id,
            pack_antgaspi_id: pack.id,
            type: 'achat_pack_antigaspi',
            mode_facturation: 'globale_pack',
            statut: 'brouillon',
            montant_ht: montant_total_ht,
            taux_tva: 20,
            montant_tva: (montant_total_ht as number) * 0.2,
            montant_ttc: (montant_total_ht as number) * 1.2,
          })
          .select('id')
          .single();

        if (facture) {
          await supabase.from('factures_collectes').insert({
            facture_id: facture.id,
            collecte_id: null,
            designation: `Pack AG ${type_pack} — ${credits_initiaux} crédits`,
            quantite: 1,
            taux_tva: 20,
            tarif_applique_source: 'ag_unitaire',
            montant_ligne_ht: montant_total_ht,
            montant_ht: montant_total_ht,
          });
        }
      }
    } catch {
      /* brouillon FPK non-bloquant — visible dès que l'entité de facturation est renseignée */
    }
  }

  return NextResponse.json(pack, { status: 201 });
}
