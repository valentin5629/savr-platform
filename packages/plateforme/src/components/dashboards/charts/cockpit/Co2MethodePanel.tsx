'use client';

import * as React from 'react';
import { fmtDec } from './fmt';
import { Text } from '@/components/ui/text';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Co2MethodePanel — explique la MÉTHODE de calcul du CO₂e évité et affiche les
// VARIABLES réellement utilisées (facteurs évités par matière + équivalences),
// pour comprendre d'où viennent les chiffres du héros (retour Val R24c).
// Décisions Val 2026-11-09 : évité et induit, jamais de bilan net ni d'énergie.
// Purement présentationnel ; valeurs reçues en props (lues
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

export function Co2MethodePanel({
  forfait,
  fluxFactors,
  equivalences,
}: Co2MethodePanelProps): React.ReactElement {
  return (
    <section className="rounded-savr-lg border border-savr-neutral-200 bg-savr-neutral-50 p-5">
      <h4 className="text-md font-extrabold text-savr-neutral-900">
        Comment ces chiffres sont-ils calculés ?
      </h4>
      <Text className="mt-0.5">
        Méthode Savr, facteurs d'émission de la Base Carbone ADEME. Chaque
        collecte est calculée avec les facteurs en vigueur à son calcul (refait
        à chaque correction de poids), puis les collectes sont additionnées sur
        la période filtrée.
      </Text>

      <div className="mt-4 flex flex-col gap-3">
        <Formule titre="CO₂e évité">
          Σ sur chaque flux collecté, déchet résiduel compris, de{' '}
          <b className="text-savr-neutral-800">
            poids (t) × facteur d'émissions évitées (kg&nbsp;CO₂e/t)
          </b>{' '}
          — le facteur de la Base Carbone ADEME pour le traitement du flux
          (recyclage, méthanisation, incinération du résiduel).{' '}
          <span className="text-savr-neutral-500">
            Des émissions évitées se présentent à part : elles ne se déduisent
            pas d'un bilan carbone.
          </span>
        </Formule>
        <Formule titre="CO₂ induit">
          Transport de collecte (
          <b className="text-savr-neutral-800">
            {fmtDec(forfait.km, 0)} km × {fmtDec(forfait.fe_camion, 2)}{' '}
            kg&nbsp;CO₂e/km
          </b>
          , réparti au prorata du poids) + émissions de traitement de chaque
          matière.
        </Formule>
        <Formule titre="Équivalences pédagogiques">
          km voiture = évité ÷ {fmtDec(equivalences.km_voiture, 3)}{' '}
          kg&nbsp;CO₂e/km · repas de bœuf = évité ÷{' '}
          {fmtDec(equivalences.repas_boeuf, 0)} kg&nbsp;CO₂e.
        </Formule>
      </div>

      {fluxFactors.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-savr-neutral-500">
            Facteurs d'émission par matière (Base Carbone ADEME)
          </div>
          <Table className="min-w-[360px]">
            <TableHeader>
              <TableRow>
                <TableHead>Matière</TableHead>
                <TableHead className="text-right">
                  Évité (kg&nbsp;CO₂e/t)
                </TableHead>
                <TableHead className="text-right">
                  Induit (kg&nbsp;CO₂e/t)
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fluxFactors.map((f) => (
                <TableRow key={f.code}>
                  <TableCell className="font-semibold">{f.nom}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtDec(f.fe_evite, 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtDec(f.fe_induit, 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
Co2MethodePanel.displayName = 'Co2MethodePanel';
