// /api/v1/admin/collectes/[id]/photos/[photoId]/recadrage
//
// Recadrage d'une photo de collecte (décisions Val 2026-11-20, C1 et C2) :
//   GET    rend l'ORIGINAL de la photo (l'éditeur part toujours de lui, même
//          sur une photo déjà recadrée) ; servi par Savr pour que le navigateur
//          puisse le découper (une image d'une autre origine ne se lit pas) ;
//   PUT    enregistre la version recadrée (multipart, champ `fichier`, JPEG) ;
//          l'original est gardé ;
//   DELETE revient à l'original.
// La ligne shared.fichiers pointe sur la version affichée : galerie, espace
// client et rapports suivent sans rien changer (cf. lib/collectes/photo-recadrage).
// Les rapports déjà fabriqués ne sont pas refaits : « Régénérer » le fait.
// Accès : équipe Savr (requireStaff), comme l'import et le choix des photos.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { uploadObject } from '@savr/shared/src/r2/upload.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';
import { ENTITE_PHOTO_COLLECTE } from '@/lib/collectes/photos-client.js';
import {
  cleOriginale,
  cleRecadree,
  estRecadree,
  typeDeLOriginal,
} from '@/lib/collectes/photo-recadrage.js';
import { estUuid } from '@/lib/filtre-csv.js';
import { getObjectBytes } from '@/lib/pdf/r2-client.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Même plafond que l'import d'une photo depuis l'ordinateur.
const TAILLE_MAX = 5 * 1024 * 1024;

type Params = { params: Promise<{ id: string; photoId: string }> };

interface PhotoRow {
  id: string;
  bucket: string;
  key: string;
}

const introuvable = (): NextResponse =>
  NextResponse.json({ error: 'Photo introuvable' }, { status: 404 });

// La photo doit être une image vivante de CETTE collecte, rangée dans son
// dossier : jamais un fichier d'une autre collecte ni un document.
async function lirePhoto(
  id: string,
  photoId: string,
): Promise<PhotoRow | null | 'erreur'> {
  const { data, error } = await createAdminSupabaseClient()
    .schema('shared')
    .from('fichiers')
    .select('id, bucket, key')
    .eq('id', photoId)
    .eq('entity_type', ENTITE_PHOTO_COLLECTE)
    .eq('entity_id', id)
    .is('deleted_at', null)
    .like('content_type', 'image/%')
    .maybeSingle();
  if (error) return 'erreur';
  const photo = data as PhotoRow | null;
  if (!photo || !photo.key.startsWith(`photos/collectes/${id}/`)) return null;
  return photo;
}

// Appelée APRÈS `requireStaff`, que chaque handler fait lui-même (cliquet
// tests/securite/api-routes-gardees).
async function garde(
  auth: { ctx: { userId: string; role?: string | null } },
  { params }: Params,
): Promise<
  | { refus: NextResponse }
  | {
      photo: PhotoRow;
      id: string;
      userId: string;
      role: string | null;
    }
> {
  const { id, photoId } = await params;
  if (!estUuid(id) || !estUuid(photoId)) return { refus: introuvable() };
  const photo = await lirePhoto(id, photoId);
  if (photo === 'erreur') {
    return {
      refus: serverError(
        new Error('lecture photo impossible'),
        'admin.collectes.photos.recadrage.lecture',
      ),
    };
  }
  if (!photo) return { refus: introuvable() };
  return {
    photo,
    id,
    userId: auth.ctx.userId,
    role: auth.ctx.role ?? null,
  };
}

function estJpeg(octets: Buffer): boolean {
  return (
    octets.length > 3 &&
    octets[0] === 0xff &&
    octets[1] === 0xd8 &&
    octets[2] === 0xff
  );
}

async function journaliser(
  ctx: { id: string; userId: string; role: string | null },
  action: 'photo_recadree' | 'photo_recadrage_annule',
  fichierId: string,
): Promise<void> {
  await createAdminSupabaseClient()
    .from('audit_log')
    .insert({
      table_name: 'collectes',
      record_id: ctx.id,
      action,
      user_id: ctx.userId,
      role: ctx.role,
      new_values: { fichier_id: fichierId },
    });
}

async function getHandler(req: NextRequest, ctx: Params) {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const g = await garde(auth, ctx);
  if ('refus' in g) return g.refus;
  const original = cleOriginale(g.photo.key);
  let octets: Buffer;
  try {
    octets = await getObjectBytes(`${g.photo.bucket}/${original}`);
  } catch (e) {
    return serverError(e, 'admin.collectes.photos.recadrage.original');
  }
  return new NextResponse(new Uint8Array(octets), {
    status: 200,
    headers: {
      'Content-Type': typeDeLOriginal(original),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function putHandler(req: NextRequest, ctx: Params) {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const g = await garde(auth, ctx);
  if ('refus' in g) return g.refus;

  const form = await req.formData().catch(() => null);
  const fichier = form?.get('fichier');
  if (!(fichier instanceof Blob)) {
    return NextResponse.json(
      { error: 'Photo recadrée attendue (champ "fichier")' },
      { status: 422 },
    );
  }
  if (fichier.size > TAILLE_MAX) {
    return NextResponse.json(
      { error: 'Photo recadrée trop volumineuse (5 Mo maximum)' },
      { status: 422 },
    );
  }
  const octets = Buffer.from(await fichier.arrayBuffer());
  // Le contenu fait foi, pas le type annoncé par le navigateur.
  if (!estJpeg(octets)) {
    return NextResponse.json(
      { error: 'La photo recadrée doit être une image JPEG' },
      { status: 422 },
    );
  }

  const key = cleRecadree(g.photo.key);
  let bucket: string;
  try {
    ({ bucket } = await uploadObject(key, octets, 'image/jpeg'));
  } catch {
    return NextResponse.json(
      { error: 'Upload indisponible (stockage non configuré)' },
      { status: 503 },
    );
  }
  // L'objet est écrit : la ligne peut le désigner.
  const { data: maj, error } = await createAdminSupabaseClient()
    .schema('shared')
    .from('fichiers')
    .update({
      bucket,
      key,
      content_type: 'image/jpeg',
      size_bytes: octets.length,
    })
    .eq('id', g.photo.id)
    .eq('entity_id', g.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error)
    return serverError(error, 'admin.collectes.photos.recadrage.ecriture');
  if (!maj) return introuvable();
  await journaliser(g, 'photo_recadree', g.photo.id);
  return NextResponse.json({ photo: { id: g.photo.id, recadree: true } });
}

async function deleteHandler(req: NextRequest, ctx: Params) {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const g = await garde(auth, ctx);
  if ('refus' in g) return g.refus;
  if (!estRecadree(g.photo.key)) {
    return NextResponse.json({ photo: { id: g.photo.id, recadree: false } });
  }
  const original = cleOriginale(g.photo.key);
  // L'original est relu : sa taille est remise, et une ligne ne désigne jamais
  // un objet absent.
  let octets: Buffer;
  try {
    octets = await getObjectBytes(`${g.photo.bucket}/${original}`);
  } catch (e) {
    return serverError(e, 'admin.collectes.photos.recadrage.original');
  }
  const { data: maj, error } = await createAdminSupabaseClient()
    .schema('shared')
    .from('fichiers')
    .update({
      key: original,
      content_type: typeDeLOriginal(original),
      size_bytes: octets.length,
    })
    .eq('id', g.photo.id)
    .eq('entity_id', g.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error)
    return serverError(error, 'admin.collectes.photos.recadrage.retour');
  if (!maj) return introuvable();
  await journaliser(g, 'photo_recadrage_annule', g.photo.id);
  return NextResponse.json({ photo: { id: g.photo.id, recadree: false } });
}

export const GET = withApiTrace(getHandler);
export const PUT = withApiTrace(putHandler);
export const DELETE = withApiTrace(deleteHandler);
