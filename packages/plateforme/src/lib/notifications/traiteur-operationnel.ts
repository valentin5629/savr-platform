import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

// ─── R22f / BL-P2-22 — Notifications tiers → traiteur opérationnel ─────────────
// CDC §06.02 templates 20 (collecte_programmee_tiers) et 21 (collecte_modifiee_
// tiers) : quand une collecte est programmée / modifiée / annulée par un TIERS
// (agence ou gestionnaire de lieux — org != traiteur opérationnel de l'événement),
// le traiteur opérationnel est notifié en INFO-ONLY, sauf s'il s'agit d'une fiche
// shadow (shadow → silencieux). Info-only : aucune action requise, aucune fuite
// (l'email porte sur SA propre collecte, envoyé à SA propre équipe).
//
// ⚠ Résolution/envoi via le client ADMIN (service_role) : l'équipe du traiteur
// opérationnel appartient à une AUTRE organisation que l'acteur → la RLS de
// l'acteur ne peut pas la lire. Le service_role est légitime ici (destinataire =
// le traiteur opérationnel concerné, jamais un tiers). Best-effort, non bloquant.

const TRAITEUR_TEAM_ROLES = ['traiteur_manager', 'traiteur_commercial'];

function appUrl(path: string): string {
  return `${process.env['NEXT_PUBLIC_APP_URL'] ?? ''}${path}`;
}

function libelleType(type: string | null | undefined): string {
  if (type === 'zero_dechet') return 'Zéro Déchet';
  if (type === 'anti_gaspi') return 'Anti-Gaspi';
  return type ?? '';
}

/**
 * Garde des templates 20/21 (CDC §06.02) : notifier le traiteur opérationnel
 * UNIQUEMENT si l'acteur (programmateur/modificateur/annulateur) est un tiers
 * — org distincte du traiteur opérationnel — ET que le traiteur opérationnel
 * n'est pas une fiche shadow. Pure, sans effet de bord (unit-testable).
 */
export function estTiersNonShadow(params: {
  traiteurOpOrgId: string | null | undefined;
  acteurOrgId: string | null | undefined;
  traiteurOpEstShadow: boolean;
}): boolean {
  const { traiteurOpOrgId, acteurOrgId, traiteurOpEstShadow } = params;
  if (!traiteurOpOrgId || !acteurOrgId) return false;
  return traiteurOpOrgId !== acteurOrgId && !traiteurOpEstShadow;
}

export type ChangementTiers =
  | { kind: 'programmation'; programmeurUserId?: string | null }
  | { kind: 'modification'; champsModifies?: string[] }
  | { kind: 'annulation' };

interface ContexteCollecte {
  collecteId: string;
  dateCollecte: string;
  heureCollecte: string;
  type: string;
  traiteurOpOrgId: string;
  traiteurOpEstShadow: boolean;
  lieuNom: string;
  lieuAdresse: string;
}

// Résout le contexte d'une collecte (collecte → événement → traiteur op → lieu).
// Renvoie null si une brique manque (best-effort : pas de notification bancale).
async function resoudreContexte(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<ContexteCollecte | null> {
  const { data: col } = await supabase
    .from('collectes')
    .select('date_collecte, heure_collecte, type, evenement_id')
    .eq('id', collecteId)
    .maybeSingle();
  if (!col?.evenement_id) return null;

  const { data: evt } = await supabase
    .from('evenements')
    .select('traiteur_operationnel_organisation_id, lieu_id')
    .eq('id', col.evenement_id)
    .maybeSingle();
  if (!evt?.traiteur_operationnel_organisation_id) return null;

  const { data: org } = await supabase
    .from('organisations')
    .select('est_shadow')
    .eq('id', evt.traiteur_operationnel_organisation_id)
    .maybeSingle();
  if (!org) return null;

  let lieuNom = '';
  let lieuAdresse = '';
  if (evt.lieu_id) {
    const { data: lieu } = await supabase
      .from('lieux')
      .select('nom, adresse_acces, code_postal')
      .eq('id', evt.lieu_id)
      .maybeSingle();
    if (lieu) {
      lieuNom = lieu.nom ?? '';
      lieuAdresse = [lieu.adresse_acces, lieu.code_postal]
        .filter(Boolean)
        .join(', ');
    }
  }

  return {
    collecteId,
    dateCollecte: col.date_collecte ?? '',
    heureCollecte: col.heure_collecte ?? '',
    type: col.type ?? '',
    traiteurOpOrgId: evt.traiteur_operationnel_organisation_id,
    traiteurOpEstShadow: org.est_shadow === true,
    lieuNom,
    lieuAdresse,
  };
}

async function nomOrganisation(
  supabase: AdminSupabase,
  orgId: string,
): Promise<string> {
  const { data } = await supabase
    .from('organisations')
    .select('nom')
    .eq('id', orgId)
    .maybeSingle();
  return data?.nom ?? '';
}

// Équipe (manager + commerciaux actifs, email résoluble) du traiteur opérationnel.
async function equipeTraiteur(
  supabase: AdminSupabase,
  orgId: string,
): Promise<Array<{ email: string; prenom: string }>> {
  const { data } = await supabase
    .from('users')
    .select('email, prenom, actif, deleted_at, role')
    .eq('organisation_id', orgId)
    .in('role', TRAITEUR_TEAM_ROLES)
    .eq('actif', true);
  return (data ?? [])
    .filter((u) => u.deleted_at === null && !!u.email)
    .map((u) => ({ email: u.email as string, prenom: u.prenom ?? '' }));
}

async function fluxList(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<string> {
  const { data } = await supabase
    .from('collecte_flux')
    .select('flux:flux_dechets(nom)')
    .eq('collecte_id', collecteId);
  const noms = (data ?? [])
    .map((r) => {
      const f = (r as { flux?: { nom?: string } | { nom?: string }[] }).flux;
      const one = Array.isArray(f) ? f[0] : f;
      return one?.nom ?? '';
    })
    .filter(Boolean);
  return noms.join(', ');
}

function humaniser(champ: string): string {
  return champ.replace(/_/g, ' ');
}

/**
 * Notifie le traiteur opérationnel qu'un tiers a programmé / modifié / annulé une
 * collecte le concernant (templates 20/21). No-op si garde tiers-non-shadow KO,
 * si le contexte est irrésoluble, ou si l'équipe est vide. Best-effort.
 */
export async function notifierTraiteurOperationnel(
  supabase: AdminSupabase,
  params: {
    collecteId: string;
    acteurOrgId: string | null | undefined;
    changement: ChangementTiers;
  },
): Promise<void> {
  const ctx = await resoudreContexte(supabase, params.collecteId);
  if (!ctx) return;
  if (
    !estTiersNonShadow({
      traiteurOpOrgId: ctx.traiteurOpOrgId,
      acteurOrgId: params.acteurOrgId,
      traiteurOpEstShadow: ctx.traiteurOpEstShadow,
    })
  )
    return;

  const equipe = await equipeTraiteur(supabase, ctx.traiteurOpOrgId);
  if (equipe.length === 0) return;

  const orgProgrammatrice = await nomOrganisation(
    supabase,
    params.acteurOrgId as string,
  );
  const lienCollecte = appUrl(`/traiteur/collectes/${ctx.collecteId}`);

  if (params.changement.kind === 'programmation') {
    let programmeurNom = orgProgrammatrice;
    const uid = params.changement.programmeurUserId;
    if (uid) {
      const { data: u } = await supabase
        .from('users')
        .select('prenom, nom')
        .eq('id', uid)
        .maybeSingle();
      if (u) programmeurNom = `${u.prenom ?? ''} ${u.nom ?? ''}`.trim();
    }
    const flux = await fluxList(supabase, ctx.collecteId);
    for (const dest of equipe) {
      await sendEmail(
        'collecte_programmee_tiers',
        dest.email,
        {
          prenom: dest.prenom,
          organisation_programmatrice: orgProgrammatrice,
          programmeur_nom: programmeurNom,
          date_collecte: ctx.dateCollecte,
          horaire_collecte: ctx.heureCollecte,
          lieu_nom: ctx.lieuNom,
          lieu_adresse: ctx.lieuAdresse,
          type_collecte: libelleType(ctx.type),
          flux_list: flux,
          lien_collecte: lienCollecte,
        },
        { entityType: 'collecte', entityId: ctx.collecteId },
      );
    }
    return;
  }

  // modification | annulation → template 21 (variable type_changement)
  const estAnnulation = params.changement.kind === 'annulation';
  const typeChangement = estAnnulation ? 'annulation' : 'modification';
  const libelle = estAnnulation ? 'annulée' : 'modifiée';
  const diffList =
    params.changement.kind === 'modification'
      ? (params.changement.champsModifies ?? []).map(humaniser).join(', ')
      : '';

  for (const dest of equipe) {
    await sendEmail(
      'collecte_modifiee_tiers',
      dest.email,
      {
        prenom: dest.prenom,
        organisation_programmatrice: orgProgrammatrice,
        type_changement: typeChangement,
        type_changement_libelle: libelle,
        est_modification: estAnnulation ? 'false' : 'true',
        est_annulation: estAnnulation ? 'true' : 'false',
        date_collecte: ctx.dateCollecte,
        lieu_nom: ctx.lieuNom,
        diff_list: diffList,
        lien_collecte: lienCollecte,
      },
      { entityType: 'collecte', entityId: ctx.collecteId },
    );
  }
}

// ─── Template 22 — admin_collecte_annulee ──────────────────────────────────────
// CDC §06.02 l.583 : alerte Admin à TOUTE annulation de collecte, en parallèle du
// template 5 client (annulation_collecte). annulation_tardive = créneau < 12h.

const HEURE_MS = 60 * 60 * 1000;

// True si l'annulation est « tardive » : moins de 12h avant le créneau
// (date_collecte + heure_collecte). CDC §05 (seuil AG 12h). Pure, testable.
export function estAnnulationTardive(
  dateCollecte: string,
  heureCollecte: string | null | undefined,
  nowMs: number,
): boolean {
  if (!dateCollecte) return false;
  const creneau = new Date(
    `${dateCollecte}T${heureCollecte && heureCollecte.length ? heureCollecte : '00:00:00'}`,
  ).getTime();
  if (Number.isNaN(creneau)) return false;
  return creneau - nowMs < 12 * HEURE_MS;
}

/**
 * Alerte Admin « collecte annulée » (template 22), en parallèle du template 5
 * client. Best-effort. `collecteRef`/`organisationNom` réutilisent ce que la route
 * a déjà résolu (cohérence avec annulation_collecte).
 */
export async function notifierAdminAnnulation(
  supabase: AdminSupabase,
  params: {
    collecteId: string;
    collecteRef: string;
    organisationNom: string;
    dateCollecte: string;
    heureCollecte?: string | null;
    lieuNom?: string;
    acteurUserId: string;
    acteurRole: string;
    infoFacturation?: string;
    nowMs?: number;
  },
): Promise<void> {
  const now = params.nowMs ?? Date.now();
  const tardive = estAnnulationTardive(
    params.dateCollecte,
    params.heureCollecte,
    now,
  );

  // Type de collecte + nom lisible de l'acteur (best-effort).
  const { data: col } = await supabase
    .from('collectes')
    .select('type')
    .eq('id', params.collecteId)
    .maybeSingle();
  const { data: u } = await supabase
    .from('users')
    .select('prenom, nom')
    .eq('id', params.acteurUserId)
    .maybeSingle();
  const userNom = u
    ? `${u.prenom ?? ''} ${u.nom ?? ''}`.trim() || params.acteurUserId
    : params.acteurUserId;

  await sendEmail(
    'admin_collecte_annulee',
    'hello@gosavr.io',
    {
      collecte_ref: params.collecteRef,
      type_collecte: libelleType(col?.type),
      organisation_nom: params.organisationNom,
      date_collecte: params.dateCollecte,
      lieu_nom: params.lieuNom ?? '',
      user_nom: userNom,
      user_role: params.acteurRole,
      delai_avant_creneau: tardive ? 'moins de 12h' : '12h ou plus',
      info_facturation: params.infoFacturation ?? '',
      annulation_tardive: tardive ? 'true' : 'false',
      lien_backoffice: appUrl(`/admin/collectes/${params.collecteId}`),
    },
    { entityType: 'collecte', entityId: params.collecteId },
  );
}
