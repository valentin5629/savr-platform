import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { validerChampsTexteLibre } from '@/lib/champs-texte-libre.js';
import { refusHeureCollecte } from '@/lib/heure-collecte.js';
import { chargerFicheCollecteClient } from '@/lib/collectes/fiche-client.js';
import {
  derniereModificationEvenement,
  modificationUrgente,
  notifierEquipeModificationCollecte,
} from '@/lib/collectes/email-modification.js';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

// Champs métier éditables côté traiteur (§06.04 §Édition). type_collecte, lieu_id
// et traiteur sont verrouillés (sobriété A4) → rejetés explicitement.
// `notes_internes` n'en fait PAS partie : commentaire Admin Savr « non visible
// par le client » (§04 Data Model) — arbitrage Val 2026-09-29 (C1).
const EDITABLE_FIELDS = [
  'date_collecte',
  'heure_collecte',
  'controle_acces_requis',
  'informations_supplementaires',
];
const LOCKED_FIELDS = ['type', 'type_collecte', 'lieu_id', 'organisation_id'];

interface CollecteRow {
  id: string;
  statut: string;
  statut_tms: string;
  date_collecte: string;
  heure_collecte: string | null;
  evenement: {
    created_by: string;
    organisation_id: string;
  } | null;
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
  const evenement = Array.isArray(data.evenement)
    ? (data.evenement[0] ?? null)
    : data.evenement;
  return { ...data, evenement } as unknown as CollecteRow;
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

  // Socle commun des fiches clientes (pop-up §06.04, refonte 2026-09-29) :
  // contrôle RLS d'abord, puis lectures service-role bornées à CETTE collecte ;
  // ni notes internes, ni prestataire, téléphone chauffeur dans la seule fenêtre
  // programmee/validee/en_cours.
  const r = await chargerFicheCollecteClient(id, auth.ctx, 'traiteur');
  if ('erreur' in r) return serverError(r.erreur, 'traiteur.collectes.get');
  if ('introuvable' in r)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  const { fiche, contexte } = r;

  const admin = createAdminSupabaseClient();

  // Factures rattachées (bouton « Télécharger la facture », §06.04 actions).
  // Lues sous la RLS de l'UTILISATEUR (fc_select / fac_client_select) : une
  // collecte programmée par une agence ou un gestionnaire est facturée à CETTE
  // organisation, pas au traiteur opérationnel — une lecture service-role
  // bornée à la seule collecte lui servait la facture d'un tiers (fuite
  // inter-organisation mesurée en revue sécurité 2026-09-29). Brouillons exclus
  // côté serveur (jamais téléchargeables).
  type FactureInfo = {
    id: string;
    numero_facture: string;
    statut: string;
    pdf_url_savr: string | null;
    pdf_url_pennylane: string | null;
  };
  const { data: fcData } = await createSupabaseServerClient()
    .from('factures_collectes')
    .select(
      'facture:factures(id, numero_facture, statut, pdf_url_savr, pdf_url_pennylane)',
    )
    .eq('collecte_id', id);
  const factures: FactureInfo[] = (
    (fcData ?? []) as Array<{ facture: FactureInfo | FactureInfo[] | null }>
  )
    .map((f) => (Array.isArray(f.facture) ? f.facture[0] : f.facture))
    .filter((f): f is FactureInfo => f != null && f.statut !== 'brouillon');

  // Régénération traiteur (RPT-04, décision Val 2026-07-07) : manager, ZD
  // uniquement (attestation AG + rapport sans-excédent = Admin seul).
  const can_regenerate =
    auth.ctx.role === 'traiteur_manager' && fiche.type !== 'anti_gaspi';

  // Badge « Programmée par » (§06.04, ajout 2026-05-07) — seulement quand
  // l'événement a été programmé par un TIERS (agence / gestionnaire de lieux).
  // Lecture service-role bornée à CETTE organisation et à 3 colonnes, car le
  // traiteur n'a pas de SELECT RLS sur une organisation qui n'est pas la sienne.
  let programmee_par: {
    nom: string;
    type: string;
    email: string | null;
  } | null = null;
  if (
    contexte.traiteurOperationnelId != null &&
    contexte.organisationProgrammatriceId !== contexte.traiteurOperationnelId
  ) {
    const { data: orgProg } = await admin
      .from('organisations')
      .select('nom, type, email_principal')
      .eq('id', contexte.organisationProgrammatriceId)
      .maybeSingle();
    if (orgProg)
      programmee_par = {
        nom: orgProg.nom,
        type: orgProg.type,
        email: orgProg.email_principal,
      };
  }

  return NextResponse.json({
    data: { ...fiche, programmee_par, factures, can_regenerate },
  });
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
  const priorite_urgence = modificationUrgente(
    collecte.date_collecte,
    collecte.heure_collecte,
  );
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
  if (error) return serverError(error, 'traiteur.collectes.update');

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
    old_values: before ?? {},
    new_values: { updates, cascade_tms, priorite_urgence },
  });

  // Email à l'équipe Savr (§06.02 n°19, §05 « Modification d'une collecte à
  // venir ») : UN email par enregistrement. Le formulaire enregistre l'événement
  // (pax, contacts…) puis la collecte ; quand il vient de modifier l'événement il
  // le signale (`evenement_modifie`), et cette modification est relue dans le
  // journal d'audit — jamais dans la requête.
  const avant = (before ?? null) as Record<string, unknown> | null;
  await notifierEquipeModificationCollecte(admin, {
    collecteId: id,
    collecteAvant: avant,
    majCollecte: updates,
    ...(body.evenement_modifie === true
      ? await derniereModificationEvenement(
          admin,
          avant?.evenement_id,
          auth.ctx.userId,
        )
      : {}),
  });

  return NextResponse.json({
    data: updated,
    flags: { priorite_urgence, reacceptation_requise, cascade_tms },
  });
}
