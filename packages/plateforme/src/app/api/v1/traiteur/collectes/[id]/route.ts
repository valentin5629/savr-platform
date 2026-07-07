import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
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
  evenement: {
    created_by: string;
    organisation_id: string;
    organisation?: { nom: string } | null;
  } | null;
}

async function loadCollecteForUser(id: string): Promise<CollecteRow | null> {
  // Lecture RLS-scopée : si la collecte n'est pas visible (cross-org), null.
  // Le nom de l'organisation programmatrice alimente l'email Ops de modification.
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from('collectes')
    .select(
      `id, statut, statut_tms, date_collecte, heure_collecte,
       evenement:evenements!inner(created_by, organisation_id,
         organisation:organisations!organisation_id(nom))`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const evtRaw = Array.isArray(data.evenement)
    ? data.evenement[0]
    : data.evenement;
  // PostgREST embarque les relations imbriquées en tableau → normaliser organisation.
  const org = evtRaw
    ? Array.isArray(evtRaw.organisation)
      ? (evtRaw.organisation[0] ?? null)
      : (evtRaw.organisation ?? null)
    : null;
  const evenement = evtRaw
    ? {
        created_by: evtRaw.created_by,
        organisation_id: evtRaw.organisation_id,
        organisation: org,
      }
    : null;
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

  // Enrichissements fiche (BL-P1-TRAIT-03) — lecture service-role APRÈS le contrôle
  // d'appartenance RLS ci-dessus (la collecte est visible = appartient au traiteur) :
  //  · tournées → plaque + nom chauffeur pour le bloc « Contrôle d'accès »
  //  · disponibilité du rapport RSE (embargo H+24) pour le bouton de téléchargement
  //  · factures rattachées (via factures_collectes) pour le bouton « Télécharger la facture »
  const admin = createAdminSupabaseClient();
  const isAg = (data as { type: string }).type === 'anti_gaspi';
  // AG realisee_sans_collecte (BL-P1-RPT-02) : pas d'attestation → le « rapport RSE » est
  // le rapport « Événement sans excédent » (rapports_rse, sans embargo). ZD et AG
  // sans-excédent lisent rapports_rse ; l'AG cloturee lit l'attestation.
  const isSansExcedent =
    isAg && (data as { statut: string }).statut === 'realisee_sans_collecte';
  const useRapportsRse = !isAg || isSansExcedent;
  const [ctRes, rapRes, attRes, fcRes] = await Promise.all([
    admin
      .from('collecte_tournees')
      .select(
        'tournee:tournees(plaque_immatriculation, chauffeur_nom, type_vehicule, plaque_saisie_at, prestataire_logistique_id)',
      )
      .eq('collecte_id', id),
    admin
      .from('rapports_rse')
      .select('disponible_a, genere_at, regenere_at')
      .eq('collecte_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // AG (option a Val 2026-07-07) : le « rapport RSE » d'une collecte AG EST
    // l'attestation → disponibilité/embargo lus sur attestations_don.
    admin
      .from('attestations_don')
      .select('eligible_at, pdf_url')
      .eq('collecte_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('factures_collectes')
      .select(
        'facture:factures(id, numero_facture, statut, pdf_url_savr, pdf_url_pennylane)',
      )
      .eq('collecte_id', id),
  ]);

  type TourneeRow = {
    plaque_immatriculation: string | null;
    chauffeur_nom: string | null;
    type_vehicule: string | null;
    plaque_saisie_at: string | null;
    prestataire_logistique_id: string | null;
  };
  const tourneesRaw: TourneeRow[] = (
    (ctRes.data ?? []) as Array<{
      tournee: TourneeRow | TourneeRow[] | null;
    }>
  )
    .map((r) => (Array.isArray(r.tournee) ? r.tournee[0] : r.tournee))
    .filter((t): t is TourneeRow => Boolean(t));

  // Nom du prestataire (badge « Communiqué par … ») — shared.prestataires n'est
  // jamais embarqué (cross-schema) → résolution par requête batch (cf. route liste).
  const prestaIds = [
    ...new Set(
      tourneesRaw
        .map((t) => t.prestataire_logistique_id)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const prestaNoms = new Map<string, string>();
  if (prestaIds.length > 0) {
    const { data: prestas } = await admin
      .schema('shared')
      .from('prestataires')
      .select('id, nom')
      .in('id', prestaIds);
    for (const p of (prestas ?? []) as { id: string; nom: string }[]) {
      prestaNoms.set(p.id, p.nom);
    }
  }
  const tournees = tourneesRaw.map((t) => ({
    plaque_immatriculation: t.plaque_immatriculation,
    chauffeur_nom: t.chauffeur_nom,
    type_vehicule: t.type_vehicule,
    plaque_saisie_at: t.plaque_saisie_at,
    prestataire_nom: t.prestataire_logistique_id
      ? (prestaNoms.get(t.prestataire_logistique_id) ?? null)
      : null,
  }));

  const rap = rapRes.data as {
    disponible_a: string | null;
    genere_at: string | null;
    regenere_at: string | null;
  } | null;
  const att = attRes.data as {
    eligible_at: string | null;
    pdf_url: string | null;
  } | null;
  // Disponibilité du « rapport RSE » : rapports_rse (rendu + embargo) pour ZD et AG
  // sans-excédent ; attestation pour l'AG cloturee. Le rapport sans-excédent n'a pas
  // d'embargo (disponible_a = genere_at) : la garde disponible_a <= now est immédiate.
  const rapport_rse_disponible = useRapportsRse
    ? Boolean(rap?.genere_at) &&
      rap?.disponible_a != null &&
      new Date(rap.disponible_a).getTime() <= Date.now()
    : Boolean(att?.pdf_url) &&
      att?.eligible_at != null &&
      new Date(att.eligible_at).getTime() <= Date.now();
  // Picto « rapport régénéré » (§12 §1.4) — porté par rapports_rse.regenere_at (ZD +
  // AG sans-excédent régénéré par l'Admin).
  const rapport_rse_regenere = useRapportsRse && Boolean(rap?.regenere_at);
  // Régénération traiteur (RPT-04, décision Val 2026-07-07) : manager, ZD uniquement
  // (attestation AG + rapport sans-excédent = régénérables par l'Admin seul, §12 §1.3/§1.3-bis).
  const can_regenerate = auth.ctx.role === 'traiteur_manager' && !isAg;

  type FactureInfo = {
    id: string;
    numero_facture: string;
    statut: string;
    pdf_url_savr: string | null;
    pdf_url_pennylane: string | null;
  };
  const factures: FactureInfo[] = (
    (fcRes.data ?? []) as Array<{
      facture: FactureInfo | FactureInfo[] | null;
    }>
  )
    .map((r) => (Array.isArray(r.facture) ? r.facture[0] : r.facture))
    .filter((f): f is FactureInfo => Boolean(f));

  return NextResponse.json({
    data: {
      ...data,
      tournees,
      rapport_rse_disponible,
      rapport_rse_regenere,
      can_regenerate,
      factures,
    },
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
    old_values: before ?? {},
    new_values: { updates, cascade_tms, priorite_urgence },
  });

  // Alerte Ops de modification (§05 l.316-318) — une seule alerte, sévérité
  // modulée par la proximité du créneau : priorité « normale » >= 12h, « haute »
  // < 12h (le modal de confirmation côté traiteur double le cas < 12h).
  const orgNom = collecte.evenement?.organisation?.nom ?? '';
  await sendEmail('admin_modification_collecte_traiteur', 'hello@gosavr.io', {
    organisation_nom: orgNom,
    demandeur_nom: auth.ctx.userId,
    collecte_ref: id,
    date_collecte: collecte.date_collecte ?? '',
    champs_modifies: Object.keys(updates).join(', '),
    priorite: priorite_urgence ? 'haute' : 'normale',
  });

  return NextResponse.json({
    data: updated,
    flags: { priorite_urgence, reacceptation_requise, cascade_tms },
  });
}
