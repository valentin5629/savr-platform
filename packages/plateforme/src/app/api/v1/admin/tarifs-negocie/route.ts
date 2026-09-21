import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';
import { writeError, serverError } from '@/lib/api-helpers.js';
import {
  lireLieuxDuCorps,
  verifierLieuxGestionnaire,
} from '@/lib/admin/remise-lieux.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const organisation_id = searchParams.get('organisation_id');
  const gestionnaire_organisation_id = searchParams.get(
    'gestionnaire_organisation_id',
  );

  // Colonne réelle = `activite` (zd/ag), PAS `type_remise` (inexistante → HTTP 400).
  // Vérifié contre savr-dev.
  let query = supabase
    .from('tarifs_negocie')
    .select(
      'id, scope, organisation_id, gestionnaire_organisation_id, lieu_id, activite, remise_pct, valide_du, valide_jusqu_au, commentaires, created_at',
    )
    .order('created_at', { ascending: false });

  if (organisation_id) query = query.eq('organisation_id', organisation_id);
  if (gestionnaire_organisation_id)
    query = query.eq(
      'gestionnaire_organisation_id',
      gestionnaire_organisation_id,
    );

  const { data, error } = await query;
  if (error) return serverError(error, 'admin.tarifs_negocie.list');

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const {
    scope,
    organisation_id,
    gestionnaire_organisation_id,
    activite,
    remise_pct,
    valide_du,
    commentaires,
  } = body as {
    scope?: string;
    organisation_id?: string;
    gestionnaire_organisation_id?: string;
    activite?: string;
    remise_pct?: number;
    valide_du?: string;
    commentaires?: string;
  };

  if (!scope || !activite || remise_pct === undefined || !valide_du) {
    return NextResponse.json(
      { error: 'scope, activite, remise_pct, valide_du sont obligatoires' },
      { status: 422 },
    );
  }
  if (scope === 'organisation' && !organisation_id) {
    return NextResponse.json(
      { error: 'organisation_id requis pour scope=organisation' },
      { status: 422 },
    );
  }
  if (scope === 'gestionnaire' && !gestionnaire_organisation_id) {
    return NextResponse.json(
      { error: 'gestionnaire_organisation_id requis pour scope=gestionnaire' },
      { status: 422 },
    );
  }
  // remise_pct est une FRACTION > 0 et <= 1 (0.15 = 15 %), CHECK DB
  // `tarifs_negocie_remise_pct_check` (zéro exclu). L'UI saisit un % et divise
  // par 100.
  if (remise_pct <= 0 || remise_pct > 1) {
    return NextResponse.json(
      { error: 'remise_pct doit être une fraction > 0 et <= 1' },
      { status: 422 },
    );
  }

  // Lieux (lieu_ids, ou lieu_id historique) : réservés au scope gestionnaire
  // (§04 : null = tous les lieux du gestionnaire) — le calcul du prix les ignore
  // en scope organisation.
  const corpsLieux = lireLieuxDuCorps(body);
  if (!corpsLieux.ok) {
    return NextResponse.json({ error: corpsLieux.error }, { status: 422 });
  }
  if (corpsLieux.ids.length > 0 && scope !== 'gestionnaire') {
    return NextResponse.json(
      { error: 'Les lieux sont réservés au scope gestionnaire' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  if (scope === 'gestionnaire') {
    const { data: gest, error: gErr } = await supabase
      .from('organisations')
      .select('type')
      .eq('id', gestionnaire_organisation_id as string)
      .maybeSingle();
    if (gErr) return serverError(gErr, 'admin.tarifs_negocie.create');
    if ((gest as { type?: string } | null)?.type !== 'gestionnaire_lieux') {
      return NextResponse.json(
        {
          error:
            'gestionnaire_organisation_id doit désigner un gestionnaire de lieux',
        },
        { status: 422 },
      );
    }
  }

  // Une ligne par lieu ([null] = tous les lieux du gestionnaire ; scope
  // organisation = une seule ligne sans lieu). Un seul INSERT : tout ou rien.
  let lieux: Array<string | null> = [null];
  if (scope === 'gestionnaire') {
    const v = await verifierLieuxGestionnaire(
      supabase,
      gestionnaire_organisation_id as string,
      corpsLieux.ids,
    );
    if (!v.ok && v.status === 500)
      return serverError(v.cause, 'admin.tarifs_negocie.create');
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 422 });
    lieux = v.lieux;
  }

  const { data, error } = await supabase
    .from('tarifs_negocie')
    .insert(
      lieux.map((lieu_id) => ({
        scope,
        organisation_id,
        gestionnaire_organisation_id,
        lieu_id,
        activite,
        remise_pct,
        valide_du,
        commentaires: commentaires ?? null,
      })),
    )
    .select('*');

  if (error || !data?.length)
    return writeError(error, 'admin.tarifs_negocie.create');
  const creees = data as Array<{ id: string; lieu_id: string | null }>;

  try {
    await supabase.from('audit_log').insert(
      creees.map((r) => ({
        table_name: 'tarifs_negocie',
        record_id: r.id,
        action: 'creation_remise',
        user_id: auth.ctx.userId,
        new_values: {
          scope,
          organisation_id,
          gestionnaire_organisation_id,
          lieu_id: r.lieu_id,
          activite,
          remise_pct,
          valide_du,
        },
      })),
    );
  } catch {
    /* audit failure non-bloquante */
  }

  return NextResponse.json({ data: creees }, { status: 201 });
}
