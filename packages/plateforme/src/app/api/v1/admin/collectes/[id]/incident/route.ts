import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { notifierAdminAnnulation } from '@/lib/notifications/traiteur-operationnel.js';
import { requireStaff } from '@/lib/api-auth.js';
import { readJsonBody, serverError, withApiTrace } from '@/lib/api-helpers.js';

// POST /api/v1/admin/collectes/[id]/incident — §05 §4bis « Gestion des incidents »
// Flux incident (collecte manquée / refus / pesée) : passe la collecte à `annulee`
// + renseigne `incident_imputable_a` + `motif_incident` (via fn_modifier_collecte,
// même UPDATE → le trigger pack-debit saute le débit si imputable ≠ client, RM-09).
// Émet l'alerte Admin (template `admin_incident_collecte`, §06.02 item 10).
const IMPUTABLE = ['prestataire', 'client', 'association', 'savr', 'externe'];

async function postHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = await readJsonBody(req);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data as {
    incident_imputable_a?: string;
    motif_incident?: string;
    collecte_remplacee_id?: string;
  };

  const imputable = body.incident_imputable_a;
  if (!imputable || !IMPUTABLE.includes(imputable)) {
    return NextResponse.json(
      {
        error: `incident_imputable_a invalide (attendu : ${IMPUTABLE.join(', ')})`,
      },
      { status: 422 },
    );
  }
  const motif =
    typeof body.motif_incident === 'string' ? body.motif_incident.trim() : '';
  if (motif.length < 10) {
    return NextResponse.json(
      { error: 'Un motif d’incident d’au moins 10 caractères est requis' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Contexte collecte (statut + lieu/date + programmeur pour les emails) via l'événement.
  const { data: before, error: fetchErr } = await supabase
    .from('collectes')
    .select(
      `id, statut, type, date_collecte, heure_collecte,
       evenements!inner(created_by, lieux!lieu_id(nom))`,
    )
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !before) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }

  // Un incident bascule la collecte à `annulee` : uniquement depuis un statut non
  // terminal (§05 §4bis : collecte manquée / refus avant clôture). Réalisée/clôturée
  // = correction par édition Admin + avoir, pas un incident d'annulation.
  const statutCourant = (before as { statut: string }).statut;
  if (
    !['programmee', 'validee', 'en_cours', 'annulation_demandee'].includes(
      statutCourant,
    )
  ) {
    return NextResponse.json(
      { error: `Incident impossible au statut ${statutCourant}` },
      { status: 422 },
    );
  }

  const updates: Record<string, unknown> = {
    statut: 'annulee',
    incident_imputable_a: imputable,
    motif_incident: motif,
  };
  if (typeof body.collecte_remplacee_id === 'string') {
    updates['collecte_remplacee_id'] = body.collecte_remplacee_id;
  }

  const { data: updatedJson, error } = await supabase.rpc(
    'fn_modifier_collecte',
    {
      p_id: id,
      p_updates: updates,
      p_champs_modifies: Object.keys(updates),
    },
  );
  if (error) return serverError(error, 'admin.collectes.incident');

  // Audit §07/06 : la bascule manuelle de statut (annulee) via incident = statut forcé.
  await supabase.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: 'collecte_statut_force',
    user_id: auth.ctx.userId,
    motif,
    old_values: { statut: statutCourant },
    new_values: { statut: 'annulee', incident_imputable_a: imputable },
  });

  // Contexte événement (lieu + programmeur) pour les notifications.
  const evt = (
    before as {
      evenements?: {
        created_by?: string;
        lieux?: { nom?: string } | { nom?: string }[];
      };
    }
  ).evenements;
  const evtObj = Array.isArray(evt) ? evt[0] : evt;
  const lieu = Array.isArray(evtObj?.lieux) ? evtObj?.lieux[0] : evtObj?.lieux;
  const dateCollecte =
    (before as { date_collecte?: string }).date_collecte ?? '';

  // Alerte Admin — template §06.02 item 10 (destinataire admin_savr).
  await sendEmail('admin_incident_collecte', 'hello@gosavr.io', {
    lieu_nom: lieu?.nom ?? '',
    date_collecte: dateCollecte,
    type_incident: 'collecte_manquee',
    imputable_a: imputable,
    description: motif,
    lien_collecte: `https://app.gosavr.io/admin/collectes/${id}`,
  });

  // Notification automatique au client (§05 §4bis l.347) : le programmeur de la
  // collecte est informé de l'annulation. Facturation : un incident NON imputable au
  // client (prestataire/savr/association/externe) n'est pas facturé (§05 §4bis) ; un
  // incident imputable au client suit la règle d'annulation tardive standard.
  const createdBy = evtObj?.created_by;
  if (createdBy) {
    const { data: prog } = await supabase
      .from('users')
      .select('email, prenom')
      .eq('id', createdBy)
      .maybeSingle();
    const email = (prog as { email?: string } | null)?.email;
    if (email) {
      const infoFacturation =
        imputable === 'client' ? '' : ' Cet incident ne vous sera pas facturé.';
      await sendEmail('annulation_collecte', email, {
        prenom: (prog as { prenom?: string } | null)?.prenom ?? '',
        date_collecte: dateCollecte,
        lieu_nom: lieu?.nom ?? '',
        motif: `Incident survenu lors de la collecte : ${motif}.${infoFacturation}`,
      });
    }
  }

  // BL-P2-22 (tpl 22) : alerte Admin « collecte annulée », en parallèle du
  // template 5 (annulation_collecte). Le nom d'organisation est résolu par le
  // helper. Best-effort, en dernier (complément de l'alerte incident, dossier
  // distinct — jamais bloquant pour la réponse).
  void notifierAdminAnnulation(supabase, {
    collecteId: id,
    collecteRef: id,
    dateCollecte,
    heureCollecte: (before as { heure_collecte?: string | null })
      .heure_collecte,
    lieuNom: lieu?.nom ?? '',
    acteurUserId: auth.ctx.userId,
    acteurRole: auth.ctx.role,
    infoFacturation:
      imputable === 'client' ? '' : 'Incident non imputable au client',
  }).catch(() => undefined);

  return NextResponse.json(updatedJson);
}

export const POST = withApiTrace(postHandler);
