import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { uploadObject } from '@savr/shared/src/r2/upload.js';

// Upload d'un logo vers R2, partagé par les routes admin, traiteur et
// gestionnaire (chacune garde sa garde de rôle). Contraintes CDC : JPG/PNG,
// ≤ 2 Mo. Retourne { logo_url: "bucket/logos/<uuid>.<ext>" } à écrire dans
// `logo_url` — format lu par `parseCleLogo` (lib/logo-key.ts, seul à le connaître).

const TYPES_AUTORISES = new Set(['image/png', 'image/jpeg']);
const TAILLE_MAX = 2 * 1024 * 1024; // 2 Mo

export async function uploadLogo(req: NextRequest): Promise<NextResponse> {
  const r = await televerserLogo(req);
  if ('reponse' in r) return r.reponse;
  return NextResponse.json({ logo_url: r.cle }, { status: 201 });
}

/**
 * Envoie le fichier `file` de la requête vers R2. Rend la clé « bucket/logos/… »,
 * ou la réponse d'erreur à renvoyer telle quelle (format, taille, stockage).
 */
export async function televerserLogo(
  req: NextRequest,
  options: { tailleMax?: number } = {},
): Promise<{ cle: string } | { reponse: NextResponse }> {
  const tailleMax = options.tailleMax ?? TAILLE_MAX;
  const erreur = (error: string, status: number) => ({
    reponse: NextResponse.json({ error }, { status }),
  });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return erreur('Requête multipart invalide', 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) return erreur('Champ "file" manquant', 422);
  if (!TYPES_AUTORISES.has(file.type))
    return erreur('Format non supporté (JPG ou PNG uniquement)', 422);
  if (file.size > tailleMax)
    return erreur(
      `Fichier trop volumineux (${Math.round(tailleMax / 1_000_000)} Mo maximum)`,
      422,
    );

  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const key = `logos/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const { storageKey } = await uploadObject(key, buffer, file.type);
    return { cle: storageKey };
  } catch {
    // R2 indisponible (ex. env local sans credentials) — non bloquant côté form.
    return erreur('Upload indisponible (stockage non configuré)', 503);
  }
}
