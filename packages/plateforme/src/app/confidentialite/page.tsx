// /confidentialite — politique de confidentialité de la plateforme.
//
// Écran PUBLIC (déclaré dans `PUBLIC_PREFIXES`) : le CDC (§15, 3.4) la veut
// lisible sans connexion, liée depuis l'application et depuis les emails.

import type { Metadata } from 'next';
import {
  POLITIQUE_CONFIDENTIALITE_MISE_A_JOUR,
  POLITIQUE_CONFIDENTIALITE_SECTIONS,
} from '@/content/politique-confidentialite';
import { TexteJuridique } from '@/components/texte-juridique';

export const metadata: Metadata = {
  title: 'Politique de confidentialité — Savr',
};

export default function ConfidentialitePage() {
  return (
    <TexteJuridique
      titre="Politique de confidentialité"
      sousTitre={<>Mise à jour : {POLITIQUE_CONFIDENTIALITE_MISE_A_JOUR}.</>}
      sections={POLITIQUE_CONFIDENTIALITE_SECTIONS}
      retour={{ href: '/', libelle: 'Retour à la plateforme' }}
    />
  );
}
