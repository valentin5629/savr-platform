import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { notifierTraiteurOperationnel } from '@/lib/notifications/traiteur-operationnel.js';

const AGENCE_ROLES: ClientRole[] = ['agence'];

// Champs métier éditables (réplique §06.04 §Édition, sobriété A4). type/lieu/traiteur
// verrouillés → rejetés explicitement.
const EDITABLE_FIELDS = [
  'date_collecte',
  'heure_collecte',
  'controle_acces_requis',
  'notes_internes',
  'informations_supplementaires',
];
const LOCKED_FIELDS = ['type', 'type_collecte', 'lieu_id', 'organisation_id'];

// Résolution du nom du traiteur opérationnel (§06.11 diff #3).
// La RLS organisations n'autorise pas l'agence à lire le référentiel → on passe
// par la vue whitelist v_referentiel_traiteurs (F5). Si absent (fiche shadow),
// l'agence lit sa propre fiche shadow via org_agence_select (est_shadow + créateur).
async function resolveTraiteurOperationnel(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  orgId: string | null,
): Promise<{
  id: string;
  nom: string | null;
  est_shadow: boolean;
  siret: string | null;
} | null> {
  if (!orgId) return null;

  const { data: ref } = await supabase
    .from('v_referentiel_traiteurs')
    .select('id, nom, raison_sociale')
    .eq('id', orgId)
    .maybeSingle();
  if (ref)
    return {
      id: ref.id as string,
      nom: (ref.raison_sociale ?? ref.nom) as string | null,
      est_shadow: false,
      siret: null,
    };

  // Fiche shadow créée par l'agence (lecture autorisée par org_agence_select)
  const { data: shadow } = await supabase
    .from('organisations')
    .select('id, nom, raison_sociale, siret, est_shadow')
    .eq('id', orgId)
    .maybeSingle();
  if (shadow)
    return {
      id: shadow.id as string,
      nom: (shadow.raison_sociale ?? shadow.nom) as string | null,
      est_shadow: shadow.est_shadow === true,
      siret: (shadow.siret as string | null) ?? null,
    };

  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
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

  const evt = Array.isArray(data.evenement)
    ? data.evenement[0]
    : data.evenement;
  const traiteur_operationnel = await resolveTraiteurOperationnel(
    supabase,
    (evt?.traiteur_operationnel_organisation_id as string | null) ?? null,
  );

  return NextResponse.json({ data: { ...data, traiteur_operationnel } });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

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

  // Lecture RLS-scopée (donneur d'ordre) + gate statut
  const rls = createSupabaseServerClient();
  const { data: collecte } = await rls
    .from('collectes')
    .select(
      `id, statut, statut_tms, date_collecte, heure_collecte,
       evenement:evenements!inner(organisation_id)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!collecte)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );

  if (!['programmee', 'validee'].includes(collecte.statut as string)) {
    return NextResponse.json(
      { error: `Édition impossible au statut ${collecte.statut}` },
      { status: 422 },
    );
  }

  // Réacceptation prestataire si le créneau change (cascade E2 informe le TMS)
  const dateHeureModifiee =
    'date_collecte' in updates || 'heure_collecte' in updates;
  const reacceptation_requise =
    dateHeureModifiee && collecte.statut_tms === 'acceptee';
  if (reacceptation_requise) {
    (updates as Record<string, unknown>).statut = 'programmee';
  }

  const admin = createAdminSupabaseClient();
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

  // BL-P2-22 (tpl 21, modification) : info-only au traiteur opérationnel — l'agence
  // est un tiers dès que le traiteur op est une org distincte non-shadow (garde
  // dans le helper). Best-effort.
  void notifierTraiteurOperationnel(admin, {
    collecteId: id,
    acteurOrgId: auth.ctx.organisationId,
    changement: {
      kind: 'modification',
      champsModifies: Object.keys(updates),
    },
  }).catch(() => undefined);

  return NextResponse.json({
    data: updated,
    flags: { reacceptation_requise },
  });
}
