// Texte des mentions légales, publiées sur /mentions-legales.
//
// Exigées avant le go-live par le CDC (§15 Sécurité et conformité, checklist
// « Mentions légales publiées ») et par la loi (LCEN, art. 6-III) : éditeur,
// directeur de la publication, hébergeur. Informations de l'éditeur relues sur
// l'avis de situation INSEE et le RNE (Val, 2026-11-06). Même format que les CGU
// (`cgu-texte.ts`) : segments {texte, gras}, jamais de HTML.
//
// Modifier ce texte = mettre à jour `MENTIONS_LEGALES_MISE_A_JOUR`.

import type { BlocCgu, SectionCgu } from './cgu-texte';

export const MENTIONS_LEGALES_MISE_A_JOUR = '6 novembre 2026';

/** Capital social de SAVR, en euros (statuts). */
export const CAPITAL_SOCIAL_SAVR = '80 000';

const p = (texte: string): BlocCgu => ({
  type: 'p',
  segments: [{ texte, gras: false }],
});

/** Élément de liste « Libellé : texte », le libellé en gras. */
const li = (libelle: string, texte: string): BlocCgu => ({
  type: 'li',
  segments: [
    { texte: libelle, gras: true },
    { texte: ` : ${texte}`, gras: false },
  ],
});

export const MENTIONS_LEGALES_SECTIONS: SectionCgu[] = [
  {
    titre: 'Éditeur',
    blocs: [
      p(
        'La plateforme Savr (app.gosavr.io) est éditée par SAVR, société par actions simplifiée.',
      ),
      li('Capital social', `${CAPITAL_SOCIAL_SAVR} euros`),
      li('Siège social', '50 rue des Moines, 75017 Paris'),
      li('Immatriculation', 'RCS de Paris, numéro 879 642 890'),
      li('Numéro de TVA intracommunautaire', 'FR32879642890'),
      li('Téléphone', '06 59 27 87 73'),
      li('Email', 'gestion@gosavr.io'),
    ],
  },
  {
    titre: 'Directeur de la publication',
    blocs: [p('Louis Rauscher de Barbe de La Barthe, Président de SAVR.')],
  },
  {
    titre: 'Hébergement',
    blocs: [
      li(
        'Site',
        'Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (vercel.com)',
      ),
      li(
        'Base de données',
        'Supabase Pte. Ltd., 65 Chulia Street #38-02/03, OCBC Centre, Singapour 049513 (supabase.com), sur des serveurs situés à Paris',
      ),
    ],
  },
  {
    titre: 'Propriété intellectuelle',
    blocs: [
      p(
        "La plateforme, ses textes, son code, son algorithme d'attribution et la marque Savr appartiennent à SAVR. Toute reproduction sans autorisation écrite de SAVR est interdite.",
      ),
    ],
  },
  {
    titre: 'Données personnelles',
    blocs: [
      p(
        "Le traitement des données personnelles est décrit dans la politique de confidentialité, accessible à l'adresse app.gosavr.io/confidentialite.",
      ),
    ],
  },
];
