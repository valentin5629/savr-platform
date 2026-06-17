import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ORGANISATEUR_ROLES: ClientRole[] = ['client_organisateur'];

// GET /api/v1/organisateur/collectes — liste des collectes des événements du
// client organisateur (§11 §7, lecture seule). La RLS (col_select → f_collecte_visible)
// scope sur evenements.client_organisateur_organisation_id ; on re-scope côté serveur
// (défense en profondeur) via evenements!inner. Filtres : type (onglet ZD/AG), période.
// Colonnes §11 §7 « date, nom, lieu, traiteur, pax, repas ». Le nom du traiteur passe
// par la vue whitelist v_referentiel_traiteurs (RLS organisations = self-only, A-4) ;
// les repas détournés (AG) par le helper C-1-safe f_volume_repas_realise.
// Aucune donnée financière exposée (pas de marge, pas de facture).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ORGANISATEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  let query = supabase
    .from('collectes')
    .select(
      `id, type, statut, date_collecte, heure_collecte, taux_recyclage,
       co2_induit_kg, co2_evite_kg, co2_net_kg, energie_primaire_evitee_kwh,
       evenements!inner(
         id, client_organisateur_organisation_id, traiteur_operationnel_organisation_id,
         nom_evenement, pax,
         lieux!lieu_id(id, nom, code_postal, ville)
       )`,
    )
    .eq(
      'evenements.client_organisateur_organisation_id',
      auth.ctx.organisationId,
    )
    .order('date_collecte', { ascending: false });

  if (type === 'zero_dechet' || type === 'anti_gaspi') {
    query = query.eq('type', type);
  }
  if (from) query = query.gte('date_collecte', from);
  if (to) query = query.lte('date_collecte', to);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Résolution du nom du traiteur opérationnel via la vue whitelist (RLS self-only
  // sur organisations sinon). Une seule requête .in().
  const evtOf = (r: Record<string, unknown>): Record<string, unknown> => {
    const e = r.evenements as
      | Record<string, unknown>
      | Record<string, unknown>[];
    return Array.isArray(e) ? (e[0] ?? {}) : (e ?? {});
  };
  const traiteurIds = [
    ...new Set(
      rows
        .map(
          (r) =>
            evtOf(r).traiteur_operationnel_organisation_id as string | null,
        )
        .filter((v): v is string => !!v),
    ),
  ];
  const traiteurNoms = new Map<string, string>();
  if (traiteurIds.length > 0) {
    const { data: traiteurs } = await supabase
      .from('v_referentiel_traiteurs')
      .select('id, nom, raison_sociale')
      .in('id', traiteurIds);
    for (const t of (traiteurs ?? []) as Record<string, unknown>[]) {
      traiteurNoms.set(t.id as string, (t.raison_sociale ?? t.nom) as string);
    }
  }

  // Repas détournés (AG) — helper C-1-safe, uniquement pour les collectes anti_gaspi.
  const repasParCollecte = new Map<string, number>();
  const agIds = rows
    .filter((r) => r.type === 'anti_gaspi')
    .map((r) => r.id as string);
  if (agIds.length > 0) {
    await Promise.all(
      agIds.map(async (id) => {
        const { data: v } = await supabase.rpc('f_volume_repas_realise', {
          p_collecte_id: id,
        });
        if (v != null) repasParCollecte.set(id, Number(v));
      }),
    );
  }

  const enriched = rows.map((r) => ({
    ...r,
    traiteur_nom:
      traiteurNoms.get(
        evtOf(r).traiteur_operationnel_organisation_id as string,
      ) ?? null,
    repas_donnes: repasParCollecte.get(r.id as string) ?? null,
  }));

  return NextResponse.json({ data: enriched });
}
