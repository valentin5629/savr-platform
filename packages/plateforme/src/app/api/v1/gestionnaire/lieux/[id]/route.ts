import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/lieux/[id]
// Fiche lieu via v_lieux_clients (masque commentaire_lieu, siren, email_gestionnaire, reference_citeo, commentaires_internes).
// Historique collectes + Top traiteurs 12 mois.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const { id } = await params;
  const supabase = createSupabaseServerClient();

  const { data: lieu, error } = await supabase
    .from('v_lieux_clients')
    .select(
      `id, nom, nom_alternatif, adresse_acces, code_postal, ville, region,
       latitude, longitude, type_vehicule_max, capacite_maximum, acces_office,
       stationnement, acces_details, contraintes_horaires, flux_autorises,
       volume_max_bacs, controle_acces_requis_default, photos_urls, actif`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!lieu)
    return NextResponse.json({ error: 'Lieu non trouvé' }, { status: 404 });

  // Historique collectes sur ce lieu (12 mois)
  const since12m = new Date();
  since12m.setMonth(since12m.getMonth() - 12);
  const sinceStr = since12m.toISOString().slice(0, 10);

  const { data: collectes } = await supabase
    .from('collectes')
    .select(
      `id, type, statut, date_collecte, taux_recyclage,
       evenements!inner(lieu_id, traiteur_operationnel_organisation_id,
         organisations!traiteur_operationnel_organisation_id(id, nom)),
       collecte_flux(poids_reel_kg)`,
    )
    .eq('statut', 'cloturee')
    .eq('evenements.lieu_id', id)
    .gte('date_collecte', sinceStr)
    .order('date_collecte', { ascending: false });

  // Top traiteurs sur ce lieu
  const traiteurMap = new Map<
    string,
    { nom: string; nb: number; tonnage: number }
  >();
  for (const c of collectes ?? []) {
    const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
    const orgs = (
      evt as unknown as { organisations?: { id: string; nom: string } }
    )?.organisations;
    if (!orgs) continue;
    const cur = traiteurMap.get(orgs.id) ?? {
      nom: orgs.nom,
      nb: 0,
      tonnage: 0,
    };
    cur.nb += 1;
    const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
    cur.tonnage += flux.reduce(
      (s, f) => s + ((f as { poids_reel_kg?: number }).poids_reel_kg ?? 0),
      0,
    );
    traiteurMap.set(orgs.id, cur);
  }
  const topTraiteurs = [...traiteurMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.nb - a.nb)
    .slice(0, 5);

  return NextResponse.json({
    data: { ...lieu, collectes: collectes ?? [], top_traiteurs: topTraiteurs },
  });
}
