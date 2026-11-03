import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  appliquerPerimetreRevenus,
  lirePerimetreRevenus,
  lireTout,
  LOT_LECTURE,
} from '@/lib/dashboards/revenus-admin.js';
import {
  montantsPrestation,
  round2,
  STATUTS_REVENUS,
  type PackPrix,
} from '@/lib/montant-prestation.js';

/**
 * GET /api/v1/admin/dashboard/revenus-mensuels — histogramme du Bloc 2
 * « Revenus » du Dashboard Admin (§11 §1.1), par mois et par type.
 *
 * Décision Val 2026-11-03 : tout vient des collectes, facturées ou non.
 *   - collectes programmées et réalisées (`STATUTS_REVENUS`), mois de
 *     `date_collecte` ;
 *   - montant = montant de la prestation (`lib/montant-prestation`) : ZD au
 *     tarif de la grille moins la remise, AG au prix du pack débité, sinon au
 *     tarif unitaire moins la remise.
 * Filtres lieu et organisation : `lib/dashboards/revenus-admin` (Val 2026-10-30).
 * Période `from`/`to` sur la date du jour (premier mois partiel si la fenêtre
 * ne commence pas le 1er, accepté au CDC).
 */

interface Ligne {
  mois: string;
  type_collecte: 'zero_dechet' | 'anti_gaspi';
  nb_collectes: number;
  montant_ht: number;
}

interface CollecteRow {
  type: string;
  pax: number | null;
  date_collecte: string;
  evenements:
    | { organisation_id: string | null; lieu_id: string | null }
    | { organisation_id: string | null; lieu_id: string | null }[]
    | null;
  packs_antgaspi: PackPrix | PackPrix[] | null;
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
          `type, pax, date_collecte,
           evenements!inner(organisation_id, lieu_id),
           packs_antgaspi(prix_unitaire_ht, montant_total_ht, credits_initiaux)`,
        )
        .in('statut', [...STATUTS_REVENUS])
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

  const lignes = collectes.rows as CollecteRow[];
  let montants: (number | null)[];
  try {
    montants = await montantsPrestation(
      supabase,
      lignes.map((c) => {
        const ev = premier(c.evenements);
        return {
          type: c.type,
          pax: c.pax,
          date_collecte: c.date_collecte,
          organisation_id: ev?.organisation_id ?? null,
          lieu_id: ev?.lieu_id ?? null,
          pack: premier(c.packs_antgaspi),
        };
      }),
    );
  } catch (e) {
    return serverError(e, 'admin.dashboard.revenus_mensuels.montants');
  }

  const parCle = new Map<string, Ligne>();
  const ligne = (mois: string, type: Ligne['type_collecte']): Ligne => {
    const cle = `${mois}|${type}`;
    let l = parCle.get(cle);
    if (!l) {
      l = {
        mois,
        type_collecte: type,
        nb_collectes: 0,
        montant_ht: 0,
      };
      parCle.set(cle, l);
    }
    return l;
  };

  for (const [i, c] of lignes.entries()) {
    if (c.type !== 'zero_dechet' && c.type !== 'anti_gaspi') continue;
    const l = ligne(moisDe(c.date_collecte), c.type);
    l.nb_collectes += 1;
    l.montant_ht += montants[i] ?? 0;
  }

  // Sommes de montants décimaux : arrondies au centime avant la réponse.
  for (const l of parCle.values()) l.montant_ht = round2(l.montant_ht);

  const kpi = [...parCle.values()].sort((a, b) =>
    a.mois === b.mois
      ? a.type_collecte.localeCompare(b.type_collecte)
      : a.mois.localeCompare(b.mois),
  );
  return NextResponse.json({ kpi });
}
