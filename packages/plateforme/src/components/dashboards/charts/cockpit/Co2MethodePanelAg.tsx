'use client';

import * as React from 'react';
import { fmtDec, fmtInt, fmtMasse } from './fmt';

// Co2MethodePanelAg — variante ANTI-GASPI (allégée) de la méthode de calcul CO₂.
// Le CO₂ AG est « évité seul en V1 » (§05 R_co2_ag, §11 l.163) : une formule
// UNIQUE par repas (facteur FAO figé × repas donnés), sans induit / net / énergie
// ni tableau de facteurs par matière (ceux-ci sont ZD, méthode ABC ADEME). Purement
// présentationnel : le facteur par repas est lu côté serveur (service_role) dans
// `plateforme.parametres_facteurs_co2_ag` (repli 2,5 kgCO₂e/repas, FAO 2023).
interface Co2MethodePanelAgProps {
  /** Facteur d'émission évité par repas (kgCO₂e/repas), figé à la clôture. */
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
      <div className="text-[13px] font-bold text-savr-neutral-900">{titre}</div>
      <div className="mt-0.5 text-[13px] leading-relaxed text-savr-neutral-600">
        {children}
      </div>
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
      <h4 className="text-[15px] font-extrabold text-savr-neutral-900">
        Comment ce chiffre est-il calculé ?
      </h4>
      <p className="mt-0.5 text-[13px] text-savr-neutral-500">
        Méthode FAO. Chaque repas sauvé du gaspillage évite une empreinte
        carbone moyenne, figée à la clôture de chaque collecte, puis additionnée
        sur la période filtrée.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Formule titre="CO₂e évité">
          <b className="text-savr-neutral-800">
            repas donnés × facteur d'émission évité par repas (kgCO₂e/repas)
          </b>{' '}
          — le CO₂ qu'on n'émet pas en réutilisant les invendus plutôt qu'en les
          jetant. Pas d'induit ni de bilan net en V1 (méthode simplifiée « évité
          seul »).
        </Formule>
        <Formule titre="Application sur la période">
          {fmtInt(repasDonnes)} repas × {fmtDec(facteurParRepas, 2)}{' '}
          kgCO₂e/repas ={' '}
          <b className="text-savr-neutral-800">
            {evite.value} {evite.unit} CO₂e
          </b>
          .
        </Formule>
        <Formule titre="Équivalences pédagogiques">
          km voiture = évité ÷ {fmtDec(equivalences.km_voiture, 3)} kgCO₂e/km ·
          repas de bœuf = évité ÷ {fmtDec(equivalences.repas_boeuf, 0)} kgCO₂e.
        </Formule>
      </div>

      <p className="mt-4 text-[11px] text-savr-neutral-400">
        Facteur d'émission : {fmtDec(facteurParRepas, 2)} kgCO₂e par repas
        {source ? ` — ${source}` : ''}.
      </p>
    </section>
  );
}
Co2MethodePanelAg.displayName = 'Co2MethodePanelAg';
