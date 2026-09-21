import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { statutCollecteDisplay } from '@/lib/statut-collecte-labels';
import { serverError } from '@/lib/api-helpers.js';
import {
  distanceKm,
  type Coordonnees,
} from '@/lib/attribution-ag/associations-par-distance.js';

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

  // Événement + collectes + documents. Colonnes alignées sur §04 (G7) :
  // - associations : latitude/longitude lues pour CALCULER la distance au lieu
  //   (§06.05 §3 « Pour AG », arbitrage Val 2026-09-21 option b). Il n'existe
  //   aucune colonne `associations.distance_km` — rien n'est stocké — et les
  //   coordonnées ne sortent PAS de la route (cf. attributionAvecDistance) ;
  // - bordereaux_savr : `numero` (pas numero_bordereau), PDF via pdf_fichier_id →
  //   téléchargement par /api/v1/registre/bordereaux/:id/download ;
  // - rapports_rse : pas de colonne statut.
  const { data: evt, error } = await supabase
    .from('evenements')
    .select(
      `id, nom_evenement, date_evenement, pax, nom_client_organisateur,
       logo_client_organisateur_url, organisation_id,
       lieux!lieu_id(id, nom, adresse_acces, ville, code_postal, latitude, longitude,
         type_vehicule_max, acces_office, stationnement),
       organisations:v_traiteurs_gestionnaire!traiteur_operationnel_organisation_id(id, nom, logo_url),
       types_evenements!type_evenement_id(id, libelle),
       collectes(
         id, type, statut, date_collecte, heure_collecte, taux_recyclage, realisee_at,
         collecte_flux(poids_reel_kg, flux_dechets!flux_id(code, nom)),
         attributions_antgaspi(
           id, volume_repas_realise,
           associations!association_id(nom, ville, latitude, longitude)
         ),
         bordereaux_savr(id, numero, statut),
         rapports_rse(id, pdf_url),
         attestations_don(id, statut, pdf_url,
           associations!association_id(nom))
       )`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) return serverError(error, 'gestionnaire.evenements.get');
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

  // Point de référence de la distance AG = le lieu de l'événement (§06.05 §3).
  const lieu = unEmbed<Coordonnees>((evt as { lieux?: unknown }).lieux);
  const coordsLieu: Coordonnees = {
    latitude: lieu?.latitude ?? null,
    longitude: lieu?.longitude ?? null,
  };

  // Mapping statut affichage collecte (F2)
  const collectes = (Array.isArray(evt.collectes) ? evt.collectes : []).map(
    (c) => {
      // Embed to-one (collecte_id UNIQUE) → PostgREST renvoie un OBJET : le
      // normaliser en tableau pour que la page (attributions_antgaspi: Attribution[])
      // affiche bien le bloc association/repas via `.length`/`.map`.
      const a = (c as { attributions_antgaspi?: unknown })
        .attributions_antgaspi;
      // Idem bordereaux_savr (collecte_id UNIQUE → to-one, OBJET PostgREST).
      const b = (c as { bordereaux_savr?: unknown }).bordereaux_savr;
      return {
        ...c,
        attributions_antgaspi: (Array.isArray(a) ? a : a ? [a] : []).map(
          (att) => attributionAvecDistance(att, coordsLieu),
        ),
        bordereaux_savr: Array.isArray(b) ? b : b ? [b] : [],
        statut_affiche: mapStatut(c.statut as string),
      };
    },
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

// Embed PostgREST to-one (FK sortante) = OBJET ; normalisé par prudence.
function unEmbed<T>(v: unknown): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return v as T;
}

interface AssociationEmbed extends Coordonnees {
  nom?: string | null;
  ville?: string | null;
}

// Distance association ↔ lieu de l'événement — §06.05 §3 « Pour AG » (arbitrage
// Val 2026-09-21, option b : la distance EST restituée au gestionnaire, par
// exception à la correction 2026-07-07 qui ne vaut que pour la LISTE Associations).
// Orthodromie haversine calculée à la volée par `distanceKm`, LA MÊME fonction
// que la liste d'attribution AG (alignée sur fn_calculer_algo_attribution_ag) :
// pas de 2e formule, pas de colonne stockée. Arrondi à l'entier le plus proche
// (« 12 km » côté UI) ; null si l'association OU le lieu n'est pas géocodé
// (« — » côté UI, jamais 0, jamais d'estimation).
// Les coordonnées de l'association ne sortent pas de la route : la réponse est
// construite en liste blanche (nom + ville), le gestionnaire n'obtient donc rien
// de plus qu'avant hormis la distance.
function attributionAvecDistance(att: unknown, coordsLieu: Coordonnees) {
  const asso = unEmbed<AssociationEmbed>(
    (att as { associations?: unknown }).associations,
  );
  const d = asso
    ? distanceKm(coordsLieu, {
        latitude: asso.latitude ?? null,
        longitude: asso.longitude ?? null,
      })
    : null;
  return {
    ...(att as Record<string, unknown>),
    associations: asso
      ? { nom: asso.nom ?? null, ville: asso.ville ?? null }
      : null,
    distance_km: d == null ? null : Math.round(d),
  };
}

// Mapping affichage statut collecte — vue client (décision Val 2026-06-30,
// supersède F2 2026-06-07). Source unique : statutCollecteDisplay (libellés).
function mapStatut(statut: string): string {
  return statutCollecteDisplay(statut, 'client').label;
}
