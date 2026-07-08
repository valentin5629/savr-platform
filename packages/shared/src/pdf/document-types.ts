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
// est donc garanti par le gate CI statique `check:pdf-contract`
// (scripts/check-pdf-contract.ts), pas par un import runtime.

/** Liste fermée des documents PDF générés en V1. 1 entrée = 1 template renderer. */
export const PDF_DOCUMENT_TYPES = [
  'bordereau-zd',
  'rapport-recyclage-zd',
  'attestation-don',
  // Rapport de synthèse agrégé §12 §1.6 (multi-collectes, à la demande, non archivé).
  // Généré en synchrone par la route /api/v1/dashboards/synthese-pdf (R20b-2).
  'synthese-dashboard',
  // Rapport « Événement sans excédent alimentaire » §12 §1.3-bis (AG
  // realisee_sans_collecte : justificatif texte seul, sans photos). Porté par une
  // ligne rapports_rse standard, disponible_a = genere_at (pas d'embargo H+24).
  // Slug CDC = rapport_evenement_sans_excedent. Batch runBatchSansExcedent (R21b).
  'rapport-evenement-sans-excedent',
  // Facture — copie de travail visuelle §06.08 §1 (l.30/l.343). PAS la facture
  // légale (celle-ci = Factur-X Pennylane, pdf_url_pennylane). Enfilée à l'émission
  // (validerFacture succès), écrite dans factures.pdf_url_savr par le worker. R22b BL-P2-01.
  'facture',
] as const;

export type PdfDocumentType = (typeof PDF_DOCUMENT_TYPES)[number];

/**
 * Version figée du template de chaque document (BL-P1-API-07).
 * Persistée par le worker dans `<table>.template_version` à chaque rendu →
 * un re-rendu ultérieur est tracé iso (même version = même gabarit).
 * Incrémenter `@N` à toute modification visuelle/structurelle d'un template.
 */
export const TEMPLATE_VERSIONS: Record<PdfDocumentType, string> = {
  'bordereau-zd': 'bordereau-zd@2',
  'rapport-recyclage-zd': 'rapport-recyclage-zd@2',
  'attestation-don': 'attestation-don@2',
  'synthese-dashboard': 'synthese-dashboard@1',
  'rapport-evenement-sans-excedent': 'rapport-evenement-sans-excedent@1',
  facture: 'facture@1',
};

/** Garde de type : `x` est-il un type de document PDF connu ? */
export function isPdfDocumentType(x: unknown): x is PdfDocumentType {
  return (
    typeof x === 'string' &&
    (PDF_DOCUMENT_TYPES as readonly string[]).includes(x)
  );
}
