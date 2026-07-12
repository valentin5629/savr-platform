import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireUser } from '@/lib/api-auth.js';
import {
  previousWindow,
  FACTEURS_CO2_DEFAUT,
  type FacteursCo2,
} from '@/lib/dashboards/cockpit-derive.js';

const ALLOWED_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
] as const;

// Clés d'équivalence ADEME dans parametres_co2_divers (héros CO₂ Cockpit R24).
const EQUIV_KEYS = {
  km_voiture: 'equiv_km_voiture_kgco2',
  repas_boeuf: 'equiv_repas_boeuf_kgco2',
  foyer_kwh: 'equiv_foyer_elec_kwh_an',
} as const;

/**
 * Lit les 3 facteurs d'équivalence CO₂ (globaux, ADEME, éditables Admin) via le
 * client service_role : la table parametres_co2_divers est en RLS ops/admin only,
 * un traiteur ne peut pas la lire. Best-effort — toute erreur (clé service_role
 * absente en test, RLS, réseau) retombe sur les constantes ADEME (jamais bloquant).
 */
async function lireFacteursCo2(): Promise<FacteursCo2> {
  const facteurs: FacteursCo2 = { ...FACTEURS_CO2_DEFAUT };
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from('parametres_co2_divers')
      .select('cle, valeur')
      .in('cle', Object.values(EQUIV_KEYS));
    if (Array.isArray(data)) {
      const byCle = new Map(
        data.map((r) => [
          (r as { cle: string }).cle,
          Number((r as { valeur: number }).valeur),
        ]),
      );
      const km = byCle.get(EQUIV_KEYS.km_voiture);
      const boeuf = byCle.get(EQUIV_KEYS.repas_boeuf);
      const foyer = byCle.get(EQUIV_KEYS.foyer_kwh);
      if (Number.isFinite(km) && km! > 0) facteurs.km_voiture = km!;
      if (Number.isFinite(boeuf) && boeuf! > 0) facteurs.repas_boeuf = boeuf!;
      if (Number.isFinite(foyer) && foyer! > 0) facteurs.foyer_kwh = foyer!;
    }
  } catch {
    // conserve les défauts ADEME
  }
  return facteurs;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Les vues KPI vivent dans le schéma `plateforme` (cf. api-auth.ts) : sans
      // cette option supabase-js cible `public.*` (Accept-Profile: public) →
      // PGRST205 « table not found » → 500 → dashboard vide.
      db: { schema: 'plateforme' },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const type = searchParams.get('type');
  const isAgence = auth.ctx.role === 'agence';

  // §06.11 diff #7 — l'agence n'a pas de KPI « Marge générée ». marge_zd_ht est
  // retiré de la réponse côté serveur (pas un masquage CSS) : aucune donnée de
  // marge ne transite pour le rôle agence, ni sur la période courante ni sur N-1.
  const stripMarge = (rows: unknown[] | null): unknown[] =>
    isAgence
      ? (rows ?? []).map((r) => {
          const { marge_zd_ht: _omit, ...rest } = r as Record<string, unknown>;
          void _omit;
          return rest;
        })
      : (rows ?? []);

  // Requête v_kpi_traiteur pour une fenêtre donnée (défense en profondeur : scope
  // org côté serveur EN PLUS de la RLS security_invoker).
  const runFenetre = async (
    f: string | null,
    t: string | null,
  ): Promise<{ rows: unknown[] | null; error: string | null }> => {
    let query = supabase
      .from('v_kpi_traiteur')
      .select('*')
      .eq('organisation_id', auth.ctx.organisationId);
    if (f) query = query.gte('mois', f);
    if (t) query = query.lte('mois', t);
    if (type === 'zero_dechet' || type === 'anti_gaspi') {
      query = query.eq('type_collecte', type);
    }
    query = query.order('mois', { ascending: false });
    const { data, error } = await query;
    return { rows: data, error: error ? error.message : null };
  };

  const current = await runFenetre(from, to);
  if (current.error)
    return NextResponse.json({ error: current.error }, { status: 500 });

  // tarif_refacture_pax_zd (BL-P3-02) — alimente le tooltip formule du KPI Marge.
  // Lecture traiteur autorisée (CDC §04 l.928 ; écriture Admin only). Non exposé à
  // l'agence (pas de carte Marge côté agence), au même titre que marge_zd_ht.
  let tarif_refacture_pax_zd: number | null = null;
  if (!isAgence) {
    const { data: org } = await supabase
      .from('organisations')
      .select('tarif_refacture_pax_zd')
      .eq('id', auth.ctx.organisationId)
      .maybeSingle();
    tarif_refacture_pax_zd =
      (org?.tarif_refacture_pax_zd as number | null) ?? null;
  }

  // Facteurs d'équivalence CO₂ (héros Cockpit R24) — best-effort, jamais bloquant.
  const facteurs_co2 = await lireFacteursCo2();

  // N-1 (Cockpit R24) : variation vs période précédente équivalente. Déclenché
  // UNIQUEMENT via ?compare=n1 (la page traiteur) → les autres consommateurs
  // (agence, guards de schéma) gardent le comportement mono-requête historique.
  let previous: unknown[] | undefined;
  if (searchParams.get('compare') === 'n1') {
    const win = previousWindow(from, to);
    if (win) {
      const prev = await runFenetre(win.from, win.to);
      if (!prev.error) previous = stripMarge(prev.rows);
    }
  }

  return NextResponse.json(
    {
      data: stripMarge(current.rows),
      tarif_refacture_pax_zd,
      facteurs_co2,
      ...(previous !== undefined ? { previous } : {}),
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
