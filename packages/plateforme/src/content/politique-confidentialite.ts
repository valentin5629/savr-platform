// Texte de la politique de confidentialité, publiée sur /confidentialite.
//
// Exigée avant le go-live par le CDC (§15 Sécurité et conformité, 3.4) : page
// lisible sans connexion, liée depuis l'application et les emails. Données,
// bases légales et durées : tableau §15 3.2, aligné sur l'article 24 des CGU.
// Même format que les CGU (`cgu-v1.ts`) : segments {texte, gras}, jamais de HTML.
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
        "nom, prénom, adresse email, téléphone, fonction et mot de passe (conservé sous une forme qui ne permet pas de le retrouver). Ces données servent à créer et sécuriser l'accès à la plateforme (exécution du contrat). Elles sont conservées pendant la durée du compte, puis 3 ans.",
      ),
      li(
        'Organisation et facturation',
        'raison sociale, numéros SIRET et de TVA, adresse et contact de facturation, pour établir les factures (obligation légale). Les pièces comptables sont conservées 10 ans.',
      ),
      li(
        'Événements et collectes',
        'dates, lieux, nombre de convives, pesées, photos de collecte et documents produits (bordereaux, rapports de don, registre des déchets), pour réaliser les collectes et fournir les justificatifs réglementaires (exécution du contrat, obligation légale). Ils sont conservés pendant les durées légales applicables, de 5 à 10 ans.',
      ),
      li(
        'Contacts sur place',
        "nom et téléphone de la personne présente lors de la collecte, transmis au transporteur pour la réaliser (exécution du contrat). Ils sont conservés un an après l'événement.",
      ),
      li(
        'Journaux',
        'les actions sensibles sont inscrites dans un journal conservé 5 ans, pour la sécurité et la preuve (intérêt légitime). Les journaux techniques de connexion sont conservés peu de temps par nos hébergeurs.',
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
        'Les transporteurs et les associations bénéficiaires',
        'uniquement les informations nécessaires à la collecte : adresse, créneau, contact sur place.',
      ),
      li(
        'Le gestionnaire du lieu',
        "pour les collectes réalisées sur son lieu (article 15 des Conditions Générales d'Utilisation).",
      ),
      li(
        'Nos prestataires techniques',
        'hébergement (Vercel, Supabase, Cloudflare, Railway), envoi des emails (Resend), suivi des erreurs (Sentry), alertes internes (Slack) et facturation (Pennylane). Ils ne traitent les données que pour nous fournir leur service.',
      ),
      p(
        "La base de données est hébergée à Paris. Lorsqu'un prestataire, ou l'un de ses propres sous-traitants, traite des données hors de l'Union européenne, ce transfert est encadré par les garanties prévues par le RGPD (clauses contractuelles types de la Commission européenne ou Data Privacy Framework).",
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
