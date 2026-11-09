'use client';

import * as React from 'react';
import { uniteCo2 } from '@/lib/format';
import { fmtDec, fmtInt, fmtMasse } from './fmt';
import { Text } from '@/components/ui/text';

// Co2MethodePanelAg — variante ANTI-GASPI (allégée) de la méthode de calcul CO₂.
// Le CO₂ AG est « évité seul en V1 » (§05 R_co2_ag, §11 l.163) : une formule
// UNIQUE par repas (facteur figé × repas donnés), sans induit / net / énergie
// ni tableau de facteurs par matière (ceux-ci sont ZD, méthode ABC ADEME). Purement
// présentationnel : le facteur par repas est lu côté serveur (service_role) dans
// `plateforme.parametres_facteurs_co2_ag` (repli 2,5 kg CO₂e/repas, FAO 2023).
interface Co2MethodePanelAgProps {
  /** Facteur d'émission évité par repas (kg CO₂e/repas), figé à la clôture. */
  facteurParRepas: number;
  /** Source du facteur (ex. « FAO 2023 — Food loss and waste footprint »). */
  source: string | null;
  /** Repas donnés cumulés sur la période (= Σ volume_repas_realise). */
  repasDonnes: number;
  /** CO₂e évité figé cumulé (kg) — Σ co2_evite_kg de v_kpi_traiteur. */
  eviteKg: number;
  /** Facteurs d'équivalence pédagogique (ADEME, parametres_co2_divers). */
  equivalences: { km_voiture: number; repas_boeuf: number };
}

function Formule({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="border-l-2 border-savr-neutral-200 pl-3">
      <Text as="div" tone="ink" className="font-bold">
        {titre}
      </Text>
      <Text as="div" tone="soft" className="mt-0.5 leading-relaxed">
        {children}
      </Text>
    </div>
  );
}

export function Co2MethodePanelAg({
  facteurParRepas,
  source,
  repasDonnes,
  eviteKg,
  equivalences,
}: Co2MethodePanelAgProps): React.ReactElement {
  const evite = fmtMasse(eviteKg);
  return (
    <section className="rounded-savr-lg border border-savr-neutral-200 bg-savr-neutral-50 p-5">
      <h4 className="text-md font-extrabold text-savr-neutral-900">
        Comment ce chiffre est-il calculé ?
      </h4>
      <Text className="mt-0.5">
        Base Carbone ADEME. Chaque repas donné évite la production d'un repas
        moyen. Le nombre de repas est estimé à partir du poids donné. Chaque
        collecte garde le facteur en vigueur à son calcul, puis les collectes
        sont additionnées sur la période filtrée.
      </Text>

      <div className="mt-4 flex flex-col gap-3">
        <Formule titre="CO₂e évité">
          <b className="text-savr-neutral-800">
            repas donnés × facteur d'émission évité par repas
            (kg&nbsp;CO₂e/repas)
          </b>{' '}
          — le CO₂ qu'on n'émet pas en réutilisant les invendus plutôt qu'en les
          jetant. Pas d'induit ni de bilan net en V1 (méthode simplifiée « évité
          seul »).
        </Formule>
        <Formule titre="Application sur la période">
          {fmtInt(repasDonnes)} repas donnés,{' '}
          <b className="text-savr-neutral-800">
            {evite.value}&nbsp;{uniteCo2(evite.unit)}
          </b>{' '}
          évités
          {repasDonnes > 0
            ? `, soit en moyenne ${fmtDec(eviteKg / repasDonnes, 2)} kg\u00a0CO₂e par repas`
            : ''}
          .
        </Formule>
        <Formule titre="Équivalences pédagogiques">
          km voiture = évité ÷ {fmtDec(equivalences.km_voiture, 3)}{' '}
          kg&nbsp;CO₂e/km · repas de bœuf = évité ÷{' '}
          {fmtDec(equivalences.repas_boeuf, 0)} kg&nbsp;CO₂e.
        </Formule>
      </div>

      <Text variant="hint" tone="faint" className="mt-4">
        Facteur en vigueur : {fmtDec(facteurParRepas, 2)} kg&nbsp;CO₂e par repas
        {source ? ` — ${source}` : ''}. Les collectes calculées avant le 6
        novembre 2026 gardent l'estimation FAO de 2,5 kg&nbsp;CO₂e par repas.
      </Text>
    </section>
  );
}
Co2MethodePanelAg.displayName = 'Co2MethodePanelAg';
