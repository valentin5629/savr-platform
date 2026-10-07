// PATCH /api/v1/admin/collectes/[id]/photos/[photoId]
// L'équipe Savr choisit (ou retire) une photo de collecte visible du client.
// Décisions Val 2026-10-07 : le client ne voit que les photos choisies ici, 2 au
// maximum par collecte ; une photo non choisie lui est masquée jusque dans la base
// (policy fichiers_select, colonne shared.fichiers.rang_client).
// Corps : { visible_client: boolean }.
// Accès : admin_savr + ops_savr (requireStaff), comme l'import de photos.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { readJsonBody, serverError, withApiTrace } from '@/lib/api-helpers.js';
import {
  CODE_RANG_DEJA_PRIS,
  ENTITE_PHOTO_COLLECTE,
  MESSAGE_MAX_PHOTOS_CLIENT,
  rangClientLibre,
  type RangClient,
} from '@/lib/collectes/photos-client.js';
import { estUuid } from '@/lib/filtre-csv.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const introuvable = (): NextResponse =>
  NextResponse.json({ error: 'Photo introuvable' }, { status: 404 });

const limiteAtteinte = (): NextResponse =>
  NextResponse.json({ error: MESSAGE_MAX_PHOTOS_CLIENT }, { status: 422 });

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id, photoId } = await params;
  if (!estUuid(id) || !estUuid(photoId)) return introuvable();

  const parsed = await readJsonBody<{ visible_client?: unknown }>(req);
  if ('error' in parsed) return parsed.error;
  const visible = parsed.data.visible_client;
  if (typeof visible !== 'boolean') {
    return NextResponse.json(
      { error: 'Champ "visible_client" attendu (true ou false)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // La photo doit être une image, non supprimée, rattachée à CETTE collecte : on
  // ne choisit jamais un fichier d'une autre collecte ni un document.
  const { data: photo, error: lectureErr } = await supabase
    .schema('shared')
    .from('fichiers')
    .select('id, rang_client')
    .eq('id', photoId)
    .eq('entity_type', ENTITE_PHOTO_COLLECTE)
    .eq('entity_id', id)
    .is('deleted_at', null)
    .like('content_type', 'image/%')
    .maybeSingle();
  if (lectureErr) {
    return serverError(lectureErr, 'admin.collectes.photos.selection.lecture');
  }
  if (!photo) return introuvable();

  const rangAvant = (photo as { rang_client: number | null }).rang_client;
  const dejaVisible = rangAvant !== null;
  if (dejaVisible === visible) {
    return NextResponse.json({
      photo: { id: photoId, visible_client: visible },
    });
  }

  let rang: RangClient | null = null;
  if (visible) {
    try {
      rang = await rangClientLibre(supabase, id);
    } catch (e) {
      return serverError(e, 'admin.collectes.photos.selection.rang');
    }
    if (rang === null) return limiteAtteinte();
  }

  const { data: maj, error: majErr } = await supabase
    .schema('shared')
    .from('fichiers')
    .update({ rang_client: rang })
    .eq('id', photoId)
    .eq('entity_type', ENTITE_PHOTO_COLLECTE)
    .eq('entity_id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  // Deux sélections simultanées ont visé la même place : la base n'en garde
  // qu'une (index unique), l'autre reçoit le même message que la limite.
  if (majErr?.code === CODE_RANG_DEJA_PRIS) return limiteAtteinte();
  if (majErr) {
    return serverError(majErr, 'admin.collectes.photos.selection.ecriture');
  }
  if (!maj) return introuvable();

  await supabase.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: visible ? 'photo_choisie_client' : 'photo_retiree_client',
    user_id: auth.ctx.userId,
    role: auth.ctx.role ?? null,
    old_values: { fichier_id: photoId, visible_client: dejaVisible },
    new_values: { fichier_id: photoId, visible_client: visible },
  });

  return NextResponse.json({
    photo: { id: photoId, visible_client: visible },
  });
}

export const PATCH = withApiTrace(patchHandler);
