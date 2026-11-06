// Services qu'un transporteur peut rendre, et que l'Admin choisit quand il
// force ce transporteur (décision Val 2026-11-03).
//
// Le service d'une collecte AG se lit sur `attributions_antgaspi.branche_attribution`
// (§08 « Mapping branche_attribution → service »). Quand l'algorithme retient
// Marathon et que l'Admin force A Toutes!, la branche calculée (Marathon) ne
// désigne aucun service A Toutes! : l'envoi échouait en définitif (vécu le
// 2026-11-02). L'Admin choisit alors le service, rangé comme branche retenue.
//
// Module sans dépendance : la plateforme l'importe sans nommer le prestataire
// (garde-fou 3). La correspondance branche → identifiant de service reste dans
// l'adapter (everest/adapter.ts), épinglée sur cette liste par son test.

import type { TypeTms } from './index.js';

export interface ServiceTransporteur {
  /** Valeur rangée dans `attributions_antgaspi.branche_attribution`. */
  branche: string;
  libelle: string;
}

const SERVICES: Partial<Record<TypeTms, readonly ServiceTransporteur[]>> = {
  a_toutes: [
    { branche: 'ag_velo_programme', libelle: 'Vélo cargo programmé' },
    { branche: 'ag_velo_express', libelle: 'Vélo cargo express' },
    { branche: 'ag_marathon_volume_backup_camion', libelle: 'Camion' },
    { branche: 'ag_everest_camion_express', libelle: 'Camion express' },
  ],
};

/** Services au choix pour ce transporteur ; vide s'il n'en distingue pas. */
export function servicesAuChoix(
  typeTms: string | null | undefined,
): readonly ServiceTransporteur[] {
  return SERVICES[typeTms as TypeTms] ?? [];
}

/**
 * La branche désigne-t-elle un service que ce transporteur sait rendre ? Vrai
 * pour tout transporteur qui ne distingue pas de services.
 */
export function brancheCompatible(
  typeTms: string | null | undefined,
  branche: string | null | undefined,
): boolean {
  const services = servicesAuChoix(typeTms);
  return services.length === 0 || services.some((s) => s.branche === branche);
}

/** Services au choix de chaque transporteur qui en distingue (pour l'écran). */
export function servicesParTypeTms(): Record<
  string,
  readonly ServiceTransporteur[]
> {
  return { ...SERVICES } as Record<string, readonly ServiceTransporteur[]>;
}
