// GET  /api/v1/admin/collectes/[id]/photos/transporteur
// POST /api/v1/admin/collectes/[id]/photos/transporteur  { ids: string[] }
//
// Photos prises par le livreur, relues chez le transporteur de la collecte
// (décision Val 2026-11-03) : le GET les liste, le POST importe celles que
// l'Admin a cochées. Une photo importée arrive non cochée « Visible du client ».
// Accès : équipe Savr (requireStaff). Le transporteur n'est jamais nommé ici
// (garde-fou 3) : tout passe par @savr/adapters.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  importerPhotosTransporteur,
  listerPhotosTransporteur,
  PhotoTransporteurInconnueError,
} from '@savr/adapters/src/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { logger } from '@savr/shared/src/logger/index.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Une relecture par course puis un téléchargement par photo.
export const maxDuration = 60;

const MAX_PHOTOS_PAR_IMPORT = 20;

const pasPrisEnCharge = () =>
  NextResponse.json(
    { error: 'Ce transporteur ne fournit pas les photos du livreur' },
    { status: 409 },
  );

// null = la base n'a pas répondu (jamais lu comme « introuvable »).
async function collecteExiste(id: string): Promise<boolean | null> {
  const { data, error } = await createAdminSupabaseClient()
    .from('collectes')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) return null;
  return data !== null;
}

function reponseCollecte(existe: boolean | null): NextResponse | null {
  if (existe === null) {
    return serverError(
      new Error('lecture collecte impossible'),
      'admin.collectes.photos.transporteur.collecte',
    );
  }
  if (!existe) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const refus = reponseCollecte(await collecteExiste(id));
  if (refus) return refus;

  try {
    const lu = await listerPhotosTransporteur(
      createAdminSupabaseClient(),
      id,
      randomUUID(),
    );
    if (!lu.pris_en_charge) return pasPrisEnCharge();
    return NextResponse.json({
      photos: lu.photos,
      courses_illisibles: lu.courses_illisibles,
    });
  } catch (e) {
    return serverError(e, 'admin.collectes.photos.transporteur.list');
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = body?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_PHOTOS_PAR_IMPORT ||
    !ids.every((x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x))
  ) {
    return NextResponse.json(
      {
        error: `Choisissez entre 1 et ${MAX_PHOTOS_PAR_IMPORT} photos`,
      },
      { status: 422 },
    );
  }
  const refus = reponseCollecte(await collecteExiste(id));
  if (refus) return refus;

  const supabase = createAdminSupabaseClient();
  let resultat: Awaited<ReturnType<typeof importerPhotosTransporteur>>;
  try {
    resultat = await importerPhotosTransporteur(supabase, {
      collecteId: id,
      ids: ids as string[],
      userId: auth.ctx.userId,
      correlationId: randomUUID(),
    });
  } catch (e) {
    if (e instanceof PhotoTransporteurInconnueError) {
      return NextResponse.json(
        { error: 'Photo introuvable chez le transporteur, rechargez la liste' },
        { status: 422 },
      );
    }
    return serverError(e, 'admin.collectes.photos.transporteur.import');
  }
  if (!resultat.pris_en_charge) {
    return pasPrisEnCharge();
  }

  const { importees, deja_importees, echecs, restantes } = resultat;
  if (importees > 0) {
    const { error: auditErr } = await supabase.from('audit_log').insert({
      table_name: 'collectes',
      record_id: id,
      action: 'photos_transporteur_importees',
      user_id: auth.ctx.userId,
      role: auth.ctx.role ?? null,
      new_values: { importees, deja_importees, echecs, restantes },
    });
    if (auditErr) {
      logger.error('admin.collectes.photos.transporteur.audit', {
        collecte_id: id,
        erreur: auditErr.message,
      });
    }
  }
  return NextResponse.json(
    { importees, deja_importees, echecs, restantes },
    {
      status:
        echecs > 0 && importees === 0 && deja_importees === 0 && restantes === 0
          ? 502
          : 200,
    },
  );
}
