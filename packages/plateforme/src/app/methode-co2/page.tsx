// /methode-co2 — méthode de calcul du CO₂ de Savr.
//
// Écran PUBLIC (déclaré dans `PUBLIC_PREFIXES`) : lié sous chaque CO₂e évité
// des écrans clients, pour qu'un chiffre repris dans une communication renvoie
// vers sa méthode (décision Val 2026-11-10, guide anti-greenwashing Climeet).

import type { Metadata } from 'next';
import {
  METHODE_CO2_MISE_A_JOUR,
  METHODE_CO2_SECTIONS,
} from '@/content/methode-co2';
import { TexteJuridique } from '@/components/texte-juridique';

export const metadata: Metadata = {
  title: 'Méthode de calcul du CO₂ — Savr',
};

export default function MethodeCo2Page() {
  return (
    <TexteJuridique
      titre="Méthode de calcul du CO₂"
      sousTitre={
        <>
          Comment Savr estime le CO₂ de vos collectes. Mise à jour :{' '}
          {METHODE_CO2_MISE_A_JOUR}.
        </>
      }
      sections={METHODE_CO2_SECTIONS}
      retour={{ href: '/', libelle: 'Retour à la plateforme' }}
    />
  );
}
