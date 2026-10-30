// /api/v1/evenements/[id]/logo-client
// Logo du client imprimé sur les rapports, déposé depuis la fiche événement,
// commune à tous les rôles (décisions Val 2026-10-30 : client organisateur
// compris).
//   GET    : affiche le logo déposé sur l'événement (404 sans logo)
//   POST   : dépose un logo (multipart, champ `file`, JPG/PNG ≤ 1 Mo)
//   DELETE : retire le logo
// Accès (événement visible sous RLS, règle du donneur d'ordre) et effets :
// lib/evenements/logo-client-rapport.ts.

import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser } from '@/lib/api-auth.js';
import { espaceEvenementsDuRole } from '@/lib/evenements/liste-evenements.js';
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

type Contexte = { params: Promise<{ id: string }> };

const refusRole = () =>
  NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 });

export async function GET(req: NextRequest, { params }: Contexte) {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;
  if (!espaceEvenementsDuRole(auth.ctx.role)) return refusRole();
  return servirLogoClient(
    { evenementId: (await params).id },
    acteurDepuis(auth.ctx, auth.ctx.isStaff),
  );
}

export async function POST(req: NextRequest, { params }: Contexte) {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;
  if (!espaceEvenementsDuRole(auth.ctx.role)) return refusRole();
  return deposerLogoClient(
    req,
    { evenementId: (await params).id },
    acteurDepuis(auth.ctx, auth.ctx.isStaff),
  );
}

export async function DELETE(req: NextRequest, { params }: Contexte) {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;
  if (!espaceEvenementsDuRole(auth.ctx.role)) return refusRole();
  return retirerLogoClient(
    { evenementId: (await params).id },
    acteurDepuis(auth.ctx, auth.ctx.isStaff),
  );
}
