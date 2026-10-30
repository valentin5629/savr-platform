import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import {
  requireProgrammateur,
  requireProgrammateurOuAdmin,
  createSupabaseServerClient,
} from '@/lib/api-auth.js';
import { validerChampsTexteLibre } from '@/lib/champs-texte-libre.js';
import {
  CHAMPS_EVENEMENT_EDITABLES,
  CHAMPS_TYPE_CONTACTS_COLLECTE,
} from '@/lib/collectes/champs-editables.js';
import { notifierEquipeModificationCollecte } from '@/lib/collectes/email-modification.js';
import { lireEtatRecapEmail } from '@/lib/programmation/suivi-recap-email.js';
import { typedRpcError, serverError } from '@/lib/api-helpers.js';
import { envoyerOrdresEvenementSansAttendre } from '@/lib/envoi-immediat.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';
import { controleAccesEvenement } from '@/lib/programmation/niveau-evenement.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

// Verrouillés pour les programmateurs (refus 422). lieu_id / type / organisation =
// immuables (§05 l.314). client_organisateur_organisation_id = RATTACHEMENT d'une
// org cliente (donne accès en lecture via evt_client_orga_select) → réservé Admin
// back-office (§06.06), jamais un programmateur (surface de divulgation, revue RLS
// 2026-06-26). nom/logo client = libellés libres, restent éditables.
const EVENT_LOCKED_FIELDS = [
  'lieu_id',
  'organisation_id',
  'traiteur_operationnel_organisation_id',
  'entite_facturation_id',
  'client_organisateur_organisation_id',
];

// Détail d'un événement avec ses collectes (pour vérification doublon AG etc.).
// Alimente l'écran de confirmation post-programmation (§06.01 étape 13) et la page
// « Ajouter une collecte » — deux destinations ouvertes à l'admin en mode support
// (§06.01 l.17 « admin_savr : programmation de support, tous périmètres »), d'où la
// garde alignée sur celle du POST de création (requireProgrammateurOuAdmin).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const supabase = createAdminSupabaseClient();

  // Client service-role : le cloisonnement est ce prédicat, pas la RLS. Staff =
  // périmètre global (cf. le ⚠ de requireProgrammateurOuAdmin), comme la route
  // back-office /api/v1/admin/evenements/[id].
  const query = supabase
    .from('evenements')
    .select(
      'id, organisation_id, traiteur_operationnel_organisation_id, lieu_id, nom_evenement, nom_client_organisateur, reference_affaire, date_evenement, pax, contact_principal_nom, contact_principal_telephone, contact_secours_nom, contact_secours_telephone, type_evenement:types_evenements!type_evenement_id(libelle), traiteur_operationnel:organisations!traiteur_operationnel_organisation_id(id, nom, raison_sociale), organisation:organisations!organisation_id(id, nom, raison_sociale), lieux(nom, adresse_acces, code_postal, ville, acces_details, controle_acces_requis_default), collectes(id, type, statut, date_collecte, heure_collecte, pax, controle_acces_requis, type_evenement_id, informations_supplementaires, lieu_overrides, created_at, type_evenement:types_evenements!type_evenement_id(libelle))',
    )
    .eq('id', evenementId);

  const { data, error } = await (
    auth.ctx.isAdmin
      ? query
      : query.eq('organisation_id', auth.ctx.organisationId)
  ).single();

  if (error || !data)
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );

  // Écran de confirmation (§06.01 étape 13) : état réel de l'email récapitulatif.
  // Lu APRÈS la garde ci-dessus, donc jamais pour un événement hors du périmètre
  // de l'appelant.
  const emailRecap = await lireEtatRecapEmail(supabase, evenementId);

  // Contacts de CHAQUE collecte (refonte du formulaire, lot B2) : table
  // `collecte_contacts`, fermée aux clients, lue ici en service-role après la
  // garde. L'appelant programme pour l'organisation de l'événement (ou est
  // l'équipe Savr) : il voit les contacts de ses programmations (§09,
  // arbitrages C2/C5 du 2026-10-01). Un échec de lecture est une erreur,
  // jamais « aucun contact ».
  // Ordre de création (puis identifiant) : la reprise d'un brouillon rouvre
  // ses cartes dans l'ordre où elles ont été enregistrées ; la lecture
  // embarquée n'a pas d'ordre garanti.
  const collectesBrutes = [
    ...((data.collectes ?? []) as Array<
      Record<string, unknown> & {
        id: string;
        type_evenement?: unknown;
        created_at?: string | null;
      }
    >),
  ].sort((a, b) =>
    `${a.created_at ?? ''}|${a.id}` < `${b.created_at ?? ''}|${b.id}` ? -1 : 1,
  );
  const contactsParCollecte = new Map<string, Record<string, unknown>>();
  if (collectesBrutes.length > 0) {
    const { data: contacts, error: contactsErr } = await supabase
      .from('collecte_contacts')
      .select(
        'collecte_id, contact_principal_nom, contact_principal_telephone, contact_secours_nom, contact_secours_telephone',
      )
      .in(
        'collecte_id',
        collectesBrutes.map((c) => c.id),
      );
    if (contactsErr)
      return serverError(contactsErr, 'programmation.evenements.contacts');
    for (const ligne of (contacts ?? []) as Array<
      Record<string, unknown> & { collecte_id: string }
    >) {
      const { collecte_id, ...valeurs } = ligne;
      contactsParCollecte.set(collecte_id, valeurs);
    }
  }
  const collectes = collectesBrutes.map((c) => {
    const type = (
      Array.isArray(c.type_evenement) ? c.type_evenement[0] : c.type_evenement
    ) as { libelle: string | null } | null | undefined;
    return {
      ...c,
      type_evenement: type?.libelle ?? null,
      contacts: contactsParCollecte.get(c.id) ?? null,
    };
  });

  // Niveau événement de la page « Ajouter une collecte » (§06.01), affiché figé :
  // le contrôle d'accès est celui que la route d'ajout imposera.
  // Relation to-one : PostgREST renvoie un objet, on tolère le tableau.
  const typeEvenement = (
    Array.isArray(data.type_evenement)
      ? data.type_evenement[0]
      : data.type_evenement
  ) as { libelle: string | null } | null | undefined;
  // Traiteur opérant (reprise d'un brouillon d'agence ou de gestionnaire) et
  // organisation programmatrice (reprise par l'équipe Savr, qui programme pour
  // son compte) : leur nom d'affichage seul, comme la liste du sélecteur.
  type OrgLue = {
    id: string;
    nom: string | null;
    raison_sociale: string | null;
  };
  const nomAffiche = (o: unknown): { id: string; nom: string } | null => {
    const org = (Array.isArray(o) ? o[0] : o) as OrgLue | null | undefined;
    return org
      ? {
          id: org.id,
          nom: (org.nom ?? '').trim() || (org.raison_sociale ?? ''),
        }
      : null;
  };
  return NextResponse.json({
    ...data,
    traiteur_operationnel: nomAffiche(data.traiteur_operationnel),
    organisation: nomAffiche(data.organisation),
    collectes,
    type_evenement: typeEvenement?.libelle ?? null,
    controle_acces_requis: controleAccesEvenement(data.collectes),
    email_recap: emailRecap,
  });
}

// Édition des champs métier de l'événement par un rôle programmateur (4 rôles).
// Décision produit Val 2026-06-26 : édition événement + collecte depuis la fiche
// collecte, fenêtre brouillon/programmee/validee, verrou dès en_cours (§06.04 l.444,
// §05 §4). Le type d'événement et les contacts se modifient sur chaque collecte
// depuis le lot B1 (décision Val 2026-10-23) : refusés ici (422), et
// fn_modifier_evenement n'émet plus d'E2 (aucun champ restant ne part au
// prestataire).
// Reste volontairement fermé au staff (contrairement au GET) : editer-collecte-form
// n'est monté que sur les fiches traiteur/agence/gestionnaire, l'admin éditant par
// le back-office (/api/v1/admin/evenements/[id], requireStaff). Aucun chemin admin
// n'y mène — l'ouvrir serait du code spéculatif.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  // Champs verrouillés (§05 l.314 / §06.04 l.459) — refus explicite.
  const lockedAttempt = EVENT_LOCKED_FIELDS.filter((f) => f in body);
  if (lockedAttempt.length > 0) {
    return NextResponse.json(
      {
        error:
          'Pour changer le lieu, annulez la ou les collectes et reprogrammez. Les autres champs structurants sont immuables.',
        champs_verrouilles: lockedAttempt,
      },
      { status: 422 },
    );
  }

  // Le pax n'est plus un champ de l'événement (décision Val 2026-10-20) : il se
  // modifie sur chaque collecte, et celui de l'événement en est calculé en base.
  // Refusé plutôt qu'ignoré, pour qu'un appelant resté à l'ancien contrat le sache.
  if ('pax' in body) {
    return NextResponse.json(
      {
        error:
          'Le nombre de convives se modifie sur chaque collecte, pas sur l’événement.',
        champs_verrouilles: ['pax'],
      },
      { status: 422 },
    );
  }

  // Le type d'événement et les contacts se modifient sur chaque collecte (lot
  // B1, décision Val 2026-10-23) ; l'événement garde la copie de sa collecte
  // n°1, tenue par la base. Refusés plutôt qu'ignorés.
  const typeContacts = CHAMPS_TYPE_CONTACTS_COLLECTE.filter((f) => f in body);
  if (typeContacts.length > 0) {
    return NextResponse.json(
      {
        error:
          'Le type d’événement et les contacts se modifient sur chaque collecte, pas sur l’événement.',
        champs_verrouilles: typeContacts,
      },
      { status: 422 },
    );
  }

  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) =>
      CHAMPS_EVENEMENT_EDITABLES.includes(k),
    ),
  );
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  // Borne d'entrée des champs texte libre transmis au transporteur : sans elle,
  // `fn_modifier_evenement` écrit `p_updates->>'contact_secours_nom'` tel quel, y
  // compris un texte démesuré ou multiligne qui évince les autres informations du
  // message lu par le chauffeur.
  const texteValide = validerChampsTexteLibre(updates);
  if ('error' in texteValide) return texteValide.error;
  Object.assign(updates, texteValide.valeurs);

  // Lecture RLS-scopée (cloisonnement org : si invisible → 404).
  const rls = createSupabaseServerClient();
  const { data: evt } = await rls
    .from('evenements')
    .select('id, organisation_id, created_by')
    .eq('id', id)
    .maybeSingle();
  if (!evt) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }

  // Périmètre d'ÉCRITURE : l'organisation, pour tous les programmateurs
  // (Val 2026-10-30 : le commercial écrit comme le manager, sur toute son organisation.)
  const autorise = evt.organisation_id === auth.ctx.organisationId;
  if (!autorise) {
    return NextResponse.json(
      { error: 'Modification non autorisée' },
      { status: 403 },
    );
  }

  // Fenêtre d'édition niveau événement (§05 l.304) : f_collecte_editable.
  const { data: editable } = await rls.rpc('f_collecte_editable', {
    p_evenement_id: id,
  });
  if (!editable) {
    return NextResponse.json(
      {
        error:
          'Cet événement ne peut plus être modifié (collecte en cours ou terminée).',
      },
      { status: 422 },
    );
  }

  // Débit des écritures clientes (cf. lib/frein-ecritures-client). L'identifiant
  // est celui que rend la base, jamais le paramètre d'URL.
  const frein = freinerEcritureCliente({
    organisationId: auth.ctx.organisationId,
    modification: { evenement: evt.id },
  });
  if (frein) return frein;

  // Écriture via RPC service-role : UPDATE de l'événement (aucun E2 depuis le
  // lot B1, cf. ci-dessus).
  const admin = createAdminSupabaseClient();
  const { data: before } = await admin
    .from('evenements')
    .select('*')
    .eq('id', id)
    .single();

  const { data: updated, error } = await admin.rpc('fn_modifier_evenement', {
    p_id: id,
    p_updates: updates,
    p_champs_modifies: Object.keys(updates),
  });
  if (error) return serverError(error, 'programmation.evenements.update');

  // Un ordre par collecte déjà commandée : ils partent sans attendre le passage
  // planifié (décision Val 2026-10-12).
  envoyerOrdresEvenementSansAttendre(evt.id);

  // Audit (§05 l.330 audit_log global — accessible Admin only). Session impersonée :
  // user_id = identité assumée ET impersonator_id = admin réel (§09 §7) — écrit ici
  // car l'INSERT part sous service_role, sans le JWT de la session.
  // Cette ligne est aussi ce que la route collecte relit pour l'email à l'équipe
  // Savr (`{ updates }`, cf. lib/collectes/email-modification) : son échec ne
  // doit pas passer inaperçu.
  const { error: auditErr } = await admin.from('audit_log').insert({
    table_name: 'evenements',
    record_id: id,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    impersonator_id: auth.ctx.impersonatorId ?? null,
    old_values: before ?? {},
    new_values: { updates },
  });
  if (auditErr)
    logger.error('programmation.evenements.audit_echec', {
      evenement_id: id,
      erreur: auditErr.message,
    });

  // Recompute de `informations_completes` (§04 Data Model) — BL-P1-TRAIT-04.
  // À l'édition, le badge « Info incomplète » est recalculé sur le téléphone du
  // contact principal ET le nom de l'événement ; le client final, facultatif,
  // n'en fait pas partie (décision Val 2026-10-19). Depuis le lot B1, le
  // téléphone ne se modifie plus ici : c'est celui de la copie gardée par
  // l'événement (collecte n°1), jamais vide pour une collecte créée depuis
  // (collecte_contacts l'exige) ; seule une modification du nom déclenche ce
  // recalcul. À la programmation, ces deux
  // champs sont exigés (422) : seule une surcharge du lieu y pose le badge. Les
  // collectes à lieu_overrides restent incomplètes (override lieu non levé ici)
  // → exclues du recompute.
  if ('contact_principal_telephone' in updates || 'nom_evenement' in updates) {
    const beforeRow = (before ?? {}) as Record<string, unknown>;
    const contactTel =
      'contact_principal_telephone' in updates
        ? updates.contact_principal_telephone
        : beforeRow.contact_principal_telephone;
    const nomEvenement =
      'nom_evenement' in updates
        ? updates.nom_evenement
        : beforeRow.nom_evenement;
    // Un nom fait d'espaces vaut un nom absent, comme à la création.
    const nomRenseigne =
      typeof nomEvenement === 'string' && nomEvenement.trim() !== '';
    const complet = Boolean(contactTel) && nomRenseigne;
    await admin
      .from('collectes')
      .update({ informations_completes: complet })
      .eq('evenement_id', id)
      .is('lieu_overrides', null);
  }

  // Email à l'équipe Savr (cf. lib/collectes/email-modification) : il part d'ici
  // quand l'enregistrement ne touche que l'événement — le formulaire nomme alors
  // la collecte d'où il est ouvert (`collecte_id`). La collecte nommée doit être
  // de CET événement et encore modifiable (mêmes statuts que les routes
  // collecte) : ni brouillon, ni collecte terminée.
  const collecteNotifiee = body.collecte_id;
  if (typeof collecteNotifiee === 'string') {
    const { data: collecte } = await admin
      .from('collectes')
      .select('id')
      .eq('id', collecteNotifiee)
      .eq('evenement_id', id)
      .in('statut', ['programmee', 'validee'])
      .maybeSingle();
    if (collecte)
      await notifierEquipeModificationCollecte(admin, req, {
        collecteId: collecte.id,
        acteurUserId: auth.ctx.userId,
        evenementAvant: (before ?? null) as Record<string, unknown> | null,
        majEvenement: updates,
      });
  }

  // `fn_modifier_evenement` rend la ligne ENTIÈRE (`to_jsonb`), dont
  // `notes_internes` (notes Admin Savr, §04) et `entite_facturation_id` — deux
  // colonnes qu'aucun rôle client ne lit (hors GRANT SELECT authenticated,
  // arbitrage Val C1 2026-10-01). La réponse est donc réduite à l'id et aux
  // champs que ce rôle peut éditer ; l'écran n'en consomme que le statut HTTP.
  const ligne = (updated ?? {}) as Record<string, unknown>;
  const data = Object.fromEntries(
    ['id', ...CHAMPS_EVENEMENT_EDITABLES]
      .filter((champ) => champ in ligne)
      .map((champ) => [champ, ligne[champ]]),
  );
  return NextResponse.json({ data });
}

// Rôles clients dont le DELETE brouillon est borné à leurs PROPRES créations
// (`created_by = auth.uid()`, matrice §09 tranchée Val 2026-09-14). Absents de cette
// liste : `traiteur_manager` et `traiteur_commercial` (aligné sur le manager, Val
// 2026-10-30), qui ont le périmètre organisation, et le staff (`admin_savr`/`ops_savr`),
// global. La garde qui s'appuie dessus est
// APPLICATIVE par nécessité : la route DELETE tourne en service-role.
const DELETE_ROLES_PROPRIETAIRE: string[] = ['agence', 'gestionnaire_lieux'];

// Suppression d'un événement brouillon (et ses collectes) par son propriétaire.
// Ouverte à l'admin en mode support, comme la liste qui l'appelle : depuis que
// celle-ci lui rend ses propres brouillons (GET ../evenements?statut=brouillon,
// décision Val 2026-07-17), le bouton « Supprimer » est cliquable — le laisser
// fail-closed rendrait la ligne visible mais l'action morte.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const { id: evenementId } = await params;
  const supabase = createAdminSupabaseClient();

  // Vérification propriété + statut brouillon uniquement. Route d'ITEM clé par PK :
  // prédicat org strict pour les rôles clients, retiré pour le staff (son JWT porte
  // `org_savr`, qui ne désigne aucune org cliente).
  const evtQuery = supabase
    .from('evenements')
    .select('id, created_by')
    .eq('id', evenementId);

  const { data: evt } = await (
    auth.ctx.isAdmin
      ? evtQuery
      : evtQuery.eq('organisation_id', auth.ctx.organisationId)
  ).single();

  if (!evt) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }

  // Périmètre d'ÉCRITURE — matrice DELETE `evenements` §09 (tranché Val 2026-09-14,
  // divergences `M1.2_20260717` / `M1.2_20260717_delete-service-role`) : « chacun
  // supprime ses propres brouillons ». `agence` et `gestionnaire_lieux` sont
  // bornés à `created_by = auth.uid()` ; `traiteur_manager` et `traiteur_commercial`
  // (Val 2026-10-30) gardent le périmètre organisation (déjà posé par le SELECT
  // ci-dessus), et le staff reste global. Le §09 exige explicitement que cette
  // matrice soit posée en garde de rôle APPLICATIVE (403) et pas seulement en
  // policy : la route tourne sous service-role, la RLS est bypassée et ne rattrape
  // rien. Sans elle, le prédicat `organisation_id` seul laisserait un membre de
  // l'orga hard-delete le brouillon d'un collègue — la suppression est un hard
  // delete assumé (pas de colonne `supprime_le`), donc irréversible.
  if (
    DELETE_ROLES_PROPRIETAIRE.includes(auth.ctx.role) &&
    evt.created_by !== auth.ctx.userId
  ) {
    return NextResponse.json(
      { error: 'Suppression non autorisée' },
      { status: 403 },
    );
  }

  // Suppression atomique événement + collectes, garde « brouillon uniquement »
  // portée par la RPC (même transaction, sous row lock).
  // L'ancien code faisait `DELETE FROM evenements` en s'appuyant sur un ON DELETE
  // CASCADE qui n'existe pas (aucune FK vers `evenements` n'est cascade, ni dans les
  // migrations ni dans le DDL cible) → 500 sur tout brouillon ayant des collectes,
  // c'est-à-dire tous : le bouton n'a jamais fonctionné, pour aucun rôle. La garde
  // vivait par ailleurs ici en deux allers-retours, et `collectes?.some()` valait
  // `undefined` si le SELECT échouait → garde franchie (fail-open).
  const { error } = await supabase.rpc('fn_supprimer_brouillon', {
    p_evenement_id: evenementId,
  });

  if (error)
    return typedRpcError(error, 'programmation.brouillon.supprimer', {
      message422:
        "Impossible de supprimer : des collectes sont déjà confirmées. Utilisez l'annulation.",
    });

  return new NextResponse(null, { status: 204 });
}
