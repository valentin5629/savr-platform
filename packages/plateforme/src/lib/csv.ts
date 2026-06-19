import { NextResponse } from 'next/server';

// Wrapper Next du helper CSV partagé (logique pure dans @savr/shared/src/csv).
// Émet une réponse de téléchargement CSV (UTF-8, attachment).
export function csvResponse(filename: string, csv: string): NextResponse {
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
