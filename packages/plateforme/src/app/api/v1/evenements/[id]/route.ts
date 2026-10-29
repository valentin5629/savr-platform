import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  ROLES_FICHE_EVENEMENT,
  espaceFicheDuRole,
} from '@/lib/evenements/espace-fiche.js';
import { chargerFicheEvenement } from '@/lib/evenements/fiche-evenement.js';

// GET /api/v1/evenements/[id] — fiche Événement, commune aux rôles qui l'ont
// (décision Val 2026-10-29). Logique et règles : lib/evenements/fiche-evenement.ts.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES_FICHE_EVENEMENT);
  if (auth.error) return auth.error;
  const { id } = await params;
  const r = await chargerFicheEvenement(
    id,
    auth.ctx,
    espaceFicheDuRole(auth.ctx.role),
  );
  if (r.etat === 'introuvable')
    return NextResponse.json(
      { error: 'Événement non trouvé' },
      { status: 404 },
    );
  if (r.etat === 'erreur') return serverError(r.erreur, 'evenements.fiche');
  return NextResponse.json({ data: r.data });
}
