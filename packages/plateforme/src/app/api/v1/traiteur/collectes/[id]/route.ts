import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

// Champs métier éditables côté traiteur (§06.04 §Édition). type_collecte, lieu_id
// et traiteur sont verrouillés (sobriété A4) → rejetés explicitement.
const EDITABLE_FIELDS = [
  'date_collecte',
  'heure_collecte',
  'controle_acces_requis',
  'notes_internes',
  'informations_supplementaires',
];
const LOCKED_FIELDS = ['type', 'type_collecte', 'lieu_id', 'organisation_id'];

interface CollecteRow {
  id: string;
  statut: string;
  statut_tms: string;
  date_collecte: string;
  heure_collecte: string | null;
  evenement: { created_by: string; organisation_id: string } | null;
}

async function loadCollecteForUser(id: string): Promise<CollecteRow | null> {
  // Lecture RLS-scopée : si la collecte n'est pas visible (cross-org), null.
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from('collectes')
    .select(
      `id, statut, statut_tms, date_collecte, heure_collecte,
       evenement:evenements!inner(created_by, organisation_id)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const evt = Array.isArray(data.evenement)
    ? data.evenement[0]
    : data.evenement;
  return { ...data, evenement: evt } as CollecteRow;
}

function canWrite(
  c: CollecteRow,
  role: string,
  userId: string,
  orgId: string,
): boolean {
  if (role === 'traiteur_manager')
    return c.evenement?.organisation_id === orgId;
  // commercial : seulement ses propres collectes
  return c.evenement?.created_by === userId;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('collectes')
    .select(
      `id, type, statut, statut_tms, date_collecte, heure_collecte,
       controle_acces_requis, informations_completes, informations_supplementaires,
       notes_internes, taux_recyclage, realisee_at, aucun_repas_motif,
       evenement:evenements!inner(
         id, organisation_id, traiteur_operationnel_organisation_id,
         nom_evenement, pax, type_evenement_id,
         nom_client_organisateur, contact_principal_nom, contact_principal_telephone,
         contact_secours_nom, contact_secours_telephone,
         lieu:lieux!lieu_id(id, nom, adresse_acces, code_postal, ville)
       )`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  return NextResponse.json({ data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  // Champs verrouillés (§Édition sobriété A4) — refus explicite
  const lockedAttempt = LOCKED_FIELDS.filter((f) => f in body);
  if (lockedAttempt.length > 0) {
    return NextResponse.json(
      {
        error:
          'Pour changer le lieu ou le type de collecte, annulez cette collecte et programmez-en une nouvelle.',
        champs_verrouilles: lockedAttempt,
      },
      { status: 422 },
    );
  }

  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) => EDITABLE_FIELDS.includes(k)),
  );
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  const collecte = await loadCollecteForUser(id);
  if (!collecte)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );

  // Gate statut (§05 §4) : édition autorisée uniquement programmee / validee
  if (!['programmee', 'validee'].includes(collecte.statut)) {
    return NextResponse.json(
      { error: `Édition impossible au statut ${collecte.statut}` },
      { status: 422 },
    );
  }
  // Autorisation acteur
  if (
    !canWrite(collecte, auth.ctx.role, auth.ctx.userId, auth.ctx.organisationId)
  ) {
    return NextResponse.json(
      { error: 'Modification non autorisée' },
      {
        status: 403,
      },
    );
  }

  // Flags modal/audit (§06.04 modal unique + cut-off 12h)
  const creneau = new Date(
    `${collecte.date_collecte}T${collecte.heure_collecte ?? '00:00:00'}`,
  );
  const priorite_urgence = creneau.getTime() - Date.now() < 12 * 3600 * 1000;
  const dateHeureModifiee =
    'date_collecte' in updates || 'heure_collecte' in updates;
  const reacceptation_requise =
    dateHeureModifiee && collecte.statut_tms === 'acceptee';

  // Réacceptation : la modif de créneau invalide l'acceptation prestataire →
  // statut métier revient à programmee, statut_tms repasse en attente (E2 informe le TMS).
  if (reacceptation_requise) {
    (updates as Record<string, unknown>).statut = 'programmee';
  }

  const admin = createAdminSupabaseClient();
  const { data: before } = await admin
    .from('collectes')
    .select('*')
    .eq('id', id)
    .single();

  const { data: updated, error } = await admin.rpc('fn_modifier_collecte', {
    p_id: id,
    p_updates: updates,
    p_champs_modifies: Object.keys(updates),
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  if (reacceptation_requise) {
    await admin
      .from('collectes')
      .update({ statut_tms: 'attribuee_en_attente_acceptation' })
      .eq('id', id);
  }

  // Audit (§05 audit_log global — cascade_tms si déjà poussée, priorite_urgence)
  const cascade_tms = collecte.statut_tms !== 'non_envoye';
  await admin.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    old_data: before ?? {},
    new_data: { updates, cascade_tms, priorite_urgence },
  });

  return NextResponse.json({
    data: updated,
    flags: { priorite_urgence, reacceptation_requise, cascade_tms },
  });
}
