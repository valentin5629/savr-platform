// Failover Ops — acceptation manuelle mission Everest (M2.5, M14 W4).
// Rôle : ops_savr ou admin_savr uniquement.
// Déclenché quand Everest est down et que l'Ops a calé la course par téléphone
// avec A Toutes!.
//
// §06.06 §3 Bloc 0 (arbitrage Val 2026-09-16) : la RÉFÉRENCE DE MISSION
// communiquée par A Toutes! est OBLIGATOIRE et s'écrit dans
// `tournees.external_ref_commande` exactement comme au dispatch normal. Sans
// elle la mission était invisible au système : collecte « non transmise » alors
// qu'un vélo est réservé, renvoi qui émettait un vrai dispatch, annulation qui
// ne partait nulle part.
//
// Toutes les écritures (tournée, mission, collecte, audit) passent par UNE RPC
// transactionnelle : la route en faisait quatre à la suite sans lire une seule
// `error`, et répondait `{ ok: true }` même quand un CHECK avait tout refusé.

import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { requireStaff } from '@/lib/api-auth.js';
import {
  businessError,
  readJsonBody,
  typedRpcError,
} from '@/lib/api-helpers.js';
import { validerAcceptationManuelle } from '@/lib/acceptation-manuelle-mission.js';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const parsed = await readJsonBody(req);
  if ('error' in parsed) return parsed.error;

  const saisie = validerAcceptationManuelle(parsed.data);
  if ('error' in saisie) return saisie.error;
  const v = saisie.valeurs;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc(
    'fn_accepter_mission_everest_manuelle',
    {
      p_collecte_id: v.collecte_id,
      p_reference: v.reference_mission,
      p_contact: v.contact_joint,
      p_commentaire: v.commentaire ?? undefined,
      p_heure_appel: v.heure_appel ?? undefined,
      p_user_id: auth.ctx.userId,
      p_role: auth.ctx.role,
    },
  );

  if (error) {
    const code = (error as { code?: string }).code;
    // Refus métier (collecte terminée, pas chez A Toutes!, mission déjà créée par
    // l'API, autre référence déjà posée, référence portée par une autre tournée —
    // `uniq_tournee_par_external_ref`) : la RPC lève en P0003 un libellé FR écrit
    // par nous — renvoyé tel quel, allowlist de code fermée.
    if (code === 'P0003') {
      return businessError(
        error,
        'admin.everest.manual_accept',
        ['P0003'],
        409,
      );
    }
    return typedRpcError(error, 'admin.everest.manual_accept', {
      message404: 'Collecte ou tournée A Toutes! introuvable.',
      message422: 'Référence de mission et contact joint obligatoires.',
    });
  }

  return NextResponse.json({
    ok: true,
    reference_mission: v.reference_mission,
    rejeu: (data as { rejeu?: boolean } | null)?.rejeu === true,
  });
}
