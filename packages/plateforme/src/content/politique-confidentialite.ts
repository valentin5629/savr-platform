// Texte de la politique de confidentialité, publiée sur /confidentialite.
//
// Exigée avant le go-live par le CDC (§15 Sécurité et conformité, 3.4) : page
// lisible sans connexion, liée depuis l'application et les emails. Données et
// bases légales : tableau §15 3.2. Durées : celles que la plateforme applique
// réellement (aucune purge des contacts ni des comptes n'existe) ; les écarts
// au §15 3.2 sont tracés dans `_Divergences/SECU-RGPD_20261105_politique-
// confidentialite.md`. Même format que les CGU (`cgu-v1.ts`) : segments
// {texte, gras}, jamais de HTML.
//
// Modifier ce texte = mettre à jour `POLITIQUE_CONFIDENTIALITE_MISE_A_JOUR`.

import type { BlocCgu, SectionCgu } from './cgu-v1';

export const POLITIQUE_CONFIDENTIALITE_MISE_A_JOUR = '5 novembre 2026';

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

export const POLITIQUE_CONFIDENTIALITE_SECTIONS: SectionCgu[] = [
  {
    titre: 'Qui sommes-nous',
    blocs: [
      p(
        'La plateforme Savr (app.gosavr.io) est éditée par SAVR, société par actions simplifiée, 50 rue des Moines, 75017 Paris, immatriculée au RCS de Paris sous le numéro 879 642 890.',
      ),
      p(
        "Savr est responsable des traitements liés aux comptes, à la sécurité de la plateforme et à la relation avec ses clients. Pour les données que ses clients lui confient afin de réaliser les collectes, Savr agit pour leur compte, en tant que sous-traitant (article 24 des Conditions Générales d'Utilisation).",
      ),
    ],
  },
  {
    titre: 'Données traitées et durées de conservation',
    blocs: [
      li(
        'Compte utilisateur',
        "nom, prénom, adresse email, téléphone, fonction et mot de passe (conservé sous une forme qui ne permet pas de le retrouver). Ces données servent à créer et sécuriser l'accès à la plateforme (exécution du contrat). Elles sont conservées pendant la durée du compte ; après sa fermeture, elles sont anonymisées sur simple demande.",
      ),
      li(
        'Organisation et facturation',
        'raison sociale, numéros SIRET et de TVA, adresse et contact de facturation, pour gérer la relation commerciale et établir les factures (exécution du contrat, obligation légale). Les pièces comptables sont conservées 10 ans.',
      ),
      li(
        'Événements et collectes',
        'dates, lieux, nombre de convives, pesées, photos de collecte et documents produits (bordereaux, rapports de don, registre des déchets), pour réaliser les collectes et fournir les justificatifs réglementaires (exécution du contrat, obligation légale). Ils sont conservés pendant les durées légales applicables, de 5 à 10 ans.',
      ),
      li(
        'Contacts sur place',
        "nom, téléphone, adresse email et fonction de la personne à joindre lors de la collecte, pour l'organiser avec le transporteur (exécution du contrat). Ils sont gardés dans le carnet de contacts de votre organisation, pour vous être proposés lors des prochaines programmations, et avec la fiche de l'événement. Vous pouvez en demander l'effacement à tout moment.",
      ),
      li(
        'Chauffeurs',
        "nom et téléphone du chauffeur et immatriculation du véhicule, reçus du transporteur et communiqués au client pour l'accès au lieu de collecte (exécution du contrat). Ils sont conservés avec la fiche de la collecte.",
      ),
      li(
        'Associations bénéficiaires',
        "nom et téléphone de la personne qui réceptionne les dons, transmis au transporteur pour la livraison (exécution du contrat). Ils sont conservés avec la fiche de l'association.",
      ),
      li(
        'Journaux',
        "les actions sensibles sont inscrites dans un journal conservé 5 ans, pour la sécurité et la preuve (intérêt légitime). Les échanges avec les transporteurs sont journalisés 2 ans. Les journaux techniques de nos hébergeurs (connexions, erreurs) sont conservés pour une durée limitée, fixée par chacun d'eux.",
      ),
      p(
        "Savr n'utilise pas ces données à des fins publicitaires et ne les vend pas.",
      ),
    ],
  },
  {
    titre: 'Destinataires',
    blocs: [
      li("L'équipe Savr", 'dans la limite de ses missions.'),
      li(
        'Les transporteurs',
        "adresse et créneau de la collecte, contact sur place et, pour un don, contact de l'association bénéficiaire.",
      ),
      li(
        'Les associations bénéficiaires',
        'date, heure et volume estimé de la collecte.',
      ),
      li(
        'Le gestionnaire du lieu',
        "pour les collectes réalisées sur son lieu (article 15 des Conditions Générales d'Utilisation).",
      ),
      li(
        'Nos prestataires techniques',
        'hébergement (Vercel, Supabase, Cloudflare, Railway), envoi des emails (Resend), suivi des erreurs (Sentry), alertes internes (Slack) et facturation (Pennylane). Ils ne traitent les données que pour nous fournir leur service.',
      ),
      li(
        'Les services publics de vérification',
        'INSEE et VIES pour les numéros SIRET et de TVA, Base Adresse Nationale (IGN) pour les adresses saisies.',
      ),
      p(
        "La base de données est hébergée à Paris. Certains prestataires, ou leurs propres sous-traitants, peuvent traiter des données hors de l'Union européenne, notamment aux États-Unis ; ces transferts reposent sur les garanties prévues par le RGPD (clauses contractuelles types de la Commission européenne ou Data Privacy Framework).",
      ),
    ],
  },
  {
    titre: 'Cookies',
    blocs: [
      p(
        "La plateforme dépose uniquement les cookies nécessaires à la connexion et au maintien de votre session. Aucun cookie de mesure d'audience ni de publicité n'est utilisé.",
      ),
    ],
  },
  {
    titre: 'Sécurité',
    blocs: [
      p(
        'Les données sont protégées par des comptes nominatifs, un cloisonnement strict entre clients, le chiffrement des échanges et du stockage, et des sauvegardes quotidiennes.',
      ),
    ],
  },
  {
    titre: 'Vos droits',
    blocs: [
      p(
        "Vous pouvez demander l'accès à vos données, leur rectification, leur effacement ou leur portabilité, la limitation de leur traitement, ou vous y opposer, en écrivant à gestion@gosavr.io. Nous vous répondons dans un délai d'un mois. Les pièces comptables et les documents réglementaires ne peuvent pas être effacés avant la fin de leur durée légale de conservation.",
      ),
      p(
        "Lorsque Savr traite des données pour le compte d'un client, vous pouvez aussi adresser votre demande à ce client ; Savr l'aide à y répondre.",
      ),
      p(
        'Vous pouvez introduire une réclamation auprès de la CNIL (www.cnil.fr).',
      ),
    ],
  },
];
