import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/traiteurs
// Traiteurs intervenus sur les lieux de l'organisation (fenêtre 24 mois — indépendante du filtre période).
// Fiche limitée : nom + logo, pas d'email/téléphone/SIRET.
// Colonnes : nb collectes 12 mois, tonnage 12 mois, taux recyclage moyen pondéré, repas AG 12 mois.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const supabase = createSupabaseServerClient();

  const { data: orgLieux } = await supabase
    .from('organisations_lieux')
    .select('lieu_id');
  const lieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);
  if (lieuIds.length === 0) return NextResponse.json({ data: [] });

  // Fenêtre 24 mois (fixe, indépendante du filtre période)
  const since24m = new Date();
  since24m.setMonth(since24m.getMonth() - 24);
  const since24mStr = since24m.toISOString().slice(0, 10);

  const since12m = new Date();
  since12m.setMonth(since12m.getMonth() - 12);
  const since12mStr = since12m.toISOString().slice(0, 10);

  const { data: collectes, error } = await supabase
    .from('collectes')
    .select(
      `id, type, statut, date_collecte, taux_recyclage,
       evenements!inner(lieu_id, traiteur_operationnel_organisation_id,
         lieux!lieu_id(id, nom),
         organisations!traiteur_operationnel_organisation_id(id, nom, logo_url)),
       collecte_flux(poids_reel_kg),
       attributions_antgaspi(volume_repas_realise)`,
    )
    .eq('statut', 'cloturee')
    .in('evenements.lieu_id', lieuIds)
    .gte('date_collecte', since24mStr);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Agréger par traiteur. lieux = Map lieu_id → nom (colonne « Lieux d'intervention »
  // §06.05 §5 l.432 : liste des lieux où le traiteur est intervenu).
  const byTraiteur = new Map<
    string,
    {
      nom: string;
      logo_url: string | null;
      nb12: number;
      tonnage12: number;
      tauxNum: number;
      tauxDen: number;
      repas12: number;
      lieux: Map<string, string>;
    }
  >();

  for (const c of collectes ?? []) {
    const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
    const orgs = (
      evt as unknown as {
        organisations?: { id: string; nom: string; logo_url?: string };
        lieu_id?: string;
      }
    )?.organisations;
    if (!orgs) continue;

    const lieuId = (evt as { lieu_id?: string })?.lieu_id ?? '';
    const lieuEmbed = (
      evt as unknown as {
        lieux?: { id?: string; nom?: string } | { id?: string; nom?: string }[];
      }
    )?.lieux;
    const lieuObj = Array.isArray(lieuEmbed) ? lieuEmbed[0] : lieuEmbed;
    const cur = byTraiteur.get(orgs.id) ?? {
      nom: orgs.nom,
      logo_url: orgs.logo_url ?? null,
      nb12: 0,
      tonnage12: 0,
      tauxNum: 0,
      tauxDen: 0,
      repas12: 0,
      lieux: new Map<string, string>(),
    };
    if (lieuId) cur.lieux.set(lieuId, lieuObj?.nom ?? lieuId);

    const in12m = (c.date_collecte as string) >= since12mStr;
    if (in12m) {
      cur.nb12 += 1;
      const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
      const tonnage = flux.reduce(
        (s, f) => s + ((f as { poids_reel_kg?: number }).poids_reel_kg ?? 0),
        0,
      );
      if (c.type === 'zero_dechet') {
        cur.tonnage12 += tonnage;
        const taux = c.taux_recyclage as number | null;
        if (taux !== null && tonnage > 0) {
          cur.tauxNum += taux * tonnage;
          cur.tauxDen += tonnage;
        }
      }
      const attrs = Array.isArray(c.attributions_antgaspi)
        ? c.attributions_antgaspi
        : [];
      cur.repas12 += attrs.reduce(
        (s, a) =>
          s +
          ((a as { volume_repas_realise?: number }).volume_repas_realise ?? 0),
        0,
      );
    }
    byTraiteur.set(orgs.id, cur);
  }

  const rows = [...byTraiteur.entries()].map(([id, v]) => ({
    id,
    nom: v.nom,
    logo_url: v.logo_url,
    nb_collectes_12m: v.nb12,
    tonnage_12m_kg: v.tonnage12,
    taux_recyclage_moyen: v.tauxDen > 0 ? v.tauxNum / v.tauxDen : null,
    repas_donnes_12m: v.repas12,
    lieux_intervention: [...v.lieux.entries()].map(([lid, nom]) => ({
      id: lid,
      nom,
    })),
  }));

  return NextResponse.json({ data: rows });
}
