// PATCH /api/v1/evenements/[id]/code-affaire-viparis — corps { code_affaire_viparis }
// Code affaire VIPARIS de l'événement (Val 2026-11-02, CDC §04
// `evenements.code_affaire_viparis`) : saisi au formulaire de programmation,
// corrigeable ensuite sur la fiche événement. Facultatif ; `null` ou une chaîne
// vide l'efface.
//
// Qui écrit (§04, droits arbitrés par Val le 2026-11-02) : l'équipe Savr,
// l'organisation qui a programmé l'événement (traiteur, agence ou gestionnaire
// de lieux : `evenements.organisation_id`), et le gestionnaire du lieu (VIPARIS,
// y compris sur l'événement d'un traiteur tiers). Jamais un traiteur ou une
// agence sur l'événement d'un tiers : le traiteur opérationnel tiers voit
// l'événement sous sa RLS mais le lit seulement (403, rien n'est écrit). Jamais
// le client organisateur (403).
//
// La colonne est hors de la liste blanche de lecture et d'écriture des clients
// (20261001103000) : l'écriture part en service_role, APRÈS ces gardes. Aucun
// effet chez le prestataire (le code n'est pas transmis) : ni ordre de collecte,
// ni envoi immédiat. Aucune fenêtre d'édition non plus : le code sert à
// rapprocher l'export du registre, il se corrige aussi après la collecte.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  PROGRAMMATION_ROLES,
  createSupabaseServerClient,
  requireAnyUser,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { freinerEcritureCliente } from '@/lib/frein-ecritures-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import {
  MESSAGE_FORMAT_CODE_AFFAIRE_VIPARIS,
  normaliserCodeAffaireViparis,
} from '@/lib/viparis/codes.js';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;
  const { ctx } = auth;
  if (!ctx.isStaff && !PROGRAMMATION_ROLES.includes(ctx.role as ClientRole)) {
    return NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || !('code_affaire_viparis' in body)) {
    return NextResponse.json(
      { error: 'Champ code_affaire_viparis manquant' },
      { status: 422 },
    );
  }
  const code = normaliserCodeAffaireViparis(body.code_affaire_viparis);
  if (code === undefined) {
    return NextResponse.json(
      { error: MESSAGE_FORMAT_CODE_AFFAIRE_VIPARIS },
      { status: 422 },
    );
  }

  const { id } = await params;
  const admin = createAdminSupabaseClient();

  // Visibilité : la RLS de l'utilisateur pour un client, l'existence pour le staff.
  const lecteur = ctx.isStaff ? admin : createSupabaseServerClient();
  const { data: visible, error: visErr } = await lecteur
    .from('evenements')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (visErr) return serverError(visErr, 'evenements.code_affaire.lecture');
  if (!visible) {
    return NextResponse.json(
      { error: 'Événement introuvable ou accès refusé' },
      { status: 404 },
    );
  }
  const evenementId = (visible as { id: string }).id;

  const { data: avantLu, error: avantErr } = await admin
    .from('evenements')
    .select('code_affaire_viparis, organisation_id, lieu_id')
    .eq('id', evenementId)
    .single();
  if (avantErr) return serverError(avantErr, 'evenements.code_affaire.avant');
  const avant = avantLu as {
    code_affaire_viparis: string | null;
    organisation_id: string | null;
    lieu_id: string | null;
  };

  // Droit d'écriture d'un client : son organisation a programmé l'événement, ou
  // elle gère son lieu. Voir l'événement ne suffit pas (traiteur opérationnel).
  if (!ctx.isStaff) {
    const programmateur =
      !!ctx.organisationId && avant.organisation_id === ctx.organisationId;
    let gestionnaireDuLieu = false;
    if (
      !programmateur &&
      ctx.role === 'gestionnaire_lieux' &&
      ctx.organisationId &&
      avant.lieu_id
    ) {
      const { data: rattachement, error: rattErr } = await admin
        .from('organisations_lieux')
        .select('lieu_id')
        .eq('organisation_id', ctx.organisationId)
        .eq('lieu_id', avant.lieu_id)
        .maybeSingle();
      if (rattErr)
        return serverError(rattErr, 'evenements.code_affaire.gestionnaire');
      gestionnaireDuLieu = !!rattachement;
    }
    if (!programmateur && !gestionnaireDuLieu) {
      return NextResponse.json(
        {
          error:
            'Seuls l’organisation qui a programmé l’événement et le gestionnaire du lieu modifient le code affaire',
        },
        { status: 403 },
      );
    }
  }

  const frein = freinerEcritureCliente({
    organisationId: ctx.organisationId ?? '',
    equipeSavr: ctx.isStaff,
    modification: { evenement: evenementId },
  });
  if (frein) return frein;

  const { error: majErr } = await admin
    .from('evenements')
    .update({
      code_affaire_viparis: code,
      updated_at: new Date().toISOString(),
    })
    .eq('id', evenementId);
  if (majErr) return serverError(majErr, 'evenements.code_affaire.ecriture');

  const { error: auditErr } = await admin.from('audit_log').insert({
    table_name: 'evenements',
    record_id: evenementId,
    action: 'UPDATE',
    user_id: ctx.userId,
    role: ctx.role,
    impersonator_id: ctx.impersonatorId ?? null,
    old_values: { code_affaire_viparis: avant.code_affaire_viparis },
    new_values: { code_affaire_viparis: code },
  });
  if (auditErr) {
    logger.error('evenements.code_affaire.audit_non_ecrit', {
      evenement_id: evenementId,
      erreur: auditErr.message,
    });
  }

  return NextResponse.json({
    data: { id: evenementId, code_affaire_viparis: code },
  });
}
