import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import {
  notifierAdminAnnulation,
  notifierTraiteurOperationnel,
} from '@/lib/notifications/traiteur-operationnel.js';
import { serverError } from '@/lib/api-helpers.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';
import {
  envoyerConfirmationAnnulation,
  lireCompte,
} from '@/lib/notifications/annulation-client.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

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
        organisation_id: string;
        organisation: { nom: string } | { nom: string }[] | null;
        lieu?: { nom: string | null } | { nom: string | null }[] | null;
      }
    | null
    | undefined;
  // Périmètre d'écriture agence (miroir de la route traiteur) : ses propres
  // programmations (organisation_id = son orga). L'écriture qui suit passe par le
  // client de service : sans cette borne, seule la lecture RLS ci-dessus la
  // limiterait.
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

  if (c.statut === 'brouillon' || c.statut === 'programmee') {
    const frein = freiner();
    if (frein) return frein;

    const { error } = await admin.rpc('fn_modifier_collecte', {
      p_id: id,
      p_updates: { statut: 'annulee', annulee_cote_savr_motif: motif },
      p_champs_modifies: ['statut'],
    });
    if (error) return serverError(error, 'agence.collectes.annulation.directe');

    // L'ordre éventuel est en file : il part sans attendre le passage planifié
    // (décision Val 2026-10-12).
    envoyerOrdresSansAttendre(c.id);

    // Template 5 : confirmation au programmateur (l'équipe Savr reçoit le 22).
    await envoyerConfirmationAnnulation(admin, {
      programmateurId: evt.created_by,
      dateCollecte: c.date_collecte ?? '',
      lieuNom,
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
    const frein = freiner();
    if (frein) return frein;

    const { error } = await admin.rpc('fn_modifier_collecte', {
      p_id: id,
      p_updates: {
        statut: 'annulation_demandee',
        annulee_cote_savr_motif: motif,
      },
      p_champs_modifies: ['statut'],
    });
    if (error) return serverError(error, 'agence.collectes.annulation.demande');

    // L'ordre éventuel est en file : il part sans attendre le passage planifié
    // (décision Val 2026-10-12).
    envoyerOrdresSansAttendre(c.id);

    const demandeur = await lireCompte(admin, auth.ctx.userId);
    await sendEmail('admin_demande_annulation', 'contact@gosavr.io', {
      organisation_nom: orgNom ?? '',
      demandeur_nom: escapeHtml(demandeur?.nomComplet ?? ''),
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
