import { type ExportBuilder, type ExportEntity } from './shared.js';
import { buildEvenementsExport } from './evenements.js';
import {
  buildCollectesExport,
  buildPeseesExport,
  buildFacturesExport,
  buildPacksAgExport,
  buildAssociationsAgExport,
  buildImpactRseExport,
} from './builders.js';

export * from './shared.js';

// Registre entité → builder. La capacité par rôle est gouvernée par EXPORT_MATRIX.
export const EXPORT_BUILDERS: Record<ExportEntity, ExportBuilder> = {
  collectes: buildCollectesExport,
  evenements: buildEvenementsExport,
  pesees: buildPeseesExport,
  factures: buildFacturesExport,
  'packs-ag': buildPacksAgExport,
  'associations-ag': buildAssociationsAgExport,
  'impact-rse': buildImpactRseExport,
};
