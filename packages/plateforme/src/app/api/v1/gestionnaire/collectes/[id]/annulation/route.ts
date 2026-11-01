import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { notifierAdminAnnulation } from '@/lib/notifications/traiteur-operationnel.js';
import { serverError } from '@/lib/api-helpers.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';
import { envoyerConfirmationAnnulation } from '@/lib/notifications/annulation-client.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

// Statuts que le client annule lui-même, sur-le-champ (Val 2026-11-01).
const STATUTS_ANNULABLES = ['brouillon', 'programmee', 'validee'];

const GESTIONNAIRE_ROLES: ClientRole[] = ['gestionnaire_lieux'];

// POST /api/v1/gestionnaire/collectes/:id/annulation — le gestionnaire de lieux
// annule ses propres programmations (décision Val 2026-10-26), comme l'agence :
//  - brouillon / programmee / validee : annulation directe → 'annulee' (E3 si
//    poussée TMS). Plus de demande soumise à l'Admin, qui est seulement
//    prévenu (décision Val 2026-11-01).
//  - statuts terminaux → refus.
// Jamais une collecte qu'un traiteur a programmée sur l'un de ses lieux : la RLS
// la lui laisse lire, la garde d'organisation ci-dessous la refuse.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, GESTIONNAIRE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { motif?: string };
  const motif = body.motif ?? '';

  const rls = createSupabaseServerClient();
  const { data: c } = await rls
    .from('collectes')
    .select(
      `id, type, pax, statut, statut_tms, date_collecte, heure_collecte,
       evenement:evenements!inner(created_by, organisation_id, nom_evenement,
         organisation:organisations!organisation_id(nom), lieu:lieux!lieu_id(nom))`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!c)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );

  const evt = (Array.isArray(c.evenement) ? c.evenement[0] : c.evenement) as
    | {
        created_by?: string | null;
        nom_evenement?: string | null;
        organisation_id: string;
        organisation: { nom: string } | { nom: string }[] | null;
        lieu?: { nom: string | null } | { nom: string | null }[] | null;
      }
    | null
    | undefined;
  // Périmètre d'écriture : ses propres programmations (organisation_id = son
  // orga). Indispensable ici : la lecture RLS ci-dessus couvre aussi les
  // collectes des traiteurs tenues sur ses lieux, et l'écriture qui suit passe
  // par le client de service.
  if (!evt || evt.organisation_id !== auth.ctx.organisationId)
    return NextResponse.json(
      { error: 'Annulation non autorisée' },
      { status: 403 },
    );
  const orgNom = Array.isArray(evt.organisation)
    ? evt.organisation[0]?.nom
    : evt.organisation?.nom;
  const lieuNom =
    (Array.isArray(evt.lieu) ? evt.lieu[0]?.nom : evt.lieu?.nom) ?? '';
  const admin = createAdminSupabaseClient();
  // Débit des écritures clientes (cf. lib/frein-ecritures-client), compté pour
  // une collecte annulable seulement.
  const freiner = () =>
    freinerEcritureCliente({ organisationId: auth.ctx.organisationId });

  if (STATUTS_ANNULABLES.includes(c.statut)) {
    const frein = freiner();
    if (frein) return frein;

    const { error } = await admin.rpc('fn_modifier_collecte', {
      p_id: id,
      p_updates: { statut: 'annulee', annulee_cote_savr_motif: motif },
      p_champs_modifies: ['statut'],
    });
    if (error)
      return serverError(error, 'gestionnaire.collectes.annulation.directe');

    // L'ordre éventuel est en file : il part sans attendre le passage planifié
    // (décision Val 2026-10-12).
    envoyerOrdresSansAttendre(c.id);

    // Template 5 : confirmation au programmateur (l'équipe Savr reçoit le 22).
    await envoyerConfirmationAnnulation(admin, {
      programmateurId: evt.created_by,
      dateCollecte: c.date_collecte ?? '',
      heureCollecte: c.heure_collecte,
      lieuNom,
      nomEvenement: evt.nom_evenement,
      motif,
    });

    // BL-P2-22 (tpl 22) : alerte Admin « collecte annulée », en parallèle du
    // template 5. Le programmateur ne reçoit que la confirmation (tpl 5), jamais
    // aussi « Collecte annulée » par un tiers (tpl 21) : Val 2026-10-29.
    void notifierAdminAnnulation(admin, {
      collecteId: id,
      organisationNom: orgNom ?? '',
      dateCollecte: c.date_collecte ?? '',
      heureCollecte: c.heure_collecte,
      lieuNom,
      motif,
      acteurUserId: auth.ctx.userId,
      acteurRole: auth.ctx.role,
    }).catch(() => undefined);

    return NextResponse.json({ data: { statut: 'annulee' } });
  }

  return NextResponse.json(
    { error: `Annulation impossible au statut ${c.statut}` },
    { status: 422 },
  );
}
