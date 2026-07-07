import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/api-auth.js';

// Rôles autorisés à appeler le benchmark (§04 f_benchmark_kg_pax_zd)
const ALLOWED_ROLES = [
  'gestionnaire_lieux',
  'traiteur_manager',
  'traiteur_commercial',
  // Agence = réplique stricte §06.04 : Bloc 3 ZD benchmark 4 dimensions
  // (traiteur_ids rejeté, même garde compétitive que le traiteur, §06.11).
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
      // La fonction RPC f_benchmark_kg_pax_zd vit dans le schéma `plateforme`
      // (cf. api-auth.ts) : sans cette option supabase-js cible `public.*`
      // (Accept-Profile: public) → fonction introuvable → 500.
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
  // Arrays passés en CSV (ex ?taille_evenement_codes=M,L). flux_code : filtrage
  // client-side dans BenchmarkGauge (la fonction renvoie tous les flux du segment).
  const csv = (k: string): string[] | null => {
    const v = searchParams.get(k);
    if (!v) return null;
    const arr = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : null;
  };

  // Encart « Filtres benchmark » (§06.05) — tous optionnels (absent = pas de filtre).
  // `bracket` (mono-taille) = compat legacy pour les autres dashboards qui n'ont pas
  // encore l'encart ; sans rien, on couvre les 5 brackets.
  const bracket = searchParams.get('bracket');
  const tailleCodes =
    csv('taille_evenement_codes') ??
    (bracket ? [bracket] : ['XS', 'S', 'M', 'L', 'XL']);
  const typeIds = csv('type_evenement_ids');
  const lieuIds = csv('lieu_ids');
  const traiteurIds = csv('traiteur_ids');
  const periodeDebut = searchParams.get('periode_debut');
  const periodeFin = searchParams.get('periode_fin');

  // Garde : les rôles traiteur ET agence ne peuvent pas passer traiteur_ids (§04
  // préservation compétitive, §06.04 l.143 / §06.11) — doublée côté fonction (RAISE).
  const isTraiteur =
    auth.ctx.role === 'traiteur_manager' ||
    auth.ctx.role === 'traiteur_commercial' ||
    auth.ctx.role === 'agence';
  if (isTraiteur && traiteurIds) {
    return NextResponse.json(
      {
        error:
          'Le filtre traiteur_ids est interdit pour ce rôle (§04 préservation compétitive)',
      },
      { status: 403 },
    );
  }

  // On n'envoie que les params fournis → les autres prennent le DEFAULT NULL de la RPC.
  const args = {
    p_taille_evenement_codes: tailleCodes,
    ...(typeIds ? { p_type_evenement_ids: typeIds } : {}),
    ...(periodeDebut ? { p_periode_debut: periodeDebut } : {}),
    ...(periodeFin ? { p_periode_fin: periodeFin } : {}),
    ...(lieuIds ? { p_lieu_ids: lieuIds } : {}),
    ...(traiteurIds ? { p_traiteur_ids: traiteurIds } : {}),
  };

  const { data, error } = await supabase.rpc('f_benchmark_kg_pax_zd', args);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { data: data ?? [] },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
