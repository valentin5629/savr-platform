// Code affaire VIPARIS saisi au formulaire de programmation (Val 2026-11-02) :
// contrôlé ici AVANT toute écriture (422), puis écrit par
// fn_enregistrer_programmation dans la même transaction que l'événement.

import { NextResponse } from 'next/server';
import {
  MESSAGE_FORMAT_CODE_AFFAIRE_VIPARIS,
  normaliserCodeAffaireViparis,
} from './codes.js';

export function codeAffaireViparisDuCorps(body: {
  code_affaire_viparis?: unknown;
}): { code: string | null } | { error: NextResponse } {
  const code = normaliserCodeAffaireViparis(body.code_affaire_viparis);
  if (code === undefined) {
    return {
      error: NextResponse.json(
        {
          error: MESSAGE_FORMAT_CODE_AFFAIRE_VIPARIS,
          champ: 'code_affaire_viparis',
        },
        { status: 422 },
      ),
    };
  }
  return { code };
}
