export { BenchmarkFilterBar } from './BenchmarkFilterBar.js';
export type {
  BenchmarkFilters,
  BenchmarkFilterOptions,
} from './BenchmarkFilterBar.js';
export { ParcMultiSelects } from './ParcMultiSelects.js';
export type { ParcFilterOptions, ParcFilterValue } from './ParcMultiSelects.js';
export { TAILLE_OPTIONS } from './taille-options.js';
export {
  FLUX_ZD,
  FLUX_ZD_CODES,
  TAUX_RECYCLAGE_COLOR,
  REPAS_COLOR,
  RATIO_COLOR,
} from './flux.js';
export type { FluxZd } from './flux.js';
export { useEvolutionBlocs } from './useEvolutionBlocs.js';
export type {
  EvolutionType,
  FluxSeriePoint,
  RepasSeriePoint,
} from './useEvolutionBlocs.js';
// `CollecteType` vit désormais avec le segmenté partagé (R-UI-4b, D1) ;
// réexporté ici pour les consommateurs du barrel.
export type { CollecteType } from '@/components/collecte/toggle-type-collecte';
export type { DashboardFilters } from './DashboardFilterBar.js';
export { DashboardFilterBar } from './DashboardFilterBar.js';
export { EmptyDashboardState } from './EmptyDashboardState.js';
export { RevenusHistogramme } from './RevenusHistogramme.js';
export { TonnageDisplay } from './TonnageDisplay.js';
export { ExportSyntheseBloc } from './ExportSyntheseBloc.js';
export type {
  BlocsData,
  TopLieu,
  TopActeur,
  TopAssociation,
} from './blocs-types.js';
