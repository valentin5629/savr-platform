import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import {
  notifierAdminAnnulation,
  notifierTraiteurOperationnel,
} from '@/lib/notifications/traiteur-operationnel.js';

const AGENCE_ROLES: ClientRole[] = ['agence'];

// POST /api/v1/agence/collectes/:id/annulation — réplique §06.04 §Annulation,
// périmètre donneur d'ordre (org-wide, rôle agence unique).
//  - brouillon / programmee : annulation directe → 'annulee' (E3 si poussée TMS)
//  - validee : demande d'annulation → 'annulation_demandee' (validation Admin)
//  - statuts terminaux → refus.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { motif?: string };
  const motif = body.motif ?? '';

  const rls = createSupabaseServerClient();
  const { data: c } = await rls
    .from('collectes')
    .select(
      `id, statut, statut_tms, date_collecte, heure_collecte,
       evenement:evenements!inner(organisation_id, nom_evenement,
         organisation:organisations!organisation_id(nom))`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!c)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );

  const evt = (Array.isArray(c.evenement) ? c.evenement[0] : c.evenement) as {
    organisation_id: string;
    organisation: { nom: string } | { nom: string }[] | null;
  };
  const orgNom = Array.isArray(evt.organisation)
    ? evt.organisation[0]?.nom
    : evt.organisation?.nom;
  const admin = createAdminSupabaseClient();

  if (c.statut === 'brouillon' || c.statut === 'programmee') {
    const { error } = await admin.rpc('fn_modifier_collecte', {
      p_id: id,
      p_updates: { statut: 'annulee', annulee_cote_savr_motif: motif },
      p_champs_modifies: ['statut'],
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    await sendEmail('annulation_collecte', 'hello@gosavr.io', {
      organisation_nom: orgNom ?? '',
      collecte_ref: id,
      motif,
    });

    // BL-P2-22 (tpl 22) : alerte Admin « collecte annulée », en parallèle du
    // template 5. (tpl 21) : info au traiteur opérationnel — l'agence est un tiers
    // dès que le traiteur op est une org distincte non-shadow (garde dans le helper).
    void notifierAdminAnnulation(admin, {
      collecteId: id,
      collecteRef: id,
      organisationNom: orgNom ?? '',
      dateCollecte: c.date_collecte ?? '',
      heureCollecte: c.heure_collecte,
      acteurUserId: auth.ctx.userId,
      acteurRole: auth.ctx.role,
    }).catch(() => undefined);
    void notifierTraiteurOperationnel(admin, {
      collecteId: id,
      acteurOrgId: auth.ctx.organisationId,
      changement: { kind: 'annulation' },
    }).catch(() => undefined);

    return NextResponse.json({ data: { statut: 'annulee' } });
  }

  if (c.statut === 'validee') {
    const { error } = await admin.rpc('fn_modifier_collecte', {
      p_id: id,
      p_updates: {
        statut: 'annulation_demandee',
        annulee_cote_savr_motif: motif,
      },
      p_champs_modifies: ['statut'],
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    await sendEmail('admin_demande_annulation', 'hello@gosavr.io', {
      organisation_nom: orgNom ?? '',
      demandeur_nom: auth.ctx.userId,
      collecte_ref: id,
      date_collecte: c.date_collecte ?? '',
      motif,
    });
    return NextResponse.json({ data: { statut: 'annulation_demandee' } });
  }

  return NextResponse.json(
    { error: `Annulation impossible au statut ${c.statut}` },
    { status: 422 },
  );
}
