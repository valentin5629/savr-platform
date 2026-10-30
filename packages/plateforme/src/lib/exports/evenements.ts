import {
  toCsv,
  formatDateFr,
  formatPoidsKg,
  type CsvColumn,
} from '@savr/shared/src/csv/index.js';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  type ExportContext,
  type ExportOutput,
  resolveTraiteurNoms,
  resolveRepas,
  sommePoidsFlux,
  lireParTranches,
  unwrap,
} from './shared.js';
import {
  espaceEvenementsDuRole,
  filtresListeEvenements,
  type RequeteFiltrable,
} from '@/lib/evenements/liste-evenements.js';

/** Requête filtrable et lisible par tranches (`lireParTranches`). */
type RequeteEvenements = RequeteFiltrable<RequeteEvenements> &
  ReturnType<Parameters<typeof lireParTranches>[0]>;
import { statutEvenementConsolide } from '@/lib/libelles/evenement.js';
import {
  typesEvenementDesCollectes,
  type CollecteTypee,
} from '@/lib/collectes/types-evenement-collectes.js';

// Export Événements — grain ÉVÉNEMENT (1 ligne = 1 événement, données agrégées).
// Colonnes FIGÉES par §12 §2. Servi par l'endpoint unifié (tous rôles autorisés,
// scopés par RLS).

const EVENEMENTS_SELECT = `id, nom_evenement, date_evenement, pax,
  traiteur_operationnel_organisation_id,
  lieux!lieu_id(nom),
  types_evenements!type_evenement_id(libelle),
  collectes(id, type, statut, date_collecte, heure_collecte, created_at,
    taux_recyclage, type_evenement:types_evenements!type_evenement_id(libelle),
    collecte_flux(poids_reel_kg))`;

interface CollecteAgg extends CollecteTypee {
  date_collecte: string | null;
  taux_recyclage: number | null;
  collecte_flux: { poids_reel_kg?: number | null }[];
}

export interface EvenementRow {
  date_evenement: string;
  nom_evenement: string;
  lieu: string;
  traiteur: string;
  type_evenement: string;
  taille_bracket: string;
  pax: number;
  nb_collectes_zd: number;
  nb_collectes_ag: number;
  tonnage_zd_kg: string;
  taux_recyclage_pct: number | '';
  repas_ag: number;
  statut_consolide: string;
  premiere_collecte: string;
  derniere_collecte: string;
}

function tailleBracket(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

const COLUMNS: CsvColumn<EvenementRow>[] = [
  { header: 'Date événement', value: (r) => formatDateFr(r.date_evenement) },
  { header: 'Nom événement', value: (r) => r.nom_evenement },
  { header: 'Lieu', value: (r) => r.lieu },
  { header: 'Traiteur', value: (r) => r.traiteur },
  { header: "Type d'événement", value: (r) => r.type_evenement },
  { header: 'Taille', value: (r) => r.taille_bracket },
  { header: 'Pax', value: (r) => r.pax },
  { header: 'Nb collectes ZD', value: (r) => r.nb_collectes_zd },
  { header: 'Nb collectes AG', value: (r) => r.nb_collectes_ag },
  { header: 'Tonnage ZD (kg)', value: (r) => r.tonnage_zd_kg },
  { header: 'Taux recyclage ZD (%)', value: (r) => r.taux_recyclage_pct },
  { header: 'Repas AG donnés', value: (r) => r.repas_ag },
  { header: 'Statut consolidé', value: (r) => r.statut_consolide },
  {
    header: 'Première collecte',
    value: (r) => formatDateFr(r.premiere_collecte),
  },
  {
    header: 'Dernière collecte',
    value: (r) => formatDateFr(r.derniere_collecte),
  },
];

/**
 * Transforme les événements (avec collectes imbriquées) en CSV. Résout les noms
 * de traiteur (vue whitelist) et les repas AG (helper C-1-safe) de façon
 * RLS-safe et uniforme pour tous les rôles.
 */
async function evenementsToCsv(
  supabase: SupabaseClient,
  evts: Record<string, unknown>[],
  isStaff = false,
): Promise<string> {
  const traiteurNoms = await resolveTraiteurNoms(
    supabase,
    evts.map(
      (e) => (e.traiteur_operationnel_organisation_id as string | null) ?? '',
    ),
  );

  const agCollecteIds: string[] = [];
  for (const e of evts) {
    const cs = (Array.isArray(e.collectes) ? e.collectes : []) as CollecteAgg[];
    for (const c of cs) if (c.type === 'anti_gaspi') agCollecteIds.push(c.id);
  }
  const repasMap = await resolveRepas(supabase, agCollecteIds, isStaff);

  const rows: EvenementRow[] = evts.map((e) => {
    const collectes = (
      Array.isArray(e.collectes) ? e.collectes : []
    ) as CollecteAgg[];
    const zd = collectes.filter((c) => c.type === 'zero_dechet');
    const ag = collectes.filter((c) => c.type === 'anti_gaspi');

    const tonnage = zd.reduce((s, c) => s + sommePoidsFlux(c.collecte_flux), 0);
    const repas = ag.reduce((s, c) => s + (repasMap.get(c.id) ?? 0), 0);

    // Taux de recyclage moyen pondéré par tonnage (ZD).
    let num = 0;
    let den = 0;
    for (const c of zd) {
      const poids = sommePoidsFlux(c.collecte_flux);
      if (c.taux_recyclage != null && poids > 0) {
        num += c.taux_recyclage * poids;
        den += poids;
      }
    }
    const tauxPct = den > 0 ? Math.round(num / den) : '';

    const dates = collectes
      .map((c) => c.date_collecte)
      .filter((d): d is string => !!d)
      .sort();

    const lieu = unwrap(e.lieux);
    const typeEvt = unwrap(e.types_evenements);
    const pax = (e.pax as number) ?? 0;

    return {
      date_evenement: (e.date_evenement as string) ?? '',
      nom_evenement: (e.nom_evenement as string) ?? '',
      lieu: (lieu.nom as string) ?? '',
      traiteur:
        traiteurNoms.get(e.traiteur_operationnel_organisation_id as string) ??
        '',
      // Types de SES COLLECTES (décision Val 2026-10-24, lot C1, Q2) ; la copie
      // de l'événement n'est qu'un repli.
      type_evenement:
        typesEvenementDesCollectes(
          collectes,
          (typeEvt.libelle as string | null) ?? null,
        ) ?? '',
      taille_bracket: tailleBracket(pax),
      pax,
      nb_collectes_zd: zd.length,
      nb_collectes_ag: ag.length,
      tonnage_zd_kg: formatPoidsKg(tonnage),
      taux_recyclage_pct: tauxPct,
      repas_ag: repas,
      statut_consolide: statutEvenementConsolide(collectes),
      premiere_collecte: dates[0] ?? '',
      derniere_collecte: dates[dates.length - 1] ?? '',
    };
  });

  return toCsv(rows, COLUMNS);
}

/**
 * Builder unifié : Événements scopés par RLS (tous rôles autorisés). Le
 * fichier reprend la sélection de la liste Événements (§12 §2) : mêmes
 * filtres, même écart des brouillons, sans tri d'écran ni page.
 */
export async function buildEvenementsExport(
  ctx: ExportContext,
  sp: URLSearchParams,
): Promise<ExportOutput> {
  const espace = espaceEvenementsDuRole(ctx.role);
  const filtres = espace ? filtresListeEvenements(espace, sp) : null;
  if (!filtres) {
    return {
      filenamePrefix: 'evenements',
      csv: await evenementsToCsv(ctx.supabase, [], ctx.isStaff),
    };
  }

  // Lecture par tranches : PostgREST plafonne une réponse à 1 000 lignes, le
  // fichier doit porter toute la sélection. `id` départage les ex æquo de date
  // d'une tranche à l'autre.
  const data = await lireParTranches<Record<string, unknown>>(() =>
    filtres.appliquer(
      ctx.supabase
        .from('evenements')
        .select(`${EVENEMENTS_SELECT}, ${filtres.embeds}`, { count: 'exact' })
        .order('date_evenement', { ascending: false })
        .order('id', { ascending: false }) as unknown as RequeteEvenements,
    ),
  );

  const csv = await evenementsToCsv(ctx.supabase, data, ctx.isStaff);
  return { filenamePrefix: 'evenements', csv };
}
