import { NextResponse } from 'next/server';
import { getObject } from '@savr/shared/src/r2/upload.js';

// Réponse commune des proxys d'affichage de logo (R2 n'est pas public).
// Quatre routes servent un logo — admin/uploads, traiteur/mon-organisation,
// gestionnaire/mon-organisation, gestionnaire/traiteurs/[id] — et ne diffèrent que
// par QUI a le droit et D'OÙ vient la clé. Le corps de la réponse, lui, était
// identique quatre fois : en-têtes de cache et de sécurité inclus. Les regrouper
// ici fait qu'un changement de politique (max-age, Content-Disposition) se fait en
// un seul endroit, sans risque d'en oublier une.
//
// La clé DOIT avoir été bornée par `parseCleLogo` (lib/logo-key.ts) en amont :
// ce helper ne contrôle pas le périmètre, il ne fait que servir l'objet.
export async function servirLogo(cle: {
  bucket: string;
  key: string;
}): Promise<NextResponse> {
  try {
    const { body, contentType } = await getObject(cle.bucket, cle.key);
    return new NextResponse(Buffer.from(body), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Logo introuvable' }, { status: 404 });
  }
}
