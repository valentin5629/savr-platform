import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';
import { decalerJour, jourParis } from '@savr/shared/src/temps/index.js';

// Modification d'une remise négociée — §06.06 « Remises négociées » : « fermeture
// de la ligne active + création nouvelle ligne (jamais de modification
// rétroactive) ». L'ancienne ligne est close la veille de la date d'effet de la
// nouvelle (pas de jour où les deux s'appliquent) ; la date d'effet ne peut pas
// être passée. Portée (scope, porteur) et activité sont conservées ; seul le lieu
// d'une remise gestionnaire peut changer.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RemiseExistante {
  id: string;
  scope: string;
  organisation_id: string | null;
  gestionnaire_organisation_id: string | null;
  lieu_id: string | null;
  activite: string;
  remise_pct: number;
  valide_du: string;
  valide_jusqu_au: string | null;
  commentaires: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { remise_pct, valide_du, commentaires } = body as {
    remise_pct?: number;
    valide_du?: string;
    commentaires?: string | null;
  };

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Remise non trouvée' }, { status: 404 });
  }
  if (typeof remise_pct !== 'number' || !(remise_pct > 0 && remise_pct <= 1)) {
    return NextResponse.json(
      { error: 'remise_pct doit être une fraction > 0 et <= 1' },
      { status: 422 },
    );
  }
  const today = jourParis();
  if (
    typeof valide_du !== 'string' ||
    !DATE_RE.test(valide_du) ||
    decalerJour(valide_du, 0) !== valide_du
  ) {
    return NextResponse.json(
      { error: 'valide_du doit être une date AAAA-MM-JJ' },
      { status: 422 },
    );
  }
  if (valide_du < today) {
    return NextResponse.json(
      { error: 'La date d’effet ne peut pas être dans le passé' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const { data: ancienne, error: selErr } = await supabase
    .from('tarifs_negocie')
    .select(
      'id, scope, organisation_id, gestionnaire_organisation_id, lieu_id, activite, remise_pct, valide_du, valide_jusqu_au, commentaires',
    )
    .eq('id', id)
    .maybeSingle();
  if (selErr) return serverError(selErr, 'admin.tarifs_negocie.modifier');
  const old = ancienne as RemiseExistante | null;
  if (!old) {
    return NextResponse.json({ error: 'Remise non trouvée' }, { status: 404 });
  }
  if (old.valide_jusqu_au !== null) {
    return NextResponse.json(
      { error: 'Remise déjà fermée : créez une nouvelle remise' },
      { status: 409 },
    );
  }

  // Lieu : absent du corps = inchangé ; null = tous les lieux du gestionnaire.
  let lieuId = old.lieu_id;
  if ('lieu_id' in body) {
    const l = body.lieu_id;
    if (l !== null && (typeof l !== 'string' || !UUID_RE.test(l))) {
      return NextResponse.json({ error: 'lieu_id invalide' }, { status: 422 });
    }
    if (l && old.scope !== 'gestionnaire') {
      return NextResponse.json(
        { error: 'lieu_id réservé au scope gestionnaire' },
        { status: 422 },
      );
    }
    if (l) {
      const { data: lien, error: lErr } = await supabase
        .from('organisations_lieux')
        .select('id')
        .eq('organisation_id', old.gestionnaire_organisation_id as string)
        .eq('lieu_id', l)
        .maybeSingle();
      if (lErr) return serverError(lErr, 'admin.tarifs_negocie.modifier');
      if (!lien) {
        return NextResponse.json(
          { error: "Ce lieu n'est pas rattaché à ce gestionnaire" },
          { status: 422 },
        );
      }
    }
    lieuId = (l as string | null) || null;
  }

  // 1. Fermeture gardée (encore ouverte) : deux modifications concurrentes ne
  //    peuvent pas créer deux successeurs.
  const fin = decalerJour(valide_du, -1);
  const { data: fermee, error: updErr } = await supabase
    .from('tarifs_negocie')
    .update({ valide_jusqu_au: fin })
    .eq('id', id)
    .is('valide_jusqu_au', null)
    .select('id')
    .maybeSingle();
  if (updErr) return writeError(updErr, 'admin.tarifs_negocie.modifier');
  if (!fermee) {
    return NextResponse.json(
      { error: 'Remise déjà fermée : créez une nouvelle remise' },
      { status: 409 },
    );
  }

  // 2. Nouvelle ligne ; en cas d'échec, la fermeture est annulée.
  const nouvelle = {
    scope: old.scope,
    organisation_id: old.organisation_id,
    gestionnaire_organisation_id: old.gestionnaire_organisation_id,
    lieu_id: lieuId,
    activite: old.activite,
    remise_pct,
    valide_du,
    commentaires:
      commentaires === undefined ? old.commentaires : commentaires || null,
  };
  const { data, error: insErr } = await supabase
    .from('tarifs_negocie')
    .insert(nouvelle)
    .select('*')
    .single();
  if (insErr || !data) {
    await supabase
      .from('tarifs_negocie')
      .update({ valide_jusqu_au: null })
      .eq('id', id)
      .eq('valide_jusqu_au', fin);
    return writeError(insErr, 'admin.tarifs_negocie.modifier');
  }

  try {
    await supabase.from('audit_log').insert({
      table_name: 'tarifs_negocie',
      record_id: (data as { id: string }).id,
      action: 'modification_remise',
      user_id: auth.ctx.userId,
      old_values: {
        id: old.id,
        remise_pct: old.remise_pct,
        valide_du: old.valide_du,
        lieu_id: old.lieu_id,
        valide_jusqu_au: fin,
      },
      new_values: nouvelle,
    });
  } catch {
    /* audit failure non-bloquante */
  }

  return NextResponse.json(data, { status: 201 });
}
