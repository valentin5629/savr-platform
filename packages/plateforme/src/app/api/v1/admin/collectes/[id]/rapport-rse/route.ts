// POST /api/v1/admin/collectes/[id]/rapport-rse
// Rapport de recyclage d'une collecte ZD, fabriqué au clic depuis l'onglet
// Documents de la fiche collecte Admin (décision Val 2026-10-16). Le corps
// choisit s'il porte le radar de comparaison ; `benchmark_filters` = les filtres
// réglés sur le radar de l'onglet, sinon le segment de la collecte
// (filtresRadarParDefaut). La réponse est le PDF. Accès : admin_savr + ops_savr.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { repondreRapportStaff } from '@/lib/collectes/rapport-a-la-demande.js';
import { filtresRadarParDefaut } from '@/lib/pdf/rapport-radar.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Le rendu Puppeteer prend quelques secondes (délai du client de rendu : 30 s).
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreRapportStaff(
    req,
    id,
    {
      userId: auth.ctx.userId,
      role: auth.ctx.role,
      // Sans objet pour un rôle staff : la fonction du parc ne lit que le rôle.
      organisationId: auth.ctx.organisationId ?? '',
    },
    'admin.collectes.rapport.fabrication',
    () => filtresRadarParDefaut(createAdminSupabaseClient(), id),
  );
}
