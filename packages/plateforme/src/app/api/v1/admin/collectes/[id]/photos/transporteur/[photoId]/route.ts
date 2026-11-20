// GET /api/v1/admin/collectes/[id]/photos/transporteur/[photoId]
//
// Aperçu d'une photo du livreur dans la fenêtre de choix, sans rien stocker
// (décision Val 2026-11-20). Sert les photos que le navigateur ne peut pas lire
// lui-même chez le transporteur (MTS-1 exige sa clé d'API). L'identifiant est
// l'empreinte rendue par la liste : jamais une adresse venue du navigateur.
// Accès : équipe Savr (requireStaff). Le transporteur n'est jamais nommé ici
// (garde-fou 3) : tout passe par @savr/adapters.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { apercuPhotoTransporteur } from '@savr/adapters/src/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Une relecture du tour puis un téléchargement (30 s au plus).
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id, photoId } = await params;
  if (!/^[0-9a-f]{64}$/.test(photoId)) {
    return NextResponse.json({ error: 'Photo introuvable' }, { status: 404 });
  }

  let image: Awaited<ReturnType<typeof apercuPhotoTransporteur>>;
  try {
    image = await apercuPhotoTransporteur(createAdminSupabaseClient(), {
      collecteId: id,
      id: photoId,
      correlationId: randomUUID(),
    });
  } catch (e) {
    return serverError(e, 'admin.collectes.photos.transporteur.apercu');
  }
  if (!image) {
    return NextResponse.json({ error: 'Photo introuvable' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(image.contenu), {
    status: 200,
    headers: {
      'Content-Type': image.content_type,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
