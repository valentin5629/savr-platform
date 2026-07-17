import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireProgrammateur,
  requireProgrammateurOuAdmin,
  createSupabaseServerClient,
} from '@/lib/api-auth.js';
import { notifierTraiteurOperationnel } from '@/lib/notifications/traiteur-operationnel.js';

// Champs métier ÉVÉNEMENT éditables par les rôles programmateurs (§06.04 l.444,
// §05 l.307). lieu_id et type_collecte = verrouillés (§05 l.314 / §06.04 l.459) :
// changer le lieu = annuler + reprogrammer. organisation_id / traiteur_operationnel
// / entite_facturation = immuables par construction → jamais exposés.
const EVENT_EDITABLE_FIELDS = [
  'nom_evenement',
  'pax',
  'type_evenement_id',
  'contact_principal_nom',
  'contact_principal_telephone',
  'contact_secours_nom',
  'contact_secours_telephone',
  'nom_client_organisateur',
  'logo_client_organisateur_url',
  'reference_affaire',
  'notes_internes',
];
// Verrouillés pour les programmateurs (refus 422). lieu_id / type / organisation =
// immuables (§05 l.314). client_organisateur_organisation_id = RATTACHEMENT d'une
// org cliente (donne accès en lecture via evt_client_orga_select) → réservé Admin
// back-office (§06.06), jamais un programmateur (surface de divulgation, revue RLS
// 2026-06-26). nom/logo client = libellés libres, restent éditables.
const EVENT_LOCKED_FIELDS = [
  'lieu_id',
  'organisation_id',
  'traiteur_operationnel_organisation_id',
  'entite_facturation_id',
  'client_organisateur_organisation_id',
];

// Détail d'un événement avec ses collectes (pour vérification doublon AG etc.)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('evenements')
    .select(
      'id, nom_evenement, pax, contact_principal_nom, lieux(nom, adresse_acces, code_postal, ville), collectes(id, type, statut, date_collecte, heure_collecte)',
    )
    .eq('id', evenementId)
    .eq('organisation_id', auth.ctx.organisationId)
    .single();

  if (error || !data)
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );

  return NextResponse.json(data);
}

// Édition des champs métier de l'événement par un rôle programmateur (4 rôles).
// Décision produit Val 2026-06-26 : édition événement + collecte depuis la fiche
// collecte, fenêtre brouillon/programmee/validee, verrou dès en_cours (§06.04 l.444,
// §05 §4). E2 par collecte déjà dispatchée émis par fn_modifier_evenement.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  // Champs verrouillés (§05 l.314 / §06.04 l.459) — refus explicite.
  const lockedAttempt = EVENT_LOCKED_FIELDS.filter((f) => f in body);
  if (lockedAttempt.length > 0) {
    return NextResponse.json(
      {
        error:
          'Pour changer le lieu, annulez la ou les collectes et reprogrammez. Les autres champs structurants sont immuables.',
        champs_verrouilles: lockedAttempt,
      },
      { status: 422 },
    );
  }

  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) => EVENT_EDITABLE_FIELDS.includes(k)),
  );
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  // Lecture RLS-scopée (cloisonnement org : si invisible → 404).
  const rls = createSupabaseServerClient();
  const { data: evt } = await rls
    .from('evenements')
    .select('id, organisation_id, created_by')
    .eq('id', id)
    .maybeSingle();
  if (!evt) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }

  // Périmètre d'ÉCRITURE — miroir des policies evt_*_update (§09) :
  // commercial = ses propres créations ; manager/agence/gestionnaire = son orga.
  const autorise =
    auth.ctx.role === 'traiteur_commercial'
      ? evt.created_by === auth.ctx.userId
      : evt.organisation_id === auth.ctx.organisationId;
  if (!autorise) {
    return NextResponse.json(
      { error: 'Modification non autorisée' },
      { status: 403 },
    );
  }

  // Fenêtre d'édition niveau événement (§05 l.304) : f_collecte_editable.
  const { data: editable } = await rls.rpc('f_collecte_editable', {
    p_evenement_id: id,
  });
  if (!editable) {
    return NextResponse.json(
      {
        error:
          'Cet événement ne peut plus être modifié (collecte en cours ou terminée).',
      },
      { status: 422 },
    );
  }

  // Écriture via RPC service-role : UPDATE événement + recalcul volume si pax +
  // émission E2 par collecte dispatchée (atomique, row lock avant outbox — G4).
  const admin = createAdminSupabaseClient();
  const { data: before } = await admin
    .from('evenements')
    .select('*')
    .eq('id', id)
    .single();

  const { data: updated, error } = await admin.rpc('fn_modifier_evenement', {
    p_id: id,
    p_updates: updates,
    p_champs_modifies: Object.keys(updates),
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit (§05 l.330 audit_log global — accessible Admin only).
  await admin.from('audit_log').insert({
    table_name: 'evenements',
    record_id: id,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    old_values: before ?? {},
    new_values: { updates },
  });

  // Recompute de `informations_completes` (§04 Data Model) — BL-P1-TRAIT-04.
  // Le badge « Info incomplète » (posé à la programmation quand contact principal
  // ou client final manquait) se lève dès que ces champs sont renseignés à
  // l'édition. Miroir strict de la règle de programmation (§programmation/
  // evenements) : complet = contact_principal_telephone ET nom_client_organisateur
  // renseignés. Les collectes à lieu_overrides restent incomplètes (override lieu
  // non levé ici) → exclues du recompute.
  if (
    'contact_principal_telephone' in updates ||
    'nom_client_organisateur' in updates
  ) {
    const beforeRow = (before ?? {}) as Record<string, unknown>;
    const contactTel =
      'contact_principal_telephone' in updates
        ? updates.contact_principal_telephone
        : beforeRow.contact_principal_telephone;
    const nomClient =
      'nom_client_organisateur' in updates
        ? updates.nom_client_organisateur
        : beforeRow.nom_client_organisateur;
    const complet = Boolean(contactTel) && Boolean(nomClient);
    await admin
      .from('collectes')
      .update({ informations_completes: complet })
      .eq('evenement_id', id)
      .is('lieu_overrides', null);
  }

  // BL-P2-22 (tpl 21, modification) : info-only au traiteur opérationnel si la
  // modification est faite par un tiers (garde tiers-non-shadow dans le helper).
  // Modif événement = niveau événement → une collecte représentative. Best-effort :
  // tout le bloc est protégé — une notification ne doit JAMAIS casser la modification.
  try {
    const { data: colNotif } = await admin
      .from('collectes')
      .select('id')
      .eq('evenement_id', id)
      .limit(1)
      .maybeSingle();
    if (colNotif) {
      void notifierTraiteurOperationnel(admin, {
        collecteId: colNotif.id,
        acteurOrgId: auth.ctx.organisationId,
        changement: {
          kind: 'modification',
          champsModifies: Object.keys(updates),
        },
      }).catch(() => undefined);
    }
  } catch {
    // notification best-effort — ignorée si irrésoluble
  }

  return NextResponse.json({ data: updated });
}

// Suppression d'un événement brouillon (et ses collectes) par son propriétaire.
// Ouverte à l'admin en mode support, comme la liste qui l'appelle : depuis que
// celle-ci lui rend ses propres brouillons (GET ../evenements?statut=brouillon,
// décision Val 2026-07-17), le bouton « Supprimer » est cliquable — le laisser
// fail-closed rendrait la ligne visible mais l'action morte.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const supabase = createAdminSupabaseClient();

  // Vérification propriété + statut brouillon uniquement. Route d'ITEM clé par PK :
  // prédicat org strict pour les rôles clients, retiré pour le staff (son JWT porte
  // `org_savr`, qui ne désigne aucune org cliente).
  const evtQuery = supabase
    .from('evenements')
    .select('id')
    .eq('id', evenementId);

  const { data: evt } = await (
    auth.ctx.isAdmin
      ? evtQuery
      : evtQuery.eq('organisation_id', auth.ctx.organisationId)
  ).single();

  if (!evt) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }

  // Vérifier que toutes les collectes sont en brouillon (pas de suppression si déjà confirmé)
  const { data: collectes } = await supabase
    .from('collectes')
    .select('id, statut')
    .eq('evenement_id', evenementId);

  const hasNonBrouillon = collectes?.some((c) => c.statut !== 'brouillon');
  if (hasNonBrouillon) {
    return NextResponse.json(
      {
        error:
          "Impossible de supprimer : des collectes sont déjà confirmées. Utilisez l'annulation.",
      },
      { status: 422 },
    );
  }

  // DELETE CASCADE via FK (collectes supprimées par ON DELETE CASCADE)
  const { error } = await supabase
    .from('evenements')
    .delete()
    .eq('id', evenementId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}
