'use client';

import {
  LeafIcon,
  PackageIcon,
  RecycleIcon,
  ScalesIcon,
} from '@/components/ui/icones';
import { CelluleVide } from '@/components/ui/data-grid';
import { Text } from '@/components/ui/text';
import { fmtInt, fmtKgAuto, fmtPct, UNITE_KG_CO2E } from '@/lib/format';
import { LIBELLE_SANS_EXCEDENT } from '@/lib/statut-collecte-labels';

// Cellule « Résultats » de la liste Événements du gestionnaire : les résultats
// de la colonne du même nom de la liste Collectes (poids · taux de recyclage ·
// repas · CO₂ évité, mêmes pictos), cumulés sur les collectes réalisées de
// l'événement (lib/evenements-gestionnaire). « — » tant qu'aucune ne l'est, ou
// quand aucune valeur n'est à montrer ; « Sans excédent » quand les seules
// collectes réalisées sont des AG sans excédent, comme sur la liste Collectes.
// Pas de téléchargement ici : les rapports sont par collecte, dans la fiche.
export function ResultatsEvenement({
  e,
}: {
  e: {
    nb_realisees: number;
    nb_sans_excedent: number;
    tonnage_zd_kg: number | null;
    taux_recyclage: number | null;
    repas_donnes: number | null;
    co2_evite_kg: number | null;
  };
}) {
  const positif = (v: number | null): v is number => v != null && v > 0;
  const valeurs = [
    positif(e.tonnage_zd_kg) && {
      cle: 'poids',
      Icone: ScalesIcon,
      texte: fmtKgAuto(e.tonnage_zd_kg),
    },
    e.taux_recyclage != null && {
      cle: 'taux',
      Icone: RecycleIcon,
      texte: fmtPct(e.taux_recyclage, 0),
    },
    positif(e.repas_donnes) && {
      cle: 'repas',
      Icone: PackageIcon,
      texte: `${fmtInt(e.repas_donnes)} repas`,
    },
    positif(e.co2_evite_kg) && {
      cle: 'co2',
      Icone: LeafIcon,
      // Espace insécable : le chiffre et l'unité ne se séparent jamais.
      texte: [fmtInt(e.co2_evite_kg), UNITE_KG_CO2E].join('\u00a0'),
    },
  ].filter((v) => v !== false);

  if (e.nb_realisees === 0) return <CelluleVide />;
  if (
    valeurs.length === 0 &&
    e.nb_sans_excedent > 0 &&
    e.nb_sans_excedent === e.nb_realisees
  )
    valeurs.push({
      cle: 'sans-excedent',
      Icone: PackageIcon,
      texte: LIBELLE_SANS_EXCEDENT,
    });
  if (valeurs.length === 0) return <CelluleVide />;

  return (
    <Text
      as="div"
      variant="hint"
      tone="soft"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 font-bold"
    >
      {valeurs.map(({ cle, Icone, texte }) => (
        <span key={cle} className="inline-flex items-center gap-1.5">
          <Icone className="h-3.5 w-3.5 text-savr-neutral-400" />
          {texte}
        </span>
      ))}
    </Text>
  );
}
