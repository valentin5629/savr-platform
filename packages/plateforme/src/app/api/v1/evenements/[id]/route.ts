import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { espaceEvenementsDuRole } from '@/lib/evenements/liste-evenements.js';
import { chargerFicheEvenement } from '@/lib/evenements/fiche-evenement.js';

// GET /api/v1/evenements/[id] — fiche Événement, commune à tous les rôles
// (décision Val 2026-10-29). Logique et règles : lib/evenements/fiche-evenement.ts.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;
  const espace = espaceEvenementsDuRole(auth.ctx.role);
  if (!espace)
    return NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 });
  const { id } = await params;
  const r = await chargerFicheEvenement(id, auth.ctx, espace);
  if (r.etat === 'introuvable')
    return NextResponse.json(
      { error: 'Événement non trouvé' },
      { status: 404 },
    );
  if (r.etat === 'erreur') return serverError(r.erreur, 'evenements.fiche');
  return NextResponse.json({ data: r.data });
}
