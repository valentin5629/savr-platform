// Contrat partagé worker ↔ renderer PDF (anti-drift, BL-P0-03 / BL-P1-API-07).
//
// SOURCE UNIQUE de la liste des `type_document` PDF et de leur version de template.
// Consommée côté Plateforme par :
//   - le batch (enqueue jobs_pdf.type_document),
//   - railway-client.generatePdf(type, …) (type du POST /generate-pdf),
//   - pdf-worker (cast + persistance template_version).
//
// ⚠ Le renderer (apps/pdf-renderer) est un service Railway AUTO-SUFFISANT : son
// Dockerfile ne build que `apps/pdf-renderer/` (npm, hors workspace pnpm) → il ne
// PEUT PAS importer ce module à l'exécution. L'alignement renderer ↔ ce contrat
// est donc garanti par le gate CI statique `check:integration-contracts`
// (scripts/check-integration-contracts.ts), pas par un import runtime.

/** Liste fermée des documents PDF générés en V1. 1 entrée = 1 template renderer. */
export const PDF_DOCUMENT_TYPES = [
  'bordereau-zd',
  'rapport-recyclage-zd',
  'attestation-don',
] as const;

export type PdfDocumentType = (typeof PDF_DOCUMENT_TYPES)[number];

/**
 * Version figée du template de chaque document (BL-P1-API-07).
 * Persistée par le worker dans `<table>.template_version` à chaque rendu →
 * un re-rendu ultérieur est tracé iso (même version = même gabarit).
 * Incrémenter `@N` à toute modification visuelle/structurelle d'un template.
 */
export const TEMPLATE_VERSIONS: Record<PdfDocumentType, string> = {
  'bordereau-zd': 'bordereau-zd@1',
  'rapport-recyclage-zd': 'rapport-recyclage-zd@1',
  'attestation-don': 'attestation-don@1',
};

/** Garde de type : `x` est-il un type de document PDF connu ? */
export function isPdfDocumentType(x: unknown): x is PdfDocumentType {
  return (
    typeof x === 'string' &&
    (PDF_DOCUMENT_TYPES as readonly string[]).includes(x)
  );
}
