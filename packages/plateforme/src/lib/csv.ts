import { NextResponse } from 'next/server';

// Wrapper Next du helper CSV partagé (logique pure dans @savr/shared/src/csv).
// Émet une réponse de téléchargement CSV (UTF-8, attachment).

// Caractères admis dans le nom de fichier annoncé par Content-Disposition.
// Tous les appelants passent aujourd'hui un préfixe littéral, donc rien ne peut
// s'y glisser — mais le jour où un préfixe dérive d'une entrée utilisateur, un
// guillemet ou un CR/LF interpolé tel quel casserait l'en-tête (voire en
// injecterait un autre). La garde rend cette classe impossible par construction,
// sans rien changer pour les noms actuels.
const CARACTERE_INTERDIT = /[^A-Za-z0-9._-]/g;

export function csvResponse(filename: string, csv: string): NextResponse {
  const nomSur = filename.replace(CARACTERE_INTERDIT, '_') || 'export.csv';
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomSur}"`,
      'Cache-Control': 'no-store',
    },
  });
}
