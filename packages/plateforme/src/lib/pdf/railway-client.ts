// Client HTTP vers le service Railway PDF.
// Auth : header X-Internal-Token (secret RAILWAY_PDF_SECRET).

import { libelleErreurReseau } from '@savr/shared/src/api/erreur-reseau.js';
import type { PdfDocumentType } from '@savr/shared/src/pdf/document-types.js';

export interface PdfGenerateResult {
  pdfBuffer: Buffer;
}

export async function generatePdf(
  type: PdfDocumentType,
  data: Record<string, unknown>,
): Promise<PdfGenerateResult> {
  const baseUrl = process.env['RAILWAY_PDF_URL'];
  const secret = process.env['RAILWAY_PDF_SECRET'];

  if (!baseUrl) throw new Error('RAILWAY_PDF_URL manquant');
  if (!secret) throw new Error('RAILWAY_PDF_SECRET manquant');

  // Sérialisée AVANT le `try` : une charge utile illisible est une erreur de
  // notre code, pas un appel resté sans réponse — elle remonte telle quelle.
  const corps = JSON.stringify({ type, data });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/generate-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': secret,
      },
      body: corps,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Jamais l'erreur telle quelle : `fetch` y recopie la valeur d'en-tête qu'il
    // refuse, donc le secret entier, et l'appelant écrit ce qu'il reçoit dans
    // jobs_pdf.last_error (cf. libelleErreurReseau).
    throw new Error(`Railway PDF : ${libelleErreurReseau(err)}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Railway PDF ${response.status}: ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return { pdfBuffer: Buffer.from(arrayBuffer) };
}
