import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  appliquerPerimetreRevenus,
  coutCollecteAg,
  lirePerimetreRevenus,
  lireTout,
  LOT_LECTURE,
  type PackEmbed,
} from '@/lib/dashboards/revenus-admin.js';

/**
 * GET /api/v1/admin/dashboard/revenus-mensuels — histogramme du Bloc 2
 * « Revenus » du Dashboard Admin (§11 §1.1), par mois et par type.
 *
 * Règles de `v_kpi_admin`, recalculées ici pour pouvoir filtrer par lieu et
 * par organisation (décision Val 2026-10-30) :
 *   - nb collectes : `collectes` hors annulee/brouillon, mois de `date_collecte` ;
 *   - montant ZD : lignes `factures_collectes` des factures ZD et de leurs
 *     avoirs émis ou payés (avoirs en négatif), mois de `date_emission`.
 *     La vue somme les factures entières : même total sans filtre (mesuré sur
 *     savr-dev le 2026-10-30, 104 factures, aucune sans ligne, aucun avoir), mais
 *     une facture mensuelle couvre plusieurs lieux, d'où le passage par ses
 *     lignes. Écart voulu : un avoir est stocké en négatif, que la vue inverse
 *     une seconde fois (`SUM(-f.montant_ht)`, il y compte en positif) ; ici il
 *     est soustrait ;
 *   - montant AG : CA économique, coût par collecte du pack × collectes AG
 *     réalisées ou clôturées, mois de `date_collecte`.
 * Période `from`/`to` sur la date du jour (premier mois partiel si la fenêtre
 * ne commence pas le 1er, accepté au CDC).
 */

interface Ligne {
  mois: string;
  type_collecte: 'zero_dechet' | 'anti_gaspi';
  nb_collectes: number;
  montant_factures_ht: number;
}

interface CollecteRow {
  type: string;
  statut: string;
  date_collecte: string;
  packs_antgaspi: PackEmbed | PackEmbed[] | null;
}

interface LigneFactureRow {
  montant_ht: number | null;
  factures:
    | { date_emission: string | null }
    | { date_emission: string | null }[]
    | null;
}

function premier<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function moisDe(jour: string): string {
  return `${jour.slice(0, 7)}-01`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const from =
    sp.get('from') ||
    jourParis(new Date(now.getFullYear(), now.getMonth() - 11, 1));
  const to = sp.get('to') || jourParis(now);

  const { perimetre, error: errPerimetre } = await lirePerimetreRevenus(
    supabase,
    sp,
  );
  if (errPerimetre)
    return serverError(
      errPerimetre,
      'admin.dashboard.revenus_mensuels.filtres',
    );
  if (perimetre.vide) return NextResponse.json({ kpi: [] });

  const collectes = await lireTout((offset) =>
    appliquerPerimetreRevenus(
      supabase
        .from('collectes')
        .select(
          `type, statut, date_collecte,
           evenements!inner(id),
           packs_antgaspi(prix_unitaire_ht, montant_total_ht, credits_initiaux)`,
        )
        .not('statut', 'in', '(annulee,brouillon)')
        .gte('date_collecte', from)
        .lte('date_collecte', to),
      perimetre,
      'evenements',
    )
      // Ordre stable : sans lui, la pagination par range peut doubler ou
      // sauter des lignes au-delà de 1000.
      .order('id')
      .range(offset, offset + LOT_LECTURE - 1),
  );
  if (collectes.error)
    return serverError(
      collectes.error,
      'admin.dashboard.revenus_mensuels.collectes',
    );

  const lignesFactures = await lireTout((offset) =>
    appliquerPerimetreRevenus(
      supabase
        .from('factures_collectes')
        .select(
          `montant_ht,
           factures!inner(statut, type, date_emission),
           collectes!inner(type, evenements!inner(id))`,
        )
        .in('factures.statut', ['emise', 'payee'])
        .in('factures.type', ['zero_dechet', 'avoir'])
        .gte('factures.date_emission', from)
        .lte('factures.date_emission', to)
        .eq('collectes.type', 'zero_dechet'),
      perimetre,
      'collectes.evenements',
    )
      // Ordre stable : sans lui, la pagination par range peut doubler ou
      // sauter des lignes au-delà de 1000.
      .order('id')
      .range(offset, offset + LOT_LECTURE - 1),
  );
  if (lignesFactures.error)
    return serverError(
      lignesFactures.error,
      'admin.dashboard.revenus_mensuels.factures',
    );

  const parCle = new Map<string, Ligne>();
  const ligne = (mois: string, type: Ligne['type_collecte']): Ligne => {
    const cle = `${mois}|${type}`;
    let l = parCle.get(cle);
    if (!l) {
      l = {
        mois,
        type_collecte: type,
        nb_collectes: 0,
        montant_factures_ht: 0,
      };
      parCle.set(cle, l);
    }
    return l;
  };

  for (const c of collectes.rows as CollecteRow[]) {
    if (c.type !== 'zero_dechet' && c.type !== 'anti_gaspi') continue;
    const l = ligne(moisDe(c.date_collecte), c.type);
    l.nb_collectes += 1;
    if (
      c.type === 'anti_gaspi' &&
      (c.statut === 'realisee' || c.statut === 'cloturee')
    )
      l.montant_factures_ht += coutCollecteAg(premier(c.packs_antgaspi));
  }

  for (const r of lignesFactures.rows as LigneFactureRow[]) {
    const date = premier(r.factures)?.date_emission;
    if (!date) continue;
    ligne(moisDe(date), 'zero_dechet').montant_factures_ht += r.montant_ht ?? 0;
  }

  const kpi = [...parCle.values()].sort((a, b) =>
    a.mois === b.mois
      ? a.type_collecte.localeCompare(b.type_collecte)
      : a.mois.localeCompare(b.mois),
  );
  return NextResponse.json({ kpi });
}
