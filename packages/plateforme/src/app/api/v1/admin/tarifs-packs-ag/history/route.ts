import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

/**
 * Historique de la grille tarifaire AG publique pour un `type_pack` (CDC §9
 * l.726-729). L'historique = les VERSIONS de la ligne (versionnement
 * close-then-create de tarifs_packs_ag) — PAS une table _history dédiée (le DDL
 * cible n'en prévoit aucune ; garde-fou 1). « Modifié par » / « Date modif »
 * proviennent de l'audit_log (action=modification_tarif_pack) écrit à chaque
 * enregistrement.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const type_pack = new URL(req.url).searchParams.get('type_pack');
  if (!type_pack) {
    return NextResponse.json(
      { error: 'type_pack est obligatoire' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Toutes les versions (actives + fermées) du type_pack, antéchronologique.
  const { data: versions, error } = await supabase
    .from('tarifs_packs_ag')
    .select(
      'id, type_pack, credits, prix_unitaire_ht, montant_total_ht, mensualisable, nb_mensualites, valide_du, valide_jusqu_au',
    )
    .eq('type_pack', type_pack)
    .order('valide_du', { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = versions ?? [];
  const ids = rows.map((v) => v.id);

  // audit_log → auteur + date de la modification, par ligne créée.
  const auditByRecord = new Map<
    string,
    { user_id: string | null; at: string }
  >();
  if (ids.length > 0) {
    const { data: audits } = await supabase
      .from('audit_log')
      .select('record_id, user_id, created_at')
      .eq('table_name', 'tarifs_packs_ag')
      .in('record_id', ids)
      .order('created_at', { ascending: false });
    for (const a of audits ?? []) {
      if (a.record_id && !auditByRecord.has(a.record_id)) {
        auditByRecord.set(a.record_id, {
          user_id: a.user_id,
          at: a.created_at,
        });
      }
    }
  }

  const userIds = [
    ...new Set(
      [...auditByRecord.values()].map((a) => a.user_id).filter(Boolean),
    ),
  ] as string[];
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, prenom, nom')
      .in('id', userIds);
    for (const u of users ?? []) {
      nameById.set(u.id, `${u.prenom ?? ''} ${u.nom ?? ''}`.trim());
    }
  }

  const enriched = rows.map((v) => {
    const audit = auditByRecord.get(v.id);
    return {
      ...v,
      modifie_par_nom: audit?.user_id
        ? (nameById.get(audit.user_id) ?? audit.user_id)
        : '—',
      date_modif: audit?.at ?? v.valide_du,
    };
  });

  return NextResponse.json({ data: enriched });
}
