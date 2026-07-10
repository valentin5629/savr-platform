import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/api-auth.js';

const ALLOWED_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
] as const;

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

  // Défense en profondeur : scoper côté serveur en plus de la RLS vue security_invoker
  let query = supabase
    .from('v_kpi_traiteur')
    .select('*')
    .eq('organisation_id', auth.ctx.organisationId);

  if (from) query = query.gte('mois', from);
  if (to) query = query.lte('mois', to);
  if (type === 'zero_dechet' || type === 'anti_gaspi') {
    query = query.eq('type_collecte', type);
  }

  query = query.order('mois', { ascending: false });

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // §06.11 diff #7 — l'agence n'a pas de KPI « Marge générée » (4 cartes ZD).
  // marge_zd_ht est retiré de la réponse côté serveur (pas un masquage CSS) :
  // aucune donnée de marge ne transite pour le rôle agence.
  const isAgence = auth.ctx.role === 'agence';
  const rows = isAgence
    ? (data ?? []).map((r) => {
        const { marge_zd_ht: _omit, ...rest } = r as Record<string, unknown>;
        void _omit;
        return rest;
      })
    : data;

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

  return NextResponse.json(
    { data: rows, tarif_refacture_pax_zd },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
