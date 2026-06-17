import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/evenements/export-csv
// Export CSV grain événement (1 ligne = 1 événement) — §06.05 §2 / §12 §1.6.
// Mêmes filtres que la liste événements. UTF-8, séparateur ";".
// Colonnes : date, nom, lieu, traiteur, type_evt, taille_bracket, pax,
//            nb_collectes_zd, nb_collectes_ag, tonnage_zd_kg, taux_recyclage_pct,
//            repas_ag, statut_consolide, premiere_collecte, derniere_collecte.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const lieuIds = sp.getAll('lieu_ids[]');

  const { data: orgLieux } = await supabase
    .from('organisations_lieux')
    .select('lieu_id');
  const perimetreLieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);
  const lieuFilter =
    lieuIds.length > 0
      ? lieuIds.filter((id) => perimetreLieuIds.includes(id))
      : perimetreLieuIds;

  if (lieuFilter.length === 0) {
    return csvResponse([]);
  }

  let q = supabase
    .from('evenements')
    .select(
      `id, nom_evenement, date_evenement, pax,
       lieux!lieu_id(nom),
       organisations!traiteur_operationnel_organisation_id(nom),
       types_evenements!type_evenement_id(libelle),
       collectes(type, statut, date_collecte, taux_recyclage,
         collecte_flux(poids_reel_kg),
         attributions_antgaspi(volume_repas_realise))`,
    )
    .in('lieu_id', lieuFilter)
    .order('date_evenement', { ascending: false });

  if (from) q = q.gte('date_evenement', from);
  if (to) q = q.lte('date_evenement', to);

  const { data: evts, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (evts ?? []).map((e) => {
    const collectes = (Array.isArray(e.collectes) ? e.collectes : []) as {
      type: string;
      statut: string;
      date_collecte: string;
      taux_recyclage: number | null;
      collecte_flux: { poids_reel_kg?: number }[];
      attributions_antgaspi: { volume_repas_realise?: number }[];
    }[];
    const zdC = collectes.filter((c) => c.type === 'zero_dechet');
    const agC = collectes.filter((c) => c.type === 'anti_gaspi');

    const tonnage = zdC.reduce(
      (s, c) =>
        s +
        (c.collecte_flux ?? []).reduce(
          (sf, f) => sf + (f.poids_reel_kg ?? 0),
          0,
        ),
      0,
    );
    const repas = agC.reduce(
      (s, c) =>
        s +
        (c.attributions_antgaspi ?? []).reduce(
          (sa, a) => sa + (a.volume_repas_realise ?? 0),
          0,
        ),
      0,
    );

    // Taux de recyclage moyen pondéré des collectes ZD (pondéré par tonnage)
    let tauxNum = 0,
      tauxDen = 0;
    for (const c of zdC) {
      const poids = (c.collecte_flux ?? []).reduce(
        (s, f) => s + (f.poids_reel_kg ?? 0),
        0,
      );
      if (c.taux_recyclage != null && poids > 0) {
        tauxNum += c.taux_recyclage * poids;
        tauxDen += poids;
      }
    }
    const taux_recyclage_pct =
      tauxDen > 0 ? Math.round(tauxNum / tauxDen) : null;

    const dates = collectes
      .map((c) => c.date_collecte)
      .filter(Boolean)
      .sort();

    const consolide = statutConsolide(collectes);
    const lieu = e.lieux as { nom?: string } | null;
    const traiteur = e.organisations as { nom?: string } | null;
    const typeEvt = e.types_evenements as { libelle?: string } | null;
    const pax = (e.pax as number) ?? 0;

    return {
      date_evenement: e.date_evenement ?? '',
      nom_evenement: e.nom_evenement ?? '',
      lieu: lieu?.nom ?? '',
      traiteur: traiteur?.nom ?? '',
      type_evenement: typeEvt?.libelle ?? '',
      taille_bracket: tailleBracket(pax),
      pax,
      nb_collectes_zd: zdC.length,
      nb_collectes_ag: agC.length,
      tonnage_zd_kg: tonnage,
      taux_recyclage_pct: taux_recyclage_pct ?? '',
      repas_ag: repas,
      statut_consolide: consolide,
      premiere_collecte: dates[0] ?? '',
      derniere_collecte: dates[dates.length - 1] ?? '',
    };
  });

  return csvResponse(rows);
}

function csvResponse(rows: Record<string, string | number>[]): NextResponse {
  const HEADERS = [
    'Date événement',
    'Nom événement',
    'Lieu',
    'Traiteur',
    "Type d'événement",
    'Taille',
    'Pax',
    'Nb collectes ZD',
    'Nb collectes AG',
    'Tonnage ZD (kg)',
    'Taux recyclage ZD (%)',
    'Repas AG donnés',
    'Statut consolidé',
    'Première collecte',
    'Dernière collecte',
  ];
  const KEYS: (keyof (typeof rows)[0])[] = [
    'date_evenement',
    'nom_evenement',
    'lieu',
    'traiteur',
    'type_evenement',
    'taille_bracket',
    'pax',
    'nb_collectes_zd',
    'nb_collectes_ag',
    'tonnage_zd_kg',
    'taux_recyclage_pct',
    'repas_ag',
    'statut_consolide',
    'premiere_collecte',
    'derniere_collecte',
  ];

  const lines = [
    HEADERS.join(';'),
    ...rows.map((r) =>
      KEYS.map((k) => String(r[k] ?? '').replace(/;/g, ',')).join(';'),
    ),
  ];
  const csv = '﻿' + lines.join('\r\n'); // BOM UTF-8

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="evenements-savr.csv"',
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

function statutConsolide(
  collectes: { statut: string }[],
): 'En cours' | 'Terminé' | 'Annulé' {
  if (collectes.length === 0) return 'En cours';
  if (collectes.every((c) => c.statut === 'annulee')) return 'Annulé';
  const terminaux = new Set(['realisee', 'cloturee', 'annulee']);
  const tousTerminaux = collectes.every((c) => terminaux.has(c.statut));
  const auMoinsUnRealise = collectes.some(
    (c) => c.statut === 'realisee' || c.statut === 'cloturee',
  );
  if (tousTerminaux && auMoinsUnRealise) return 'Terminé';
  return 'En cours';
}
