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

// Forfait transport collecte (parametres_co2_divers) — méthode de calcul CO₂.
const FORFAIT_KEYS = {
  km: 'km_collecte_aller_retour',
  fe_camion: 'fe_camion_benne_kg_km',
} as const;

/** Variables du calcul CO₂ (forfait transport + facteurs d'émission par flux),
 *  affichées dans la modale « méthode de calcul » du KPI CO₂ évité (retour Val). */
export interface Co2Methode {
  forfait: { km: number; fe_camion: number };
  flux: {
    code: string;
    nom: string;
    fe_evite: number;
    fe_induit: number;
    energie: number;
  }[];
}

/**
 * Lit les variables de calcul CO₂ (forfait transport + facteurs par flux) via le
 * client service_role (tables RLS ops/admin). Best-effort : toute erreur retombe
 * sur les constantes ADEME du trigger m4_3 (jamais bloquant pour l'affichage).
 */
async function lireMethodeCo2(): Promise<Co2Methode> {
  const methode: Co2Methode = { forfait: { km: 50, fe_camion: 2.1 }, flux: [] };
  try {
    const admin = createAdminSupabaseClient();
    const { data: div } = await admin
      .from('parametres_co2_divers')
      .select('cle, valeur')
      .in('cle', Object.values(FORFAIT_KEYS));
    if (Array.isArray(div)) {
      const byCle = new Map(
        div.map((r) => [
          (r as { cle: string }).cle,
          Number((r as { valeur: number }).valeur),
        ]),
      );
      const km = byCle.get(FORFAIT_KEYS.km);
      const fe = byCle.get(FORFAIT_KEYS.fe_camion);
      if (Number.isFinite(km) && km! > 0) methode.forfait.km = km!;
      if (Number.isFinite(fe) && fe! > 0) methode.forfait.fe_camion = fe!;
    }
    const { data: fc } = await admin
      .from('parametres_facteurs_co2')
      .select(
        'code_flux, nom_flux, fe_evite_kg_t, fe_induit_kg_t, energie_primaire_evitee_kwh_t',
      )
      .eq('actif', true);
    if (Array.isArray(fc)) {
      methode.flux = fc.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          code: String(row.code_flux),
          nom: String(row.nom_flux),
          fe_evite: Number(row.fe_evite_kg_t),
          fe_induit: Number(row.fe_induit_kg_t),
          energie: Number(row.energie_primaire_evitee_kwh_t),
        };
      });
    }
  } catch {
    // conserve les défauts ADEME (jamais bloquant)
  }
  return methode;
}

/**
 * Lit les 3 facteurs d'équivalence CO₂ (globaux, ADEME, éditables Admin) via le
 * client service_role : la table parametres_co2_divers est en RLS ops/admin only,
 * un traiteur ne peut pas la lire. Best-effort — toute erreur (clé service_role
 * absente en test, RLS, réseau) retombe sur les constantes ADEME (jamais bloquant).
 */
// Cache process des 3 facteurs d'équivalence CO₂ (constantes ADEME globales,
// éditables Admin mais quasi immuables). Sans lui, CHAQUE chargement de dashboard
// crée un client service_role + une requête. TTL court : une modif Admin se
// propage en < 5 min (et par instance serverless). Partagé entre tous les
// traiteurs/agences car les facteurs sont globaux, pas par organisation.
let _facteursCo2Cache: { at: number; val: FacteursCo2 } | null = null;
const FACTEURS_CO2_TTL_MS = 5 * 60_000;

async function lireFacteursCo2(): Promise<FacteursCo2> {
  if (
    _facteursCo2Cache &&
    Date.now() - _facteursCo2Cache.at < FACTEURS_CO2_TTL_MS
  ) {
    return _facteursCo2Cache.val;
  }
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
    // Ne met en cache que les lectures réussies (une erreur → réessai au prochain
    // appel plutôt que de figer les défauts ADEME pendant 5 min).
    _facteursCo2Cache = { at: Date.now(), val: facteurs };
  } catch {
    // conserve les défauts ADEME (non mis en cache)
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

  // N-1 (Cockpit R24) : variation vs période précédente équivalente, déclenchée
  // UNIQUEMENT via ?compare=n1 (la page traiteur). previousWindow rend une fenêtre
  // CONTIGUË et strictement antérieure à `from` → on interroge la vue UNE seule
  // fois sur [N-1 → courante] puis on découpe en JS, au lieu de 2 requêtes de vue
  // en série (la vue est la requête la plus lourde). Les autres consommateurs
  // (agence, guards de schéma) restent en mono-fenêtre (win = null).
  const win =
    searchParams.get('compare') === 'n1' ? previousWindow(from, to) : null;
  const unionFrom = win ? win.from : from;

  // La vue (requête lourde) et les facteurs CO₂ (client service_role séparé) sont
  // indépendants → lancés en parallèle. Le tarif orga (lecture PK triviale) reste
  // séquentiel APRÈS la vue : sur le même client il s'entrelacerait avec la requête
  // de vue sans gain réel.
  const [union, facteurs_co2, co2_methode] = await Promise.all([
    runFenetre(unionFrom, to),
    // Facteurs d'équivalence CO₂ (héros Cockpit R24) — best-effort + cache process.
    lireFacteursCo2(),
    // Variables du calcul CO₂ (forfait + facteurs par flux) — modale « méthode ».
    lireMethodeCo2(),
  ]);

  if (union.error)
    return NextResponse.json({ error: union.error }, { status: 500 });

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

  // Découpe la fenêtre unique en courante / précédente. Les bornes (chaînes
  // 'YYYY-MM-DD', mois = 1er du mois) reproduisent à l'identique les filtres SQL
  // .gte/.lte de runFenetre — comparaison lexicographique = chronologique en ISO.
  const rows = union.rows ?? [];
  // Réplique exactement les filtres SQL .gte('mois', lo) / .lte('mois', hi) de
  // runFenetre : une borne absente (null) ne filtre RIEN (comportement mono-fenêtre
  // historique quand la route est appelée sans from/to). Une borne présente exige
  // un `mois` comparable — comme `NULL >= lo` en SQL, une ligne sans mois est alors
  // écartée.
  const inWindow = (
    r: unknown,
    lo: string | null,
    hi: string | null,
  ): boolean => {
    const m = (r as { mois?: unknown }).mois;
    const lowOk = !lo || (typeof m === 'string' && m >= lo);
    const highOk = !hi || (typeof m === 'string' && m <= hi);
    return lowOk && highOk;
  };
  const currentRows = rows.filter((r) => inWindow(r, from, to));
  const previous = win
    ? stripMarge(rows.filter((r) => inWindow(r, win.from, win.to)))
    : undefined;

  return NextResponse.json(
    {
      data: stripMarge(currentRows),
      tarif_refacture_pax_zd,
      facteurs_co2,
      co2_methode,
      ...(previous !== undefined ? { previous } : {}),
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
