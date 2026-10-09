import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { notifierTraiteurOperationnel } from '@/lib/notifications/traiteur-operationnel.js';
import { serverError } from '@/lib/api-helpers.js';
import { validerChampsTexteLibre } from '@/lib/champs-texte-libre.js';
import { refusHeureCollecte } from '@/lib/heure-collecte.js';
import { chargerFicheCollecteClient } from '@/lib/collectes/fiche-client.js';
import { CHAMPS_COLLECTE_EDITABLES } from '@/lib/collectes/champs-editables.js';
import { notifierEquipeModificationCollecte } from '@/lib/collectes/email-modification.js';

const GESTIONNAIRE_ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Champs éditables : CHAMPS_COLLECTE_EDITABLES (lib/collectes/champs-editables).
// Type, lieu et organisation sont verrouillés (§05 l.314) → rejetés explicitement.
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

  // Socle commun des fiches clientes (pop-up §06.04 repris par §06.05). Pour le
  // gestionnaire, repas donnés et association bénéficiaire sont lus par la vue
  // v_attributions_gestionnaire (§04) ; ses documents sont lus sous sa RLS.
  const r = await chargerFicheCollecteClient(id, auth.ctx, 'gestionnaire');
  if ('erreur' in r) return serverError(r.erreur, 'gestionnaire.collectes.get');
  if ('introuvable' in r)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  return NextResponse.json({ data: r.fiche });
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
    Object.entries(body).filter(([k]) => CHAMPS_COLLECTE_EDITABLES.includes(k)),
  );
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  // Borne d'entrée du texte libre transmis au transporteur : `fn_modifier_collecte`
  // écrit `p_updates->>'informations_supplementaires'` tel quel, et cette valeur
  // part dans le canal où sont concaténées toutes les infos d'exploitation.
  const texteValide = validerChampsTexteLibre(updates);
  if ('error' in texteValide) return texteValide.error;
  Object.assign(updates, texteValide.valeurs);

  // Format de l'heure refusé en 422 avant la RPC (cast `::time` + NOT NULL → 500).
  if (Object.hasOwn(updates, 'heure_collecte')) {
    const refusHeure = refusHeureCollecte(updates.heure_collecte);
    if (refusHeure) return refusHeure;
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
  if (error) return serverError(error, 'gestionnaire.collectes.update');

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

  // Email à l'équipe Savr (cf. lib/collectes/email-modification). Quand le
  // formulaire vient aussi de modifier l'événement, il le signale
  // (`evenement_modifie`) : cette modification est relue dans le journal d'audit.
  await notifierEquipeModificationCollecte(admin, req, {
    collecteId: id,
    collecteAvant: (before ?? null) as Record<string, unknown> | null,
    majCollecte: updates,
    ...(body.evenement_modifie === true
      ? { evenementModifiePar: auth.ctx.userId }
      : {}),
  });

  // BL-P2-22 (tpl 21, modification) : info-only au traiteur opérationnel — le
  // gestionnaire de lieux est un tiers dès que le traiteur op est une org
  // distincte non-shadow (garde dans le helper). Best-effort.
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
    flags: { reacceptation_requise, cascade_tms },
  });
}
