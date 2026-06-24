// Dispatch type_document → HTML, côté renderer (service Railway auto-suffisant).
//
// SOURCE UNIQUE des types gérés par le renderer + de leurs versions de gabarit.
// server.ts l'utilise (un type connu rend ; un type inconnu lève → 400).
//
// ⚠ Le renderer ne peut pas importer @savr/shared (build Docker hors workspace).
// L'alignement avec le contrat partagé worker (PDF_DOCUMENT_TYPES / TEMPLATE_VERSIONS)
// est garanti par le gate CI `check:integration-contracts`, qui compare ces deux
// constantes au contrat @savr/shared. Toute divergence (type ajouté côté worker mais
// pas ici, version désynchronisée) fait rougir le build → plus de 400 silencieux.

import {
  renderBordereauZd,
  TEMPLATE_VERSION as V_BORDEREAU,
  type BordereauZdData,
} from './templates/bordereau-zd.js';
import {
  renderRapportRecyclageZd,
  TEMPLATE_VERSION as V_RAPPORT,
  type RapportRecyclageZdData,
} from './templates/rapport-recyclage-zd.js';
import {
  renderAttestationDon,
  TEMPLATE_VERSION as V_ATTESTATION,
  type AttestationDonData,
} from './templates/attestation-don.js';

/** Types de document gérés par le renderer (doit = PDF_DOCUMENT_TYPES de @savr/shared). */
export const RENDERER_DOCUMENT_TYPES = [
  'bordereau-zd',
  'rapport-recyclage-zd',
  'attestation-don',
] as const;

export type RendererDocumentType = (typeof RENDERER_DOCUMENT_TYPES)[number];

/** Versions de gabarit (doit = TEMPLATE_VERSIONS de @savr/shared). */
export const RENDERER_TEMPLATE_VERSIONS: Record<RendererDocumentType, string> =
  {
    'bordereau-zd': V_BORDEREAU,
    'rapport-recyclage-zd': V_RAPPORT,
    'attestation-don': V_ATTESTATION,
  };

/** Levée quand `type` n'est pas un document connu → mappé en HTTP 400 par server.ts. */
export class UnknownDocumentTypeError extends Error {
  constructor(public readonly type: string) {
    super(`Type de document inconnu : ${type}`);
    this.name = 'UnknownDocumentTypeError';
  }
}

/**
 * Rend le HTML du document `type` à partir de `data`. Lève UnknownDocumentTypeError
 * si le type n'est pas géré (→ 400), ou une erreur de template si `data` est invalide
 * (→ 422). UNION exhaustive : ajouter un type au contrat partagé sans l'ajouter ici
 * est détecté par le gate integration-contracts.
 */
export function renderByType(type: string, data: unknown): string {
  switch (type) {
    case 'bordereau-zd':
      return renderBordereauZd(data as BordereauZdData);
    case 'rapport-recyclage-zd':
      return renderRapportRecyclageZd(data as RapportRecyclageZdData);
    case 'attestation-don':
      return renderAttestationDon(data as AttestationDonData);
    default:
      throw new UnknownDocumentTypeError(type);
  }
}
