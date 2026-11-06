// /cgu — publication du texte des Conditions Générales d'Utilisation.
//
// Écran PUBLIC (déclaré dans `PUBLIC_PREFIXES`) : il doit être lisible avant
// d'avoir un compte, puisque c'est à l'inscription qu'on demande de l'accepter.
// Le contenu vient de `content/cgu-v1.ts` (dérivé du CDC, cf. l'en-tête de ce
// fichier) ; la mise en page est commune aux textes juridiques.

import type { Metadata } from 'next';
import { CGU_SECTIONS, CGU_TEXTE_VERSION } from '@/content/cgu-v1';
import { TexteJuridique } from '@/components/texte-juridique';
import { ROUTES } from '@/lib/routes';

export const metadata: Metadata = {
  title: "Conditions Générales d'Utilisation — Savr",
};

export default function CguPage() {
  return (
    <TexteJuridique
      titre="Conditions Générales d'Utilisation"
      sousTitre={
        <>
          Version {CGU_TEXTE_VERSION} — activités Zéro-Déchet et Anti-Gaspi.
          C&apos;est le texte accepté à la création d&apos;un compte Savr.
        </>
      }
      sections={CGU_SECTIONS}
      retour={{
        href: ROUTES.signup,
        libelle: 'Retour à la création de compte',
      }}
    />
  );
}
