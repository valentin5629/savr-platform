/**
 * check-integration-contracts — gate BLOQUANT worker ↔ renderer PDF (R2 / piège 3).
 *
 * Le renderer (apps/pdf-renderer) est un service Railway auto-suffisant : il NE PEUT
 * PAS importer le contrat partagé @savr/shared à l'exécution (build Docker hors
 * workspace pnpm). Il duplique donc la liste des type_document + leurs versions de
 * gabarit. Ce gate empêche la dérive silencieuse (un type enqueué par le worker mais
 * non géré par le renderer ⇒ HTTP 400 ⇒ document jamais produit — exactement le bug
 * BL-P0-03) en comparant statiquement les deux sources :
 *
 *   @savr/shared/src/pdf/document-types  (PDF_DOCUMENT_TYPES, TEMPLATE_VERSIONS)
 *        ===
 *   apps/pdf-renderer/src/render          (RENDERER_DOCUMENT_TYPES, RENDERER_TEMPLATE_VERSIONS)
 *
 * Sortie : exit 1 (build rouge) + détail des écarts si divergence ; exit 0 sinon.
 */

import {
  PDF_DOCUMENT_TYPES,
  TEMPLATE_VERSIONS,
} from '../packages/shared/src/pdf/document-types.js';
import {
  RENDERER_DOCUMENT_TYPES,
  RENDERER_TEMPLATE_VERSIONS,
} from '../apps/pdf-renderer/src/render.js';

const errors: string[] = [];

const sharedTypes = [...PDF_DOCUMENT_TYPES].sort();
const rendererTypes = [...RENDERER_DOCUMENT_TYPES].sort();

// 1. Mêmes types des deux côtés
const missingInRenderer = sharedTypes.filter((t) => !rendererTypes.includes(t));
const missingInShared = rendererTypes.filter(
  (t) => !(sharedTypes as string[]).includes(t),
);
for (const t of missingInRenderer) {
  errors.push(
    `Type « ${t} » enqueué (contrat @savr/shared) mais NON géré par le renderer → 400 silencieux. Ajouter une branche dans apps/pdf-renderer/src/render.ts.`,
  );
}
for (const t of missingInShared) {
  errors.push(
    `Type « ${t} » géré par le renderer mais ABSENT du contrat @savr/shared (jamais enqueué). Retirer la branche ou l'ajouter à PDF_DOCUMENT_TYPES.`,
  );
}

// 2. Mêmes versions de gabarit (re-rendu iso : la version persistée par le worker
//    doit correspondre au gabarit réellement déployé sur le renderer).
for (const t of sharedTypes) {
  if (!rendererTypes.includes(t)) continue;
  const sharedV = (TEMPLATE_VERSIONS as Record<string, string>)[t];
  const rendererV = (RENDERER_TEMPLATE_VERSIONS as Record<string, string>)[t];
  if (sharedV !== rendererV) {
    errors.push(
      `Version de gabarit désynchronisée pour « ${t} » : @savr/shared=${sharedV} vs renderer=${rendererV}.`,
    );
  }
}

if (errors.length > 0) {
  console.error('\n⛔  Contrat d’intégration worker ↔ renderer PDF rompu :\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    '\n→ La liste des type_document et leurs versions DOIVENT être identiques côté contrat partagé (@savr/shared) et côté renderer (apps/pdf-renderer/src/render.ts).\n',
  );
  process.exit(1);
}

console.log(
  `✅  Contrat d’intégration worker ↔ renderer PDF : OK (${sharedTypes.length} types alignés, versions synchronisées).`,
);
process.exit(0);
