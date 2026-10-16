import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/api-auth.js';
import { repondreBenchmarkFiche } from '@/lib/collectes/benchmark-fiche.js';

// GET /api/v1/admin/collectes/[id]/benchmark
// Radar ZD de l'onglet Documents de la fiche collecte Admin : le même que celui
// de la fiche client (décision Val 2026-10-16), et le même que celui du rapport
// régénéré par l'Admin. Calculé sous l'identité de l'appelant, k-anonymat
// compris : l'écran montre ce que le PDF imprimera.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreBenchmarkFiche(
    req,
    id,
    {
      userId: auth.ctx.userId,
      role: auth.ctx.role,
      // Sans objet pour un rôle staff : la fonction du parc ne lit que le rôle.
      organisationId: auth.ctx.organisationId ?? '',
    },
    'admin.collectes.benchmark',
  );
}
