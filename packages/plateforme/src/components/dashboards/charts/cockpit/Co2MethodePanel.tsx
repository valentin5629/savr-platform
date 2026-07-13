'use client';

import * as React from 'react';
import { fmtDec } from './fmt';
import { TEXT_MUTED } from './palette';

// Co2MethodePanel — explique la MÉTHODE de calcul CO₂ (ABC ADEME) et affiche les
// VARIABLES réellement utilisées (forfait transport + facteurs d'émission par
// matière + équivalences), pour comprendre d'où viennent les chiffres du héros
// (retour Val R24c). Purement présentationnel ; valeurs reçues en props (lues
// côté serveur dans parametres_facteurs_co2 / parametres_co2_divers, ADEME).
export interface Co2FluxFactor {
  code: string;
  nom: string;
  fe_evite: number;
  fe_induit: number;
  energie: number;
}

interface Co2MethodePanelProps {
  forfait: { km: number; fe_camion: number };
  fluxFactors: Co2FluxFactor[];
  equivalences: { km_voiture: number; repas_boeuf: number; foyer_kwh: number };
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

export function Co2MethodePanel({
  forfait,
  fluxFactors,
  equivalences,
}: Co2MethodePanelProps): React.ReactElement {
  return (
    <section className="rounded-savr-lg border border-savr-neutral-200 bg-savr-neutral-50 p-5">
      <h4 className="text-[15px] font-extrabold text-savr-neutral-900">
        Comment ces chiffres sont-ils calculés ?
      </h4>
      <p className="mt-0.5 text-[13px] text-savr-neutral-500">
        Méthode ABC de l'ADEME. Les grandeurs sont figées à la clôture de chaque
        collecte, puis additionnées sur la période filtrée.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Formule titre="CO₂e évité">
          Σ sur les matières recyclées de{' '}
          <b className="text-savr-neutral-800">
            poids (t) × facteur d'émission évité (kgCO₂e/t)
          </b>{' '}
          — le CO₂ qu'on n'émet PAS en valorisant plutôt qu'en enfouissant ou
          incinérant.
        </Formule>
        <Formule titre="CO₂ induit">
          Transport de collecte (
          <b className="text-savr-neutral-800">
            {fmtDec(forfait.km, 0)} km × {fmtDec(forfait.fe_camion, 2)}{' '}
            kgCO₂e/km
          </b>
          , réparti au prorata du poids) + émissions de traitement de chaque
          matière.
        </Formule>
        <Formule titre="Bilan net">
          CO₂ induit − CO₂e évité.{' '}
          <span className="text-savr-neutral-500">
            L'évité et l'induit ne sont jamais soustraits pour annoncer une
            compensation (règle ADEME).
          </span>
        </Formule>
        <Formule titre="Énergie primaire évitée">
          Σ de{' '}
          <b className="text-savr-neutral-800">
            poids (t) × facteur énergie de la matière (kWh/t)
          </b>
          .
        </Formule>
        <Formule titre="Équivalences pédagogiques">
          km voiture = évité ÷ {fmtDec(equivalences.km_voiture, 3)} kgCO₂e/km ·
          repas de bœuf = évité ÷ {fmtDec(equivalences.repas_boeuf, 0)} kgCO₂e ·
          foyers = énergie ÷ {fmtDec(equivalences.foyer_kwh, 0)} kWh/an.
        </Formule>
      </div>

      {fluxFactors.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-savr-neutral-500">
            Facteurs d'émission par matière (ADEME Base Carbone)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left" style={{ color: TEXT_MUTED }}>
                  <th className="py-1.5 pr-3 font-semibold">Matière</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">
                    Évité (kgCO₂e/t)
                  </th>
                  <th className="py-1.5 pr-3 text-right font-semibold">
                    Induit (kgCO₂e/t)
                  </th>
                  <th className="py-1.5 text-right font-semibold">
                    Énergie (kWh/t)
                  </th>
                </tr>
              </thead>
              <tbody>
                {fluxFactors.map((f) => (
                  <tr key={f.code} className="border-t border-savr-neutral-200">
                    <td className="py-1.5 pr-3 font-semibold text-savr-neutral-800">
                      {f.nom}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-savr-neutral-700">
                      {fmtDec(f.fe_evite, 0)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-savr-neutral-700">
                      {fmtDec(f.fe_induit, 0)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-savr-neutral-700">
                      {fmtDec(f.energie, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
Co2MethodePanel.displayName = 'Co2MethodePanel';
