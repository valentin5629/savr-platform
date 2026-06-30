import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { statutCollecteDisplay } from '@/lib/statut-collecte-labels';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/evenements/[id]
// Détail événement en lecture seule — §06.05 §2 Détail événement.
// Inclut : en-tête, blocs collectes (pesées ZD + attributions AG), documents.
// déchets labo estimés via f_dechets_labo_estimes (SECURITY DEFINER — coefficient jamais exposé).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createSupabaseServerClient();

  // Événement + collectes + documents
  const { data: evt, error } = await supabase
    .from('evenements')
    .select(
      `id, nom_evenement, date_evenement, pax, nom_client_organisateur,
       logo_client_organisateur_url, organisation_id,
       lieux!lieu_id(id, nom, adresse_acces, ville, code_postal, latitude, longitude,
         type_vehicule_max, acces_office, stationnement),
       organisations!traiteur_operationnel_organisation_id(id, nom, logo_url),
       types_evenements!type_evenement_id(id, libelle),
       collectes(
         id, type, statut, date_collecte, heure_collecte, taux_recyclage, realisee_at,
         collecte_flux(poids_reel_kg, flux_dechets!flux_id(code, nom)),
         attributions_antgaspi(
           id, volume_repas_realise,
           associations!association_id(nom, ville, distance_km)
         ),
         bordereaux_savr(id, numero_bordereau, statut, pdf_url),
         rapports_rse(id, statut, pdf_url),
         attestations_don(id, statut, pdf_url,
           associations!association_id(nom))
       )`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!evt)
    return NextResponse.json(
      { error: 'Événement non trouvé' },
      { status: 404 },
    );

  // Déchets labo estimés (SECURITY DEFINER — ne retourne que les kg)
  const { data: labRes } = await supabase.rpc('f_dechets_labo_estimes', {
    p_evenement_id: id,
  });
  const dechetsLaboKg = labRes as number | null;

  const pax = (evt.pax as number) ?? 0;
  const bracket = tailleBracket(pax);

  // Mapping statut affichage collecte (F2)
  const collectes = (Array.isArray(evt.collectes) ? evt.collectes : []).map(
    (c) => ({
      ...c,
      statut_affiche: mapStatut(c.statut as string),
    }),
  );

  return NextResponse.json({
    data: {
      ...evt,
      taille_bracket: bracket,
      dechets_labo_kg: dechetsLaboKg,
      collectes,
    },
  });
}

function tailleBracket(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

// Mapping affichage statut collecte — vue client (décision Val 2026-06-30,
// supersède F2 2026-06-07). Source unique : statutCollecteDisplay (libellés).
function mapStatut(statut: string): string {
  return statutCollecteDisplay(statut, 'client').label;
}
