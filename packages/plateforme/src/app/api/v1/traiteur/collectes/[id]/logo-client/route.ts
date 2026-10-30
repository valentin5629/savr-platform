// /api/v1/traiteur/collectes/[id]/logo-client
// Logo du client imprimé sur les rapports, déposé depuis la fiche collecte par
// tout utilisateur qui peut télécharger le rapport (décision Val 2026-10-30).
//   GET    : affiche le logo déposé sur l'événement de la collecte (404 sans logo)
//   POST   : dépose un logo (multipart, champ `file`, JPG/PNG ≤ 2 Mo)
//   DELETE : retire le logo
// Accès (collecte visible sous RLS, non annulée, rapport non réservé) et effets :
// lib/evenements/logo-client-rapport.ts.

import { NextRequest } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import {
  acteurDepuis,
  deposerLogoClient,
  retirerLogoClient,
  servirLogoClient,
} from '@/lib/evenements/logo-client-rapport.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Le dépôt remet en fabrication les rapports de don de l'événement.
export const maxDuration = 60;

const ROLES: ClientRole[] = ['traiteur_manager', 'traiteur_commercial'];

type Contexte = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Contexte) {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return servirLogoClient((await params).id, acteurDepuis(auth.ctx, false));
}

export async function POST(req: NextRequest, { params }: Contexte) {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return deposerLogoClient(
    req,
    (await params).id,
    acteurDepuis(auth.ctx, false),
  );
}

export async function DELETE(req: NextRequest, { params }: Contexte) {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return retirerLogoClient((await params).id, acteurDepuis(auth.ctx, false));
}
