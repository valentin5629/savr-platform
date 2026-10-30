// Logo du client déposé depuis la fiche collecte (décision Val 2026-10-30).
//
// Qui : tout utilisateur qui peut télécharger le rapport de la collecte — équipe
// Savr, traiteur (manager et commercial), agence, gestionnaire de lieux. Même
// garde que le bouton « Télécharger le rapport » : collecte visible sous la RLS
// de l'utilisateur, non annulée, et rapport non réservé au donneur d'ordre (D12 :
// un traiteur opérationnel ne dépose pas le logo du rapport d'une agence).
//
// Où : sur l'événement (`evenements.logo_client_organisateur_url`), donc pour
// toutes ses collectes et pour tous ceux qui téléchargent. Le logo déposé prime
// dans la cascade (lib/pdf/logo-cascade).
//
// Effet sur les documents déjà fabriqués : les rapports de don stockés des
// collectes de l'événement (attestation de don, rapport « sans excédent ») sont
// remis en fabrication, avec le nouveau logo (lib/pdf/regenerate). Le rapport de
// recyclage ZD et les rapports cumulés, fabriqués au clic, le prennent d'eux-mêmes.
//
// L'écriture et la lecture du logo passent par le service-role, APRÈS le contrôle
// d'accès sous RLS : la colonne n'est pas dans la liste blanche SELECT des
// clients (20261001103000) et la plupart d'entre eux n'ont aucun droit UPDATE
// sur l'événement. Le format de la clé reste gardé en base (trg_garde_format_logo).

import { NextResponse, type NextRequest } from 'next/server';
import {
  createAdminSupabaseClient,
  type SupabaseClient,
} from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { createSupabaseServerClient, type AnyRole } from '@/lib/api-auth.js';
import { messageErreur, serverError } from '@/lib/api-helpers.js';
import {
  rapportReserveDonneurOrdre,
  STATUTS_ANNULES,
} from '@/lib/collectes/fiche-client-types.js';
import { parseCleLogo } from '@/lib/logo-key.js';
import { televerserLogo } from '@/lib/logo-upload.js';
import { servirLogo } from '@/lib/logo-proxy.js';
import { regenerateCollecteDocument } from '@/lib/pdf/regenerate.js';

export interface ActeurLogo {
  userId: string;
  role: AnyRole;
  /** Organisation de l'utilisateur (null pour l'équipe Savr). */
  organisationId: string | null;
  isStaff: boolean;
  /** Admin réel d'une session impersonée (à reporter dans audit_log). */
  impersonatorId?: string;
}

/** Acteur d'une route : contexte rendu par la garde de session de l'espace. */
export function acteurDepuis(
  ctx: {
    userId: string;
    role: AnyRole;
    organisationId: string | null;
    impersonatorId?: string;
  },
  isStaff: boolean,
): ActeurLogo {
  return {
    userId: ctx.userId,
    role: ctx.role,
    organisationId: ctx.organisationId,
    isStaff,
    impersonatorId: ctx.impersonatorId,
  };
}

const ROLES_TRAITEUR = ['traiteur_manager', 'traiteur_commercial'];

type AccesLogo =
  | { ok: true; evenementId: string }
  | { ok: false; reponse: NextResponse };

/**
 * Contrôle d'accès : la collecte doit être visible sous la RLS de l'utilisateur
 * et son rapport téléchargeable par lui. Rend l'événement de la collecte.
 */
async function controlerAcces(
  collecteId: string,
  acteur: ActeurLogo,
): Promise<AccesLogo> {
  const rls = createSupabaseServerClient();
  const { data, error } = await rls
    .from('collectes')
    .select('id, type, statut, evenement_id, evenements ( organisation_id )')
    .eq('id', collecteId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      reponse: serverError(error, 'collectes.logo_client.lecture'),
    };
  }
  const c = data as {
    type: string;
    statut: string;
    evenement_id: string | null;
    evenements: { organisation_id: string | null } | null;
  } | null;
  if (!c || !c.evenement_id) {
    return {
      ok: false,
      reponse: NextResponse.json(
        { error: 'Collecte introuvable' },
        { status: 404 },
      ),
    };
  }
  if (STATUTS_ANNULES.includes(c.statut)) {
    return {
      ok: false,
      reponse: NextResponse.json(
        { error: 'Collecte annulée : aucun rapport à personnaliser' },
        { status: 409 },
      ),
    };
  }
  if (
    !acteur.isStaff &&
    ROLES_TRAITEUR.includes(acteur.role) &&
    rapportReserveDonneurOrdre(
      c,
      c.evenements?.organisation_id,
      acteur.organisationId ?? '',
    )
  ) {
    return {
      ok: false,
      reponse: NextResponse.json(
        { error: 'Réservé à l’organisation qui a programmé la collecte' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, evenementId: c.evenement_id };
}

async function lireCleLogo(
  admin: SupabaseClient,
  evenementId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('evenements')
    .select('logo_client_organisateur_url')
    .eq('id', evenementId)
    .single();
  if (error) throw error;
  return (
    (data as { logo_client_organisateur_url: string | null } | null)
      ?.logo_client_organisateur_url ?? null
  );
}

/** GET : affiche le logo déposé sur l'événement de la collecte (404 sans logo). */
export async function servirLogoClient(
  collecteId: string,
  acteur: ActeurLogo,
): Promise<NextResponse> {
  const acces = await controlerAcces(collecteId, acteur);
  if (!acces.ok) return acces.reponse;
  let valeur: string | null;
  try {
    valeur = await lireCleLogo(createAdminSupabaseClient(), acces.evenementId);
  } catch (e) {
    return serverError(e, 'collectes.logo_client.lecture_logo');
  }
  const cle = parseCleLogo(valeur);
  if (!cle) return NextResponse.json({ error: 'Aucun logo' }, { status: 404 });
  return servirLogo(cle);
}

/** POST : contrôle d'accès, envoi du fichier, puis enregistrement sur l'événement. */
export async function deposerLogoClient(
  req: NextRequest,
  collecteId: string,
  acteur: ActeurLogo,
): Promise<NextResponse> {
  // L'accès d'abord : rien n'est envoyé au stockage pour une collecte refusée.
  const acces = await controlerAcces(collecteId, acteur);
  if (!acces.ok) return acces.reponse;
  const envoi = await televerserLogo(req);
  if ('reponse' in envoi) return envoi.reponse;
  // La clé vient de notre propre envoi ; la garde reste ici comme en base.
  if (!parseCleLogo(envoi.cle)) {
    return NextResponse.json({ error: 'Logo invalide' }, { status: 422 });
  }
  return enregistrer(acces.evenementId, collecteId, envoi.cle, acteur);
}

/** DELETE : retire le logo déposé sur l'événement. */
export async function retirerLogoClient(
  collecteId: string,
  acteur: ActeurLogo,
): Promise<NextResponse> {
  const acces = await controlerAcces(collecteId, acteur);
  if (!acces.ok) return acces.reponse;
  return enregistrer(acces.evenementId, collecteId, null, acteur);
}

/**
 * Enregistre le logo sur l'événement, trace le changement, puis remet en
 * fabrication les rapports de don déjà produits.
 */
async function enregistrer(
  evenementId: string,
  collecteId: string,
  cleNeuve: string | null,
  acteur: ActeurLogo,
): Promise<NextResponse> {
  const admin = createAdminSupabaseClient();
  let ancienne: string | null;
  try {
    ancienne = await lireCleLogo(admin, evenementId);
  } catch (e) {
    return serverError(e, 'collectes.logo_client.lecture_logo');
  }

  const { error: majErr } = await admin
    .from('evenements')
    .update({ logo_client_organisateur_url: cleNeuve })
    .eq('id', evenementId);
  if (majErr) return serverError(majErr, 'collectes.logo_client.ecriture');

  // Trace (écriture sensible, §07/06) : best-effort, le logo est déjà posé.
  const { error: auditErr } = await admin.from('audit_log').insert({
    table_name: 'evenements',
    record_id: evenementId,
    action: cleNeuve ? 'logo_client_depose' : 'logo_client_retire',
    user_id: acteur.userId,
    role: acteur.role,
    impersonator_id: acteur.impersonatorId ?? null,
    old_values: { logo_client_organisateur_url: ancienne },
    new_values: {
      logo_client_organisateur_url: cleNeuve,
      collecte_id: collecteId,
    },
  });
  if (auditErr) {
    logger.error('collectes.logo_client.audit_non_ecrit', {
      evenement_id: evenementId,
      error: messageErreur(auditErr),
    });
  }

  const rapportsRefaits = await refaireRapportsDeDon(
    admin,
    evenementId,
    acteur,
  );

  return NextResponse.json(
    { logo: cleNeuve !== null, rapports_refaits: rapportsRefaits },
    { status: 200 },
  );
}

/**
 * Remet en fabrication le rapport de don stocké de chaque collecte AG de
 * l'événement qui en a déjà un. Une collecte sans document est ignorée (son
 * rapport, fabriqué plus tard, prendra le logo). Best-effort : un échec est
 * journalisé, il n'annule pas le logo déposé. Rend le nombre de rapports remis
 * en fabrication.
 */
async function refaireRapportsDeDon(
  admin: SupabaseClient,
  evenementId: string,
  acteur: ActeurLogo,
): Promise<number> {
  const { data, error } = await admin
    .from('collectes')
    .select('id, statut')
    .eq('evenement_id', evenementId)
    .eq('type', 'anti_gaspi');
  if (error) {
    logger.error('collectes.logo_client.rapports_non_refaits', {
      evenement_id: evenementId,
      error: messageErreur(error),
    });
    return 0;
  }
  let refaits = 0;
  for (const c of (data ?? []) as Array<{ id: string; statut: string }>) {
    if (STATUTS_ANNULES.includes(c.statut)) continue;
    const type =
      c.statut === 'realisee_sans_collecte'
        ? 'rapport-evenement-sans-excedent'
        : 'attestation-don';
    const r = await regenerateCollecteDocument(admin, c.id, type, {
      userId: acteur.userId,
      role: acteur.role,
    });
    if (r.ok) refaits++;
    else if (r.code !== 'NO_DOCUMENT' && r.code !== 'NO_PRIOR_JOB') {
      logger.error('collectes.logo_client.rapport_non_refait', {
        collecte_id: c.id,
        type,
        error_code: r.code,
      });
    }
  }
  return refaits;
}
