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
import { refusPaxCollecte } from '@/lib/pax-collecte.js';
import { chargerFicheCollecteClient } from '@/lib/collectes/fiche-client.js';
import {
  CHAMPS_COLLECTE_EDITABLES,
  CHAMPS_COLLECTE_VERROUILLES,
} from '@/lib/collectes/champs-editables.js';
import { notifierEquipeModificationCollecte } from '@/lib/collectes/email-modification.js';
import { lireContactsCollecte } from '@/lib/collectes/contacts-collecte.js';
import { refusTypeContactsCollecte } from '@/lib/collectes/type-contacts-collecte.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

const AGENCE_ROLES: ClientRole[] = ['agence'];

// Résolution du nom du traiteur opérationnel (§06.11 diff #3).
// La RLS organisations n'autorise pas l'agence à lire le référentiel → on passe
// par la vue whitelist v_referentiel_traiteurs (F5). Si absent (fiche shadow),
// l'agence lit sa propre fiche shadow via org_agence_select (est_shadow + créateur).
async function resolveTraiteurOperationnel(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  orgId: string | null,
): Promise<{
  id: string;
  nom: string | null;
  est_shadow: boolean;
  siret: string | null;
} | null> {
  if (!orgId) return null;

  const { data: ref } = await supabase
    .from('v_referentiel_traiteurs')
    .select('id, nom')
    .eq('id', orgId)
    .maybeSingle();
  if (ref)
    return {
      id: ref.id as string,
      // Libellé unique porté par la vue (20260922080000) : nom commercial, ou
      // raison sociale à défaut. Plus de repli ici.
      nom: ref.nom as string | null,
      est_shadow: false,
      siret: null,
    };

  // Fiche shadow créée par l'agence (lecture autorisée par org_agence_select)
  const { data: shadow } = await supabase
    .from('organisations')
    .select('id, nom, raison_sociale, siret, est_shadow')
    .eq('id', orgId)
    .maybeSingle();
  if (shadow)
    return {
      id: shadow.id as string,
      nom: (shadow.raison_sociale ?? shadow.nom) as string | null,
      est_shadow: shadow.est_shadow === true,
      siret: (shadow.siret as string | null) ?? null,
    };

  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;

  // Socle commun des fiches clientes (pop-up §06.04 repris par §06.11).
  const r = await chargerFicheCollecteClient(id, auth.ctx, 'agence');
  if ('erreur' in r) return serverError(r.erreur, 'agence.collectes.get');
  if ('introuvable' in r)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );

  // §06.11 différence #3 : traiteur opérationnel affiché sur la fiche.
  const traiteur_operationnel = await resolveTraiteurOperationnel(
    createSupabaseServerClient(),
    r.contexte.traiteurOperationnelId,
  );

  return NextResponse.json({ data: { ...r.fiche, traiteur_operationnel } });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  const lockedAttempt = CHAMPS_COLLECTE_VERROUILLES.filter((f) => f in body);
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

  // Pax de la collecte (décision Val 2026-10-20) : entier >= 1, refusé en 422
  // avant la RPC (qui le refuserait aussi, mais en erreur serveur).
  if (Object.hasOwn(updates, 'pax')) {
    const refusPax = refusPaxCollecte(updates.pax);
    if (refusPax) return refusPax;
  }

  // Type d'événement et contacts de la collecte (lot B1, décision Val
  // 2026-10-23) : refusés en 422 avant la RPC s'ils sont vides ou inconnus.
  const refusTypeContacts = await refusTypeContactsCollecte(
    createAdminSupabaseClient(),
    updates,
  );
  if (refusTypeContacts) return refusTypeContacts;

  // Lecture RLS-scopée (donneur d'ordre) + gate statut
  const rls = createSupabaseServerClient();
  const { data: collecte } = await rls
    .from('collectes')
    .select(
      `id, statut, statut_tms, date_collecte, heure_collecte,
       evenement:evenements!inner(organisation_id)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!collecte)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );

  if (!['programmee', 'validee'].includes(collecte.statut as string)) {
    return NextResponse.json(
      { error: `Édition impossible au statut ${collecte.statut}` },
      { status: 422 },
    );
  }

  // Périmètre d'écriture agence (miroir de la route gestionnaire) : ses propres
  // programmations (organisation_id = son orga). L'écriture qui suit passe par le
  // client de service : sans cette borne, seule la lecture RLS ci-dessus la
  // limiterait.
  const evenement = Array.isArray(collecte.evenement)
    ? collecte.evenement[0]
    : collecte.evenement;
  if (evenement?.organisation_id !== auth.ctx.organisationId) {
    return NextResponse.json(
      { error: 'Modification non autorisée' },
      { status: 403 },
    );
  }

  // Débit des écritures clientes (cf. lib/frein-ecritures-client). L'identifiant
  // est celui que rend la base, jamais le paramètre d'URL.
  const frein = freinerEcritureCliente({
    organisationId: auth.ctx.organisationId,
    modification: { collecte: collecte.id },
  });
  if (frein) return frein;

  // Réacceptation prestataire si le créneau change (cascade E2 informe le TMS)
  const dateHeureModifiee =
    'date_collecte' in updates || 'heure_collecte' in updates;
  const reacceptation_requise =
    dateHeureModifiee && collecte.statut_tms === 'acceptee';
  if (reacceptation_requise) {
    (updates as Record<string, unknown>).statut = 'programmee';
  }

  const admin = createAdminSupabaseClient();
  // État d'avant l'écriture : valeurs « avant » de l'email à l'équipe Savr.
  const { data: beforeCollecte } = await admin
    .from('collectes')
    .select('*')
    .eq('id', id)
    .single();
  // Contacts de la collecte (collecte_contacts, lot B1) : valeurs « avant » de
  // l'email à l'équipe Savr.
  const lectureContacts = await lireContactsCollecte(admin, id);
  if ('erreur' in lectureContacts)
    return serverError(lectureContacts.erreur, 'agence.collectes.contacts');
  const before = beforeCollecte
    ? { ...beforeCollecte, ...(lectureContacts.contacts ?? {}) }
    : beforeCollecte;

  const { data: updated, error } = await admin.rpc('fn_modifier_collecte', {
    p_id: id,
    p_updates: updates,
    p_champs_modifies: Object.keys(updates),
  });
  if (error) return serverError(error, 'agence.collectes.update');

  // L'ordre éventuel est en file : il part sans attendre le passage planifié
  // (décision Val 2026-10-12).
  envoyerOrdresSansAttendre(collecte.id);

  if (reacceptation_requise) {
    await admin
      .from('collectes')
      .update({ statut_tms: 'attribuee_en_attente_acceptation' })
      .eq('id', id);
  }

  // Email à l'équipe Savr (cf. lib/collectes/email-modification).
  await notifierEquipeModificationCollecte(admin, req, {
    collecteId: id,
    acteurUserId: auth.ctx.userId,
    collecteAvant: before,
    majCollecte: updates,
    evenementModifiePar:
      body.evenement_modifie === true ? auth.ctx.userId : undefined,
  });

  return NextResponse.json({
    data: updated,
    flags: { reacceptation_requise },
  });
}
