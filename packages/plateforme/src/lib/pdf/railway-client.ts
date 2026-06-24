// Client HTTP vers le service Railway PDF.
// Auth : header X-Internal-Token (secret RAILWAY_PDF_SECRET).

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

  const response = await fetch(`${baseUrl}/generate-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': secret,
    },
    body: JSON.stringify({ type, data }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Railway PDF ${response.status}: ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return { pdfBuffer: Buffer.from(arrayBuffer) };
}
