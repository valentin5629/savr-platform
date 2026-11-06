// /mentions-legales — mentions légales de la plateforme (LCEN, art. 6-III).
//
// Écran PUBLIC (déclaré dans `PUBLIC_PREFIXES`) : la loi les veut accessibles
// à tout visiteur, sans compte.

import type { Metadata } from 'next';
import {
  MENTIONS_LEGALES_MISE_A_JOUR,
  MENTIONS_LEGALES_SECTIONS,
} from '@/content/mentions-legales';
import { TexteJuridique } from '@/components/texte-juridique';

export const metadata: Metadata = {
  title: 'Mentions légales — Savr',
};

export default function MentionsLegalesPage() {
  return (
    <TexteJuridique
      titre="Mentions légales"
      sousTitre={<>Mise à jour : {MENTIONS_LEGALES_MISE_A_JOUR}.</>}
      sections={MENTIONS_LEGALES_SECTIONS}
      retour={{ href: '/', libelle: 'Retour à la plateforme' }}
    />
  );
}
