import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAnyUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import type { DbClient } from '@/lib/dashboards/loaders.js';
import {
  espaceEvenementsDuRole,
  listerEvenements,
} from '@/lib/evenements/liste-evenements.js';

// GET /api/v1/evenements — liste Événements, commune aux six rôles (décision
// Val 2026-10-29). Une ligne = un événement, résultats cumulés sur ses
// collectes. Le périmètre de chaque rôle est celui de ses policies
// `evt_*_select`, lues sous sa session ; le staff lit tout, en service_role
// comme les autres routes Admin. Paramètres et règles :
// lib/evenements/liste-evenements.ts.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;
  const espace = espaceEvenementsDuRole(auth.ctx.role);
  if (!espace)
    return NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 });

  const supabase = (
    auth.ctx.isStaff
      ? createAdminSupabaseClient()
      : createSupabaseServerClient()
  ) as DbClient;
  const r = await listerEvenements(
    supabase,
    espace,
    new URL(req.url).searchParams,
  );
  if (!r.ok) return serverError(r.error, 'evenements.list');
  return NextResponse.json({ data: r.data, total: r.total, page: r.page });
}
