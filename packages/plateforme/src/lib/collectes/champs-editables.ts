// Champs métier qu'un rôle programmateur (traiteur, agence, gestionnaire de
// lieux) peut modifier depuis la fiche collecte (§06.04 §Édition, §05 l.307).
// Source unique des routes PATCH et de l'email à l'équipe Savr, qui doit avoir
// une ligne pour chacun (cf. email-modification).

// Collecte. Le type, le lieu et l'organisation sont verrouillés (§05 l.314) ;
// `notes_internes` n'en fait pas partie : commentaire Admin Savr « non visible
// par le client » (§04 Data Model, arbitrage Val C1 2026-09-29).
// `pax` : le nombre de convives est porté par la collecte depuis la décision
// Val du 2026-10-20 (le pax de l'événement en est calculé en base).
// Type d'événement et contacts : portés par la collecte depuis le lot B1
// (décision Val 2026-10-23, B1-Q1) ; l'événement garde la copie de sa collecte
// n°1, tenue par la base.
export const CHAMPS_TYPE_CONTACTS_COLLECTE: readonly string[] = [
  'type_evenement_id',
  'contact_principal_nom',
  'contact_principal_telephone',
  'contact_secours_nom',
  'contact_secours_telephone',
];

export const CHAMPS_COLLECTE_EDITABLES: readonly string[] = [
  'date_collecte',
  'heure_collecte',
  'pax',
  'controle_acces_requis',
  'informations_supplementaires',
  ...CHAMPS_TYPE_CONTACTS_COLLECTE,
];

// Refusés explicitement (422) plutôt qu'ignorés : pour changer le lieu ou le
// type, on annule la collecte et on en programme une nouvelle.
export const CHAMPS_COLLECTE_VERROUILLES: readonly string[] = [
  'type',
  'type_collecte',
  'lieu_id',
  'organisation_id',
];

// Événement parent. Le lieu se change en annulant puis en reprogrammant ;
// organisation, traiteur opérationnel et entité de facturation sont immuables
// par construction, donc jamais exposés. Le pax, le type d'événement et les
// contacts n'en font plus partie : ils se modifient sur chaque collecte
// (CHAMPS_TYPE_CONTACTS_COLLECTE), et l'événement en garde une copie calculée.
export const CHAMPS_EVENEMENT_EDITABLES: readonly string[] = [
  'nom_evenement',
  'nom_client_organisateur',
  'logo_client_organisateur_url',
  'reference_affaire',
];
