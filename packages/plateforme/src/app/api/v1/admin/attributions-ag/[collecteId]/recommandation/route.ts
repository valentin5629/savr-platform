import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/api-auth.js';
import { calculerAlgoAttributionAg } from '@/lib/attribution-ag/algo.js';

// GET /api/v1/admin/attributions-ag/[collecteId]/recommandation
// Lance le moteur algo et retourne les suggestions associations + branche transporteur
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ collecteId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { collecteId } = await params;

  try {
    const result = await calculerAlgoAttributionAg(collecteId);
    return NextResponse.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur algorithme';
    if (msg.includes('P0030') || msg.includes('introuvable')) {
      return NextResponse.json(
        { error: 'Collecte AG introuvable' },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
