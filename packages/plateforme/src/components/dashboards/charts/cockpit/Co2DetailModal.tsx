'use client';

import * as React from 'react';
import { Modal } from '@/components/ui/modal';
import { Text } from '@/components/ui/text';
import {
  co2Equivalences,
  type Co2Totals,
  type FacteursCo2,
} from '@/lib/dashboards/cockpit-derive';
import { Co2HeroCard } from './Co2HeroCard';
import { Co2MethodePanel, type Co2FluxFactor } from './Co2MethodePanel';
import { Co2MethodePanelAg } from './Co2MethodePanelAg';

// Variables du calcul CO₂ renvoyées par les endpoints kpi (traiteur, admin) pour
// la modale méthode. `ag` = facteur anti-gaspi par repas (méthode « évité seul »
// V1, §11 l.163).
export interface Co2Methode {
  forfait: { km: number; fe_camion: number };
  flux: Co2FluxFactor[];
  ag?: { facteur_par_repas: number; source: string | null };
}

/** ISO `YYYY-MM-DD` → `DD/MM/YYYY` (affichage FR de la période analysée). */
function frDate(iso?: string): string {
  return iso ? iso.split('-').reverse().join('/') : '—';
}

// Co2DetailModal — modale « Détail de l'impact carbone » des dashboards traiteur
// et client (Admin), ouverte au clic sur la carte KPI CO₂ évité (R-UI-5, G4 —
// ex-4 instances recopiées, ZD + AG × 2 dashboards). Période analysée, héros CO₂
// (grandeurs figées) puis méthode de calcul et variables utilisées :
//   - `zero_dechet` : héros ABC complet + méthode ADEME par flux ;
//   - `anti_gaspi`  : héros allégé (évité seul) + méthode par repas (facteur FAO
//     figé × repas donnés).
export function Co2DetailModal({
  open,
  onClose,
  type,
  from,
  to,
  nbCollectes,
  co2,
  facteursCo2,
  co2Methode,
  repasDonnes = 0,
}: {
  open: boolean;
  onClose: () => void;
  type: 'zero_dechet' | 'anti_gaspi';
  /** Bornes ISO de la période analysée. */
  from?: string;
  to?: string;
  nbCollectes: number;
  co2: Co2Totals;
  facteursCo2: FacteursCo2;
  co2Methode: Co2Methode | undefined;
  /** Repas donnés cumulés sur la période (AG seulement). */
  repasDonnes?: number;
}) {
  const ag = type === 'anti_gaspi';
  const equivalences = co2Equivalences(co2, facteursCo2);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Détail de l'impact carbone"
      wide
    >
      <div className="space-y-5">
        <Text>
          Période analysée :{' '}
          <span className="font-semibold text-savr-neutral-700">
            du {frDate(from)} au {frDate(to)}
          </span>{' '}
          · {nbCollectes} collecte{nbCollectes > 1 ? 's' : ''} clôturée
          {nbCollectes > 1 ? 's' : ''} {ag ? 'Anti-Gaspi' : 'Zéro Déchet'}
        </Text>
        {ag ? (
          <>
            <Co2HeroCard
              variant="ag"
              eviteKg={co2.eviteKg}
              equivalences={{
                kmVoiture: equivalences.kmVoiture,
                repasBoeuf: equivalences.repasBoeuf,
              }}
            />
            <Co2MethodePanelAg
              facteurParRepas={co2Methode?.ag?.facteur_par_repas ?? 2.5}
              source={co2Methode?.ag?.source ?? null}
              repasDonnes={repasDonnes}
              eviteKg={co2.eviteKg}
              equivalences={facteursCo2}
            />
          </>
        ) : (
          <>
            <Co2HeroCard
              eviteKg={co2.eviteKg}
              induitKg={co2.induitKg}
              netKg={co2.netKg}
              energiePrimaireKwh={co2.energieKwh}
              equivalences={equivalences}
            />
            <Co2MethodePanel
              forfait={co2Methode?.forfait ?? { km: 50, fe_camion: 2.1 }}
              fluxFactors={co2Methode?.flux ?? []}
              equivalences={facteursCo2}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
