import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const GESTIONNAIRE_ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Champs métier collecte éditables (parité §06.04 §Édition / §05 l.307). type/lieu
// verrouillés (§05 l.314) → rejetés explicitement.
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
  evenement: { organisation_id: string } | null;
}

async function loadCollecteForUser(id: string): Promise<CollecteRow | null> {
  // Lecture RLS-scopée : si la collecte n'est pas visible (hors périmètre), null.
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from('collectes')
    .select(
      `id, statut, statut_tms, date_collecte, heure_collecte,
       evenement:evenements!inner(organisation_id)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const evt = Array.isArray(data.evenement)
    ? data.evenement[0]
    : data.evenement;
  return { ...data, evenement: evt } as CollecteRow;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, GESTIONNAIRE_ROLES);
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
         nom_evenement, pax, type_evenement_id, reference_affaire, notes_internes,
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
  const auth = await requireUser(req, GESTIONNAIRE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  // Champs verrouillés (§05 l.314) — refus explicite.
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

  // Gate statut (§05 l.305) : édition autorisée uniquement programmee / validee.
  if (!['programmee', 'validee'].includes(collecte.statut)) {
    return NextResponse.json(
      { error: `Édition impossible au statut ${collecte.statut}` },
      { status: 422 },
    );
  }

  // Périmètre d'écriture gestionnaire (miroir col_update_client §09) : ses propres
  // programmations (organisation_id = son orga). La lecture peut être plus large
  // (collectes à ses lieux programmées par d'autres) → 403 sur celles-là.
  if (collecte.evenement?.organisation_id !== auth.ctx.organisationId) {
    return NextResponse.json(
      { error: 'Modification non autorisée' },
      { status: 403 },
    );
  }

  // Réacceptation prestataire si le créneau change (§05 l.323).
  const dateHeureModifiee =
    'date_collecte' in updates || 'heure_collecte' in updates;
  const reacceptation_requise =
    dateHeureModifiee && collecte.statut_tms === 'acceptee';
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

  const cascade_tms = collecte.statut_tms !== 'non_envoye';
  await admin.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    old_values: before ?? {},
    new_values: { updates, cascade_tms, reacceptation_requise },
  });

  return NextResponse.json({
    data: updated,
    flags: { reacceptation_requise, cascade_tms },
  });
}
