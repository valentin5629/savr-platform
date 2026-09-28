import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import {
  lireProfilOrganisation,
  modifierInfosLegales,
} from '@/lib/organisation-infos-legales.js';

// GET / PATCH /api/v1/organisateur/mon-organisation/profil — SA propre organisation.
// Pas de section « Mon organisation » au CDC pour ce rôle : ajoutée par décision
// Val 2026-09-28 (informations légales modifiables par tous les rôles clients).

const ROLES: ClientRole[] = ['client_organisateur'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return lireProfilOrganisation(
    auth.ctx.organisationId,
    'organisateur.mon_organisation.profil.read',
  );
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return modifierInfosLegales(
    req,
    auth.ctx,
    'organisateur.mon_organisation.profil.update',
  );
}
