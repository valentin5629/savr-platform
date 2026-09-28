import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import {
  lireProfilOrganisation,
  modifierInfosLegales,
} from '@/lib/organisation-infos-legales.js';

// GET / PATCH /api/v1/agence/mon-organisation/profil — SA propre organisation.
// CDC §06.11 : « Mon organisation » identique au §06.04 §6. Édition des
// informations légales (raison sociale, SIRET, adresse) : décision Val 2026-09-28.

const ROLES: ClientRole[] = ['agence'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return lireProfilOrganisation(
    auth.ctx.organisationId,
    'agence.mon_organisation.profil.read',
  );
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return modifierInfosLegales(
    req,
    auth.ctx,
    'agence.mon_organisation.profil.update',
  );
}
