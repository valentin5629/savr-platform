import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { formatDateParis, instantParis } from '@savr/shared/src/temps/index.js';
import { urlCanonique } from '@/lib/url-application.js';
import { ESPACES, ESPACE_PAR_ROLE, ROUTES } from '@/lib/routes';
import type { Role } from '@/lib/roles';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';
import { libelleRole } from '@/lib/libelles/role';
import { heureCourte } from '@/lib/exports/shared';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

// ─── R22f / BL-P2-22 — Notifications aux tiers ─────────────────────────────────
// CDC §06.02 template 20 (collecte_programmee_tiers) : quand une agence ou un
// gestionnaire de lieux programme une collecte, les managers du traiteur
// opérationnel en sont informés (sauf fiche shadow).
// Template 21 (collecte_modifiee_tiers) : quand une collecte programmée par une
// agence ou un gestionnaire de lieux est modifiée ou annulée par quelqu'un
// d'autre, son programmateur en est informé (revue des emails, Val 2026-10-28).
//
// ⚠ Résolution/envoi via le client ADMIN (service_role) : le destinataire
// appartient à une AUTRE organisation que l'acteur → la RLS de l'acteur ne peut
// pas le lire. Chaque email ne porte que sur la collecte commune aux deux
// organisations. Best-effort, non bloquant.

// « Une collecte a été programmée chez vous » : managers du traiteur
// opérationnel seulement, plus les commerciaux (revue des emails, Val 2026-10-29).
const ROLES_DESTINATAIRES_PROGRAMMATION = ['traiteur_manager'];

// « Collecte modifiée / annulée » : le programmateur, s'il est d'une agence ou
// d'un gestionnaire de lieux (revue des emails, Val 2026-10-28).
const ROLES_PROGRAMMATEUR_TIERS = ['agence', 'gestionnaire_lieux'];
const ROLES_EQUIPE_SAVR = ['admin_savr', 'ops_savr'];

// Ces notifications n'ont pas de requête sous la main → `urlCanonique()`
// (lib/url-application.ts), seule source possible du domaine hors requête.

function libelleType(type: string | null | undefined): string {
  return type ? libelleTypeCollecte(type) : '';
}

const un = <T>(v: T | T[] | null | undefined): T | undefined =>
  Array.isArray(v) ? v[0] : (v ?? undefined);

/** « 12, rue de la Paix, 75002 Paris » — adresse d'accès, code postal et ville. */
export function adresseLieu(lieu: {
  adresse_acces?: string | null;
  code_postal?: string | null;
  ville?: string | null;
}): string {
  const cpVille = [lieu.code_postal, lieu.ville]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return [(lieu.adresse_acces ?? '').trim(), cpVille]
    .filter(Boolean)
    .join(', ');
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
  | { kind: 'annulation'; acteurUserId?: string | null };

interface ContexteCollecte {
  collecteId: string;
  dateCollecte: string;
  heureCollecte: string;
  type: string;
  traiteurOpOrgId: string;
  traiteurOpEstShadow: boolean;
  lieuNom: string;
  lieuAdresse: string;
  nomEvenement: string;
  programmeurUserId: string | null;
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
    .select(
      'traiteur_operationnel_organisation_id, lieu_id, nom_evenement, created_by',
    )
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
      .select('nom, adresse_acces, code_postal, ville')
      .eq('id', evt.lieu_id)
      .maybeSingle();
    if (lieu) {
      lieuNom = lieu.nom ?? '';
      lieuAdresse = adresseLieu(lieu);
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
    nomEvenement:
      (evt as { nom_evenement?: string | null }).nom_evenement ?? '',
    programmeurUserId:
      (evt as { created_by?: string | null }).created_by ?? null,
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

// Managers actifs (email résoluble) du traiteur opérationnel.
async function managersTraiteur(
  supabase: AdminSupabase,
  orgId: string,
): Promise<Array<{ email: string; prenom: string }>> {
  const { data } = await supabase
    .from('users')
    .select('email, prenom, actif, deleted_at, role')
    .eq('organisation_id', orgId)
    .in('role', ROLES_DESTINATAIRES_PROGRAMMATION)
    .eq('actif', true);
  return (data ?? [])
    .filter((u) => u.deleted_at === null && !!u.email)
    .map((u) => ({ email: u.email as string, prenom: u.prenom ?? '' }));
}

interface Compte {
  email: string | null;
  prenom: string | null;
  nom: string | null;
  role: string | null;
  organisation_id: string | null;
  actif: boolean | null;
  deleted_at: string | null;
}

async function lireCompte(
  supabase: AdminSupabase,
  userId: string | null | undefined,
): Promise<Compte | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from('users')
    .select('email, prenom, nom, role, organisation_id, actif, deleted_at')
    .eq('id', userId)
    .maybeSingle();
  return (data as Compte | null) ?? null;
}

/** Nom de la personne qui a fait le changement ; l'équipe Savr reste anonyme. */
function nomAuteur(compte: Compte | null): string {
  if (!compte) return '';
  if (compte.role && ROLES_EQUIPE_SAVR.includes(compte.role))
    return "l'équipe Savr";
  return [compte.prenom, compte.nom]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Notifie le traiteur opérationnel qu'un tiers a programmé une collecte le
 * concernant (template 20), ou le programmateur tiers qu'une collecte a été
 * annulée (template 21). No-op si la garde échoue, si le contexte est
 * irrésoluble ou sans destinataire. Best-effort.
 */
export async function notifierTraiteurOperationnel(
  supabase: AdminSupabase,
  params: {
    collecteId: string;
    acteurOrgId: string | null | undefined;
    changement: ChangementTiers;
  },
): Promise<void> {
  if (params.changement.kind === 'annulation') {
    await notifierProgrammateurTiers(supabase, {
      collecteId: params.collecteId,
      acteurUserId: params.changement.acteurUserId ?? null,
      kind: 'annulation',
    });
    return;
  }

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

  const managers = await managersTraiteur(supabase, ctx.traiteurOpOrgId);
  if (managers.length === 0) return;

  const orgProgrammatrice = await nomOrganisation(
    supabase,
    params.acteurOrgId as string,
  );
  const lienCollecte = urlCanonique(ROUTES.traiteur.collecte(ctx.collecteId));

  let programmeurNom = orgProgrammatrice;
  const programmeur = await lireCompte(
    supabase,
    params.changement.programmeurUserId,
  );
  if (programmeur) programmeurNom = nomAuteur(programmeur) || programmeurNom;

  // Texte interpolé tel quel dans le HTML du gabarit : tout ce qui vient d'une
  // saisie est échappé ici.
  for (const dest of managers) {
    await sendEmail(
      'collecte_programmee_tiers',
      dest.email,
      {
        prenom: escapeHtml(dest.prenom.trim()),
        organisation_programmatrice: escapeHtml(orgProgrammatrice),
        programmeur_nom: escapeHtml(programmeurNom),
        date_collecte: formatDateParis(ctx.dateCollecte),
        horaire_collecte: heureCourte(ctx.heureCollecte),
        lieu_nom: escapeHtml(ctx.lieuNom),
        lieu_adresse: escapeHtml(ctx.lieuAdresse),
        type_collecte: libelleType(ctx.type),
        lien_collecte: lienCollecte,
      },
      { entityType: 'collecte', entityId: ctx.collecteId },
    );
  }
}

/**
 * Template 21 (« Collecte modifiée / annulée ») : prévient le programmateur de
 * la collecte — créateur de l'événement — quand il est d'une agence ou d'un
 * gestionnaire de lieux et que le changement vient de quelqu'un d'autre
 * (revue des emails, Val 2026-10-28). Plus personne côté traiteur.
 * `listeModifications` : liste HTML déjà échappée (« avant / maintenant »).
 */
export async function notifierProgrammateurTiers(
  supabase: AdminSupabase,
  params: {
    collecteId: string;
    acteurUserId: string | null;
    kind: 'modification' | 'annulation';
    listeModifications?: string;
  },
): Promise<void> {
  const ctx = await resoudreContexte(supabase, params.collecteId);
  if (!ctx?.programmeurUserId) return;
  // Le programmateur qui fait lui-même le changement n'est pas prévenu.
  if (params.acteurUserId && params.acteurUserId === ctx.programmeurUserId)
    return;
  const programmeur = await lireCompte(supabase, ctx.programmeurUserId);
  if (
    !programmeur?.email ||
    programmeur.actif !== true ||
    programmeur.deleted_at !== null ||
    !programmeur.role ||
    !ROLES_PROGRAMMATEUR_TIERS.includes(programmeur.role) ||
    programmeur.organisation_id === ctx.traiteurOpOrgId
  )
    return;
  const espace = ESPACE_PAR_ROLE[programmeur.role as Role];
  if (!espace) return;
  if (params.kind === 'modification' && !params.listeModifications) return;

  const estAnnulation = params.kind === 'annulation';
  const auteur = await lireCompte(supabase, params.acteurUserId);
  const traiteurNom = await nomOrganisation(supabase, ctx.traiteurOpOrgId);

  await sendEmail(
    'collecte_modifiee_tiers',
    programmeur.email,
    {
      prenom: escapeHtml((programmeur.prenom ?? '').trim()),
      type_changement_libelle: estAnnulation ? 'annulée' : 'modifiée',
      est_modification: estAnnulation ? '' : 'true',
      est_annulation: estAnnulation ? 'true' : '',
      liste_modifications: estAnnulation
        ? ''
        : (params.listeModifications ?? ''),
      nom_evenement: escapeHtml(ctx.nomEvenement.trim() || 'Votre événement'),
      traiteur_nom: escapeHtml(traiteurNom),
      auteur_nom: escapeHtml(nomAuteur(auteur)),
      date_collecte: formatDateParis(ctx.dateCollecte),
      heure_collecte: heureCourte(ctx.heureCollecte),
      lieu_nom: escapeHtml(ctx.lieuNom),
      lien_collecte: urlCanonique(
        `${ESPACES[espace].prefixe}/collectes/${ctx.collecteId}`,
      ),
    },
    { entityType: 'collecte', entityId: ctx.collecteId },
  );
}

// ─── Template 22 — admin_collecte_annulee ──────────────────────────────────────
// CDC §06.02 l.583 : alerte Admin à TOUTE annulation de collecte, en parallèle du
// template 5 client (annulation_collecte). annulation_tardive = créneau < 4h.

const HEURE_MS = 60 * 60 * 1000;

// Seuil de l'annulation tardive, AG comme ZD (décision Val 2026-10-15, au lieu
// de 12h). Le trigger SQL de débit du pack porte le même : INTERVAL '4 hours'.
const SEUIL_ANNULATION_TARDIVE_HEURES = 4;

// True si l'annulation est « tardive » : moins de 4h avant le créneau
// (date_collecte + heure_collecte), strict. CDC §05. Pure, testable.
export function estAnnulationTardive(
  dateCollecte: string,
  heureCollecte: string | null | undefined,
  nowMs: number,
): boolean {
  if (!dateCollecte) return false;
  // Heure murale parisienne, comme le trigger SQL de débit du pack : sinon
  // l'alerte Admin peut annoncer « 4h ou plus » alors que le crédit a été débité.
  const creneau = instantParis(
    dateCollecte,
    heureCollecte && heureCollecte.length ? heureCollecte : '00:00:00',
  ).getTime();
  if (Number.isNaN(creneau)) return false;
  return creneau - nowMs < SEUIL_ANNULATION_TARDIVE_HEURES * HEURE_MS;
}

// Instant auquel se juge le délai, comme le trigger SQL de débit (décision Val
// 2026-10-15) : une demande d'annulation du client confirmée par l'Admin
// (annulation_demandee → annulee) se juge à sa réception
// (`collectes.annulation_demandee_at`) ; toute autre annulation, à l'instant où
// elle est faite. Pure, testable.
export function instantReferenceAnnulation(
  statutAvant: string | null | undefined,
  annulationDemandeeAt: string | null | undefined,
  nowMs: number,
): number {
  if (statutAvant === 'annulation_demandee' && annulationDemandeeAt) {
    const demande = Date.parse(annulationDemandeeAt);
    if (!Number.isNaN(demande)) return demande;
  }
  return nowMs;
}

/** Phrase de facturation d'une annulation tardive (moins de 4 h), vide sinon. */
export function infoFacturationAnnulation(
  type: string | null | undefined,
  tardive: boolean,
): string {
  if (!tardive) return '';
  return type === 'anti_gaspi' || type === 'ag'
    ? 'Un crédit de votre pack Anti-Gaspi a été décompté, conformément aux CGV.'
    : "L'annulation intervenant à moins de 4 heures du créneau, la collecte reste facturée, conformément aux CGV.";
}

/**
 * Alerte Admin « collecte annulée » (template 22), en parallèle du template 5
 * client. Best-effort. Organisation, lieu et événement sont relus ici quand
 * l'appelant ne les a pas.
 */
export async function notifierAdminAnnulation(
  supabase: AdminSupabase,
  params: {
    collecteId: string;
    organisationNom?: string;
    dateCollecte: string;
    heureCollecte?: string | null;
    lieuNom?: string;
    acteurUserId: string;
    acteurRole: string;
    motif?: string | null;
    infoFacturation?: string;
    // Statut quitté et heure de la demande du client : une demande confirmée
    // par l'Admin se juge à sa réception (cf. instantReferenceAnnulation).
    statutAvant?: string | null;
    annulationDemandeeAt?: string | null;
    nowMs?: number;
  },
): Promise<void> {
  const reference = instantReferenceAnnulation(
    params.statutAvant,
    params.annulationDemandeeAt,
    params.nowMs ?? Date.now(),
  );
  const tardive = estAnnulationTardive(
    params.dateCollecte,
    params.heureCollecte,
    reference,
  );

  const { data: col } = await supabase
    .from('collectes')
    .select(
      'type, evenement:evenements!inner(nom_evenement, organisation:organisations!organisation_id(nom), lieu:lieux!lieu_id(nom))',
    )
    .eq('id', params.collecteId)
    .maybeSingle();
  const evt = un(
    (
      col as {
        evenement?: EvenementAnnulation | EvenementAnnulation[];
      } | null
    )?.evenement,
  );
  const organisationNom =
    params.organisationNom || un(evt?.organisation)?.nom || '';
  const lieuNom = params.lieuNom || un(evt?.lieu)?.nom || '';
  const { data: u } = await supabase
    .from('users')
    .select('prenom, nom')
    .eq('id', params.acteurUserId)
    .maybeSingle();
  const userNom =
    (u ? `${u.prenom ?? ''} ${u.nom ?? ''}`.trim() : '') ||
    libelleRole(params.acteurRole);

  await sendEmail(
    'admin_collecte_annulee',
    'contact@gosavr.io',
    {
      type_collecte: libelleType(col?.type),
      organisation_nom: escapeHtml(organisationNom),
      date_collecte: formatDateParis(params.dateCollecte),
      heure_collecte: heureCourte(params.heureCollecte),
      lieu_nom: escapeHtml(lieuNom),
      nom_evenement: escapeHtml((evt?.nom_evenement ?? '').trim()),
      user_nom: escapeHtml(userNom),
      user_role: libelleRole(params.acteurRole),
      delai_avant_creneau: tardive
        ? `moins de ${SEUIL_ANNULATION_TARDIVE_HEURES} h`
        : `${SEUIL_ANNULATION_TARDIVE_HEURES} h ou plus`,
      motif: escapeHtml((params.motif ?? '').trim()),
      info_facturation: escapeHtml(params.infoFacturation ?? ''),
      annulation_tardive: tardive ? 'true' : '',
      lien_backoffice: urlCanonique(ROUTES.admin.collecte(params.collecteId)),
    },
    { entityType: 'collecte', entityId: params.collecteId },
  );
}

interface EvenementAnnulation {
  nom_evenement?: string | null;
  organisation?: { nom?: string | null } | { nom?: string | null }[] | null;
  lieu?: { nom?: string | null } | { nom?: string | null }[] | null;
}
