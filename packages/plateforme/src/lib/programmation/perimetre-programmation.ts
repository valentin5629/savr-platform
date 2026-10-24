import { NextResponse } from 'next/server';
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Gardes de périmètre d'une programmation, communes à la création
 * (POST /programmation/evenements) et à la reprise d'un brouillon
 * (PUT /programmation/evenements/[id]/brouillon) — code déplacé de la route de
 * création, comportement inchangé.
 *   · traiteur opérationnel : celui du corps pour l'agence, le gestionnaire et
 *     le staff, sinon l'organisation programmatrice ;
 *   · gestionnaire de lieux : le lieu est dans son périmètre géré ; le traiteur
 *     opérant est obligatoire et choisi dans le référentiel (traiteur actif,
 *     NON shadow — §06.01, miroir du WITH CHECK de evt_gestionnaire_insert, seul
 *     rempart depuis le REVOKE INSERT sur `evenements`) ;
 *   · agence : le traiteur opérationnel est un shadow de cette agence ou un
 *     traiteur réel actif.
 */
export async function verifierPerimetreProgrammation(
  supabase: AdminSupabase,
  ctx: { role: string | undefined; isAdmin: boolean },
  p: {
    effectiveOrgId: string;
    lieuId: string;
    traiteurDemande: string | undefined;
  },
): Promise<{ traiteurOperationnelId: string } | { error: NextResponse }> {
  const traiteurOperationnelId =
    ctx.role === 'agence' || ctx.role === 'gestionnaire_lieux' || ctx.isAdmin
      ? (p.traiteurDemande ?? p.effectiveOrgId)
      : p.effectiveOrgId;

  if (!traiteurOperationnelId) {
    return {
      error: NextResponse.json(
        { error: 'traiteur_operationnel_organisation_id requis pour ce rôle' },
        { status: 422 },
      ),
    };
  }

  // Gap A : gestionnaire_lieux — valider que le lieu est dans son périmètre géré
  if (ctx.role === 'gestionnaire_lieux') {
    const { data: lieuLink } = await supabase
      .from('organisations_lieux')
      .select('id')
      .eq('organisation_id', p.effectiveOrgId)
      .eq('lieu_id', p.lieuId)
      .maybeSingle();
    if (!lieuLink) {
      return {
        error: NextResponse.json(
          {
            error:
              'Lieu non autorisé : ce lieu ne fait pas partie de votre périmètre',
          },
          { status: 403 },
        ),
      };
    }
  }

  // Gap C : gestionnaire_lieux — traiteur opérant du référentiel, non shadow.
  // Sans cette garde, un traiteur shadow passait, et un corps sans traiteur
  // retombait sur l'organisation du gestionnaire elle-même.
  if (ctx.role === 'gestionnaire_lieux') {
    if (!p.traiteurDemande) {
      return {
        error: NextResponse.json(
          {
            error: 'traiteur_operationnel_organisation_id requis pour ce rôle',
          },
          { status: 422 },
        ),
      };
    }
    const { data: traiteurReference } = await supabase
      .from('organisations')
      .select('id')
      .eq('id', traiteurOperationnelId)
      .eq('actif', true)
      .eq('type', 'traiteur')
      .eq('est_shadow', false)
      .maybeSingle();
    if (!traiteurReference) {
      return {
        error: NextResponse.json(
          {
            error:
              'Traiteur opérationnel non autorisé : choisissez un traiteur du référentiel',
          },
          { status: 403 },
        ),
      };
    }
  }

  // Gap B : agence — le traiteur opérationnel doit être soit un shadow de cette
  // agence, soit un traiteur réel actif référencé sur la plateforme.
  if (ctx.role === 'agence' && traiteurOperationnelId !== p.effectiveOrgId) {
    const { data: traiteurInfo } = await supabase
      .from('organisations')
      .select('id, type, est_shadow, cree_par_organisation_id')
      .eq('id', traiteurOperationnelId)
      .eq('actif', true)
      .maybeSingle();

    const isShadowPropre =
      traiteurInfo?.est_shadow === true &&
      traiteurInfo?.cree_par_organisation_id === p.effectiveOrgId;
    const isTraiteurReel =
      traiteurInfo?.est_shadow === false && traiteurInfo?.type === 'traiteur';

    if (!traiteurInfo || (!isShadowPropre && !isTraiteurReel)) {
      return {
        error: NextResponse.json(
          { error: 'Traiteur opérationnel non autorisé pour cette agence' },
          { status: 403 },
        ),
      };
    }
  }

  return { traiteurOperationnelId };
}
