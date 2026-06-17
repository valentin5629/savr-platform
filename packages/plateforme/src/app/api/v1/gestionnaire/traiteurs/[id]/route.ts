import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/traiteurs/[id]
// Fiche traiteur non-commerciale : nom, logo, stats 12 mois sur les lieux de l'organisation.
// Champs exclus : email, téléphone, SIRET (§06.05).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const { id } = await params;
  const supabase = createSupabaseServerClient();

  // Périmètre lieux de l'organisation
  const { data: orgLieux } = await supabase
    .from('organisations_lieux')
    .select('lieu_id');
  const lieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);
  if (lieuIds.length === 0)
    return NextResponse.json({ error: 'Traiteur non trouvé' }, { status: 404 });

  // Infos non-commerciales du traiteur
  const { data: orga, error: orgaErr } = await supabase
    .from('organisations')
    .select('id, nom, logo_url, ville, description_activite')
    .eq('id', id)
    .eq('type', 'traiteur')
    .maybeSingle();

  if (orgaErr)
    return NextResponse.json({ error: orgaErr.message }, { status: 500 });

  const since12m = new Date();
  since12m.setMonth(since12m.getMonth() - 12);
  const sinceStr = since12m.toISOString().slice(0, 10);

  const { data: collectes } = await supabase
    .from('collectes')
    .select(
      `id, type, statut, date_collecte, taux_recyclage,
       evenements!inner(lieu_id, traiteur_operationnel_organisation_id),
       collecte_flux(poids_reel_kg),
       attributions_antgaspi(volume_repas_realise)`,
    )
    .eq('statut', 'cloturee')
    .eq('evenements.traiteur_operationnel_organisation_id', id)
    .in('evenements.lieu_id', lieuIds)
    .gte('date_collecte', sinceStr);

  let tonnage = 0,
    tauxNum = 0,
    tauxDen = 0,
    repas = 0,
    nbZd = 0,
    nbAg = 0;
  for (const c of collectes ?? []) {
    const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
    const t = flux.reduce(
      (s, f) => s + ((f as { poids_reel_kg?: number }).poids_reel_kg ?? 0),
      0,
    );
    if (c.type === 'zero_dechet') {
      nbZd++;
      tonnage += t;
      const taux = c.taux_recyclage as number | null;
      if (taux !== null && t > 0) {
        tauxNum += taux * t;
        tauxDen += t;
      }
    } else {
      nbAg++;
      const attrs = Array.isArray(c.attributions_antgaspi)
        ? c.attributions_antgaspi
        : [];
      repas += attrs.reduce(
        (s, a) =>
          s +
          ((a as { volume_repas_realise?: number }).volume_repas_realise ?? 0),
        0,
      );
    }
  }

  if (!orga)
    return NextResponse.json({ error: 'Traiteur non trouvé' }, { status: 404 });

  return NextResponse.json({
    data: {
      id: orga.id,
      nom: orga.nom,
      logo_url: orga.logo_url ?? null,
      ville: orga.ville ?? null,
      description_activite: orga.description_activite ?? null,
      stats_12m: {
        nb_collectes_zd: nbZd,
        nb_collectes_ag: nbAg,
        tonnage_zd_kg: tonnage,
        taux_recyclage_moyen: tauxDen > 0 ? tauxNum / tauxDen : null,
        repas_donnes: repas,
      },
    },
  });
}
