import { modificationUrgente } from '@/lib/collectes/urgence-modification';
import { paxSaisiValide } from '@/lib/programmation/cartes-saisie';

// Règles de saisie d'une collecte modifiée par un client, communes au formulaire
// de la fiche collecte et à l'édition sur place de la carte de la fiche
// événement (décision Val 2026-11-05) : contrôles avant envoi, champs envoyés
// au PATCH de l'espace, avertissements de la confirmation (§06.04 l.501-507).

/** Valeurs de la collecte avant modification. */
export interface CollecteAvant {
  statut_tms?: string;
  date_collecte: string;
  heure_collecte: string | null;
  pax: number;
  controle_acces_requis: boolean;
  informations_supplementaires: string | null;
  type_evenement_id: string | null;
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
}

/** Saisie en cours, telle que la tiennent les champs (texte, heure « HH:MM »). */
export interface SaisieCollecte {
  dateCollecte: string;
  heureCollecte: string;
  pax: string;
  typeEvtId: string;
  cpNom: string;
  cpTel: string;
  csNom: string;
  csTel: string;
  controleAcces: boolean;
  infosSuppl: string;
}

export function saisieInitiale(c: CollecteAvant): SaisieCollecte {
  return {
    dateCollecte: c.date_collecte,
    heureCollecte: c.heure_collecte?.slice(0, 5) ?? '',
    pax: String(c.pax),
    typeEvtId: c.type_evenement_id ?? '',
    cpNom: c.contact_principal_nom ?? '',
    cpTel: c.contact_principal_telephone ?? '',
    csNom: c.contact_secours_nom ?? '',
    csTel: c.contact_secours_telephone ?? '',
    controleAcces: c.controle_acces_requis,
    infosSuppl: c.informations_supplementaires ?? '',
  };
}

/**
 * Refus avant envoi, mêmes règles que la route ; chaque champ n'est contrôlé
 * que s'il a été modifié (une collecte ancienne incomplète reste modifiable
 * pour le reste).
 */
export function erreurSaisieCollecte(
  c: CollecteAvant,
  s: SaisieCollecte,
): string | null {
  // Pax : entier de 1 à 100 000 (une reprise Bubble à pax 0 reste modifiable).
  if (s.pax !== String(c.pax) && !paxSaisiValide(s.pax))
    return 'Nombre de convives : saisissez un nombre entier de 1 à 100 000.';
  const cpModifie =
    s.cpNom !== (c.contact_principal_nom ?? '') ||
    s.cpTel !== (c.contact_principal_telephone ?? '');
  if (cpModifie && (s.cpNom.trim() === '' || s.cpTel.trim() === ''))
    return 'Le contact principal et son téléphone sont obligatoires.';
  // Contact de secours obligatoire aussi (décision Val 2026-10-30).
  const csModifie =
    s.csNom !== (c.contact_secours_nom ?? '') ||
    s.csTel !== (c.contact_secours_telephone ?? '');
  if (csModifie && (s.csNom.trim() === '' || s.csTel.trim() === ''))
    return 'Le contact de secours et son téléphone sont obligatoires.';
  return null;
}

/** Champs modifiés, au format du PATCH collecte des espaces clients. */
export function changementsCollecte(
  c: CollecteAvant,
  s: SaisieCollecte,
): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (s.typeEvtId && s.typeEvtId !== (c.type_evenement_id ?? ''))
    u.type_evenement_id = s.typeEvtId;
  if (s.cpNom !== (c.contact_principal_nom ?? ''))
    u.contact_principal_nom = s.cpNom;
  if (s.cpTel !== (c.contact_principal_telephone ?? ''))
    u.contact_principal_telephone = s.cpTel;
  // Nom et téléphone de secours partent ensemble (la route l'exige).
  if (
    s.csNom !== (c.contact_secours_nom ?? '') ||
    s.csTel !== (c.contact_secours_telephone ?? '')
  ) {
    u.contact_secours_nom = s.csNom;
    u.contact_secours_telephone = s.csTel;
  }
  if (s.dateCollecte !== c.date_collecte) u.date_collecte = s.dateCollecte;
  if (s.heureCollecte !== (c.heure_collecte?.slice(0, 5) ?? ''))
    u.heure_collecte = s.heureCollecte ? `${s.heureCollecte}:00` : null;
  if (s.pax !== String(c.pax)) u.pax = Number.parseInt(s.pax, 10);
  if (s.controleAcces !== c.controle_acces_requis)
    u.controle_acces_requis = s.controleAcces;
  if (s.infosSuppl !== (c.informations_supplementaires ?? ''))
    u.informations_supplementaires = s.infosSuppl || null;
  return u;
}

/**
 * Avertissements de la confirmation : urgence (ancien OU nouveau créneau à
 * moins de 12 h, §05 l.316) et reconfirmation du prestataire (créneau changé
 * sur une collecte acceptée, §06.04 l.505).
 */
export function avertissementsCollecte(
  c: CollecteAvant,
  s: SaisieCollecte,
): { urgence: boolean; reacceptation: boolean } {
  const urgence = modificationUrgente(
    { date: c.date_collecte, heure: c.heure_collecte },
    {
      date: s.dateCollecte,
      heure: s.heureCollecte ? `${s.heureCollecte}:00` : null,
    },
  );
  const creneauModifie =
    s.dateCollecte !== c.date_collecte ||
    s.heureCollecte !== (c.heure_collecte?.slice(0, 5) ?? '');
  return {
    urgence,
    reacceptation: creneauModifie && c.statut_tms === 'acceptee',
  };
}
