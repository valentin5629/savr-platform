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
      <Text as="div" size="xs-plus" tone="ink" className="font-bold">
        {titre}
      </Text>
      <Text
        as="div"
        size="xs-plus"
        tone="soft"
        className="mt-0.5 leading-relaxed"
      >
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
      <h4 className="text-[15px] font-extrabold text-savr-neutral-900">
        Comment ces chiffres sont-ils calculés ?
      </h4>
      <Text size="xs-plus" className="mt-0.5">
        Méthode ABC de l'ADEME. Les grandeurs sont figées à la clôture de chaque
        collecte, puis additionnées sur la période filtrée.
      </Text>

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
          <Table className="min-w-[420px]">
            <TableHeader>
              <TableRow>
                <TableHead>Matière</TableHead>
                <TableHead className="text-right">Évité (kgCO₂e/t)</TableHead>
                <TableHead className="text-right">Induit (kgCO₂e/t)</TableHead>
                <TableHead className="text-right">Énergie (kWh/t)</TableHead>
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
                  <TableCell className="text-right tabular-nums">
                    {fmtDec(f.energie, 0)}
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
