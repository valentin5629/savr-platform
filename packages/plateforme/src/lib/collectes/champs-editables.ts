// Champs métier qu'un rôle programmateur (traiteur, agence, gestionnaire de
// lieux) peut modifier depuis la fiche collecte (§06.04 §Édition, §05 l.307).
// Source unique des routes PATCH et de l'email à l'équipe Savr, qui doit avoir
// une ligne pour chacun (cf. email-modification).

// Collecte. Le type, le lieu et l'organisation sont verrouillés (§05 l.314) ;
// `notes_internes` n'en fait pas partie : commentaire Admin Savr « non visible
// par le client » (§04 Data Model, arbitrage Val C1 2026-09-29).
export const CHAMPS_COLLECTE_EDITABLES = [
  'date_collecte',
  'heure_collecte',
  'controle_acces_requis',
  'informations_supplementaires',
];

// Événement parent. Le lieu se change en annulant puis en reprogrammant ;
// organisation, traiteur opérationnel et entité de facturation sont immuables
// par construction, donc jamais exposés.
export const CHAMPS_EVENEMENT_EDITABLES = [
  'nom_evenement',
  'pax',
  'type_evenement_id',
  'contact_principal_nom',
  'contact_principal_telephone',
  'contact_secours_nom',
  'contact_secours_telephone',
  'nom_client_organisateur',
  'logo_client_organisateur_url',
  'reference_affaire',
];
