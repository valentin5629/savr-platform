import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_mix_emballages')
    .select('*')
    .order('materiau');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    mix: { id: string; part_pct: number }[];
  };
  if (!Array.isArray(body.mix) || body.mix.length === 0) {
    return NextResponse.json(
      { error: 'mix est obligatoire (tableau non vide)' },
      { status: 422 },
    );
  }

  // Contrôle somme = 100
  const total = body.mix.reduce((acc, m) => acc + m.part_pct, 0);
  if (Math.abs(total - 100) > 0.01) {
    return NextResponse.json(
      {
        error: `La somme des parts doit être égale à 100 % (reçu ${total.toFixed(2)} %)`,
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const results = await Promise.all(
    body.mix.map((m) =>
      supabase
        .from('parametres_mix_emballages')
        .update({
          part_pct: m.part_pct,
          modifie_par: auth.ctx.userId,
          modifie_le: new Date().toISOString(),
        })
        .eq('id', m.id)
        .select()
        .single(),
    ),
  );

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: 'Erreur mise à jour mix emballages',
        details: errors.map((e) => e.error?.message),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: results.map((r) => r.data) });
}
