import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const statut = searchParams.get('statut'); // 'brouillon' pour la liste brouillons

  // Liste les événements de l'organisation avec leurs collectes
  let query = supabase
    .from('evenements')
    .select(
      `id, nom_evenement, nom_client_organisateur, reference_affaire, created_at,
       collectes!inner(type, date_collecte, statut)`,
    )
    .eq('organisation_id', auth.ctx.organisationId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (statut === 'brouillon') {
    query = query.eq('collectes.statut', 'brouillon');
  }

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

interface CollecteInput {
  type: 'zd' | 'ag';
  date_collecte: string;
  heure_collecte: string;
  informations_supplementaires?: string;
}

interface ProgrammationBody {
  // Étape 1
  nom_evenement?: string;
  nom_client_organisateur?: string;
  pax: number;
  type_evenement_id: string;
  reference_affaire?: string;
  logo_client_organisateur_url?: string;
  // Étape 2
  lieu_id: string;
  lieu_overrides?: Record<string, unknown>;
  controle_acces_requis: boolean;
  contact_principal_nom: string;
  contact_principal_telephone: string;
  contact_secours_nom?: string;
  contact_secours_telephone?: string;
  // Rôles agence/gestionnaire uniquement
  traiteur_operationnel_organisation_id?: string;
  // Admin support : organisation cible
  organisation_id?: string;
  // Étape 3
  collectes: CollecteInput[];
  // Mode
  confirmer: boolean; // true = programmee, false = brouillon
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as ProgrammationBody;

  // admin_savr programme pour le compte d'une org : organisation_id requis dans le body
  const effectiveOrgId =
    auth.ctx.isAdmin && !auth.ctx.organisationId
      ? (body.organisation_id as string | undefined)
      : auth.ctx.organisationId;

  if (!effectiveOrgId) {
    return NextResponse.json(
      {
        error:
          'Champ organisation_id requis pour la programmation de support admin',
      },
      { status: 422 },
    );
  }

  // Validation champs obligatoires
  if (
    !body.pax ||
    body.pax < 1 ||
    !body.type_evenement_id ||
    !body.lieu_id ||
    !body.contact_principal_nom ||
    !body.contact_principal_telephone ||
    !body.collectes?.length
  ) {
    return NextResponse.json(
      {
        error:
          'Champs obligatoires : pax (≥1), type_evenement_id, lieu_id, contact_principal_nom, contact_principal_telephone, collectes',
      },
      { status: 422 },
    );
  }

  // Nom client obligatoire à la confirmation (pas bloquant en brouillon)
  if (body.confirmer && !body.nom_client_organisateur) {
    return NextResponse.json(
      { error: 'Nom du client obligatoire pour confirmer la programmation' },
      { status: 422 },
    );
  }

  // Validation date_collecte >= aujourd'hui
  const today = new Date().toISOString().slice(0, 10);
  for (const c of body.collectes) {
    if (!c.date_collecte || !c.heure_collecte || !c.type) {
      return NextResponse.json(
        {
          error:
            'Chaque collecte requiert : type, date_collecte, heure_collecte',
        },
        { status: 422 },
      );
    }
    if (c.date_collecte < today) {
      return NextResponse.json(
        { error: `Date de collecte dans le passé : ${c.date_collecte}` },
        { status: 422 },
      );
    }
  }

  const supabase = createAdminSupabaseClient();

  // Résolution traiteur opérationnel
  const traiteurOperationnelId =
    auth.ctx.role === 'agence' ||
    auth.ctx.role === 'gestionnaire_lieux' ||
    auth.ctx.isAdmin
      ? (body.traiteur_operationnel_organisation_id ?? effectiveOrgId)
      : effectiveOrgId;

  if (!traiteurOperationnelId) {
    return NextResponse.json(
      { error: 'traiteur_operationnel_organisation_id requis pour ce rôle' },
      { status: 422 },
    );
  }

  // Gap A : gestionnaire_lieux — valider que le lieu est dans son périmètre géré
  if (auth.ctx.role === 'gestionnaire_lieux') {
    const { data: lieuLink } = await supabase
      .from('organisations_lieux')
      .select('id')
      .eq('organisation_id', effectiveOrgId)
      .eq('lieu_id', body.lieu_id)
      .maybeSingle();
    if (!lieuLink) {
      return NextResponse.json(
        {
          error:
            'Lieu non autorisé : ce lieu ne fait pas partie de votre périmètre',
        },
        { status: 403 },
      );
    }
  }

  // Gap B : agence — le traiteur opérationnel doit être soit un shadow de cette agence,
  // soit un traiteur réel actif référencé sur la plateforme (non-shadow, type=traiteur)
  if (auth.ctx.role === 'agence' && traiteurOperationnelId !== effectiveOrgId) {
    const { data: traiteurInfo } = await supabase
      .from('organisations')
      .select('id, type, est_shadow, cree_par_organisation_id')
      .eq('id', traiteurOperationnelId)
      .eq('actif', true)
      .maybeSingle();

    const isShadowPropre =
      traiteurInfo?.est_shadow === true &&
      traiteurInfo?.cree_par_organisation_id === effectiveOrgId;
    const isTraiteurReel =
      traiteurInfo?.est_shadow === false && traiteurInfo?.type === 'traiteur';

    if (!traiteurInfo || (!isShadowPropre && !isTraiteurReel)) {
      return NextResponse.json(
        { error: 'Traiteur opérationnel non autorisé pour cette agence' },
        { status: 403 },
      );
    }
  }

  // Gating facturation (R1) — vérification entité de facturation active
  const { data: entite } = await supabase
    .from('entites_facturation')
    .select('id')
    .eq('organisation_id', effectiveOrgId)
    .eq('siret_verification', 'verifie')
    .maybeSingle();

  if (!entite) {
    return NextResponse.json(
      {
        error:
          'Complétez votre profil entreprise (SIRET vérifié requis pour programmer une collecte)',
      },
      { status: 422 },
    );
  }

  // Vérification pack AG si collecte AG présente (R3)
  const hasAg = body.collectes.some((c) => c.type === 'ag');
  if (hasAg && body.confirmer) {
    const { data: pack } = await supabase
      .from('packs_antgaspi')
      .select('id, credits_restants')
      .eq('organisation_id', effectiveOrgId)
      .eq('statut', 'actif')
      .maybeSingle();

    if (!pack || (pack.credits_restants ?? 0) <= 0) {
      return NextResponse.json(
        {
          error:
            'Aucun pack Anti-Gaspi actif disponible pour cette organisation',
        },
        { status: 422 },
      );
    }
  }

  // INSERT événement
  const { data: evt, error: evtErr } = await supabase
    .from('evenements')
    .insert({
      organisation_id: effectiveOrgId,
      traiteur_operationnel_organisation_id: traiteurOperationnelId,
      entite_facturation_id: entite.id,
      lieu_id: body.lieu_id,
      created_by: auth.ctx.userId,
      nom_evenement: body.nom_evenement ?? null,
      type_evenement_id: body.type_evenement_id,
      pax: body.pax,
      contact_principal_nom: body.contact_principal_nom,
      contact_principal_telephone: body.contact_principal_telephone,
      contact_secours_nom: body.contact_secours_nom ?? null,
      contact_secours_telephone: body.contact_secours_telephone ?? null,
      nom_client_organisateur: body.nom_client_organisateur ?? null,
      logo_client_organisateur_url: body.logo_client_organisateur_url ?? null,
      reference_affaire: body.reference_affaire ?? null,
    })
    .select('id, nom_evenement')
    .single();

  if (evtErr)
    return NextResponse.json({ error: evtErr.message }, { status: 500 });

  const evenementId = evt.id;
  const collecteIds: string[] = [];

  // Mise à jour contrôle d'accès lieu (cascade upgrade-only, R9)
  if (body.controle_acces_requis) {
    await supabase
      .from('lieux')
      .update({ controle_acces_requis_default: true })
      .eq('id', body.lieu_id)
      .eq('controle_acces_requis_default', false);
  }

  if (body.confirmer) {
    // Chemin confirmation : fn_creer_collecte (SECURITY DEFINER, gère E1 pour ZD)
    for (const c of body.collectes) {
      const { data: collecteId, error: cErr } = await supabase.rpc(
        'fn_creer_collecte',
        {
          p_evenement_id: evenementId,
          p_type: c.type,
          p_date_collecte: c.date_collecte,
          p_heure_collecte: c.heure_collecte,
          p_nb_camions: 1,
          p_controle_acces: body.controle_acces_requis,
          p_notes: null,
          p_info_suppl: c.informations_supplementaires ?? null,
        },
      );

      if (cErr) {
        // Rollback partiel : supprimer l'événement déjà créé
        await supabase.from('evenements').delete().eq('id', evenementId);
        return NextResponse.json({ error: cErr.message }, { status: 500 });
      }

      collecteIds.push(collecteId as string);
    }

    // Override lieu per-collecte si présent (R11)
    if (body.lieu_overrides && Object.keys(body.lieu_overrides).length > 0) {
      await supabase
        .from('collectes')
        .update({
          lieu_overrides: body.lieu_overrides,
          informations_completes: false,
        })
        .in('id', collecteIds);
    }

    // Informations manquantes : badge info_incomplete (R12)
    const hasIncomplete =
      !body.contact_principal_telephone || !body.nom_client_organisateur;
    if (hasIncomplete) {
      await supabase
        .from('collectes')
        .update({ informations_completes: false })
        .in('id', collecteIds);
    }

    // Email récap (stub M1.2 — template minimal)
    const firstCollecte = body.collectes[0];
    void sendEmail(
      'collecte_programmee',
      '', // email résolu côté traiteur — stub minimal, module emails le complétera
      {
        nom_evenement: evt.nom_evenement ?? 'Votre événement',
        date_collecte: firstCollecte?.date_collecte ?? '',
      },
      { entityType: 'evenement', entityId: evenementId },
    ).catch(() => undefined); // non-bloquant
  } else {
    // Chemin brouillon : INSERT direct avec statut='brouillon'
    for (const c of body.collectes) {
      const { data: newCollecte, error: cErr } = await supabase
        .from('collectes')
        .insert({
          evenement_id: evenementId,
          type: c.type,
          date_collecte: c.date_collecte,
          heure_collecte: c.heure_collecte,
          statut: 'brouillon',
          statut_tms: 'non_envoye',
          controle_acces_requis: body.controle_acces_requis,
          informations_supplementaires: c.informations_supplementaires ?? null,
          nb_camions_demande: 1,
        })
        .select('id')
        .single();

      if (cErr) {
        await supabase.from('evenements').delete().eq('id', evenementId);
        return NextResponse.json({ error: cErr.message }, { status: 500 });
      }

      collecteIds.push(newCollecte.id);
    }
  }

  return NextResponse.json(
    { evenement_id: evenementId, collecte_ids: collecteIds },
    { status: 201 },
  );
}
