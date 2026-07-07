// Cascade de résolution du logo client dans les rapports PDF (§12 §1.2, BL-P2-19).
//
// Priorité (l.86-90 override branding + l.47-50 logique standard) :
//   1. Programmateur de type `agence` → logo agence (organisations.logo_url du
//      programmateur) PRIME — l'agence partage le rapport avec son client final.
//   2. Client organisateur (compte Savr) → organisations.logo_url de l'org
//      référencée par evenements.client_organisateur_organisation_id.
//   3. Client organisateur (upload traiteur) → evenements.logo_client_organisateur_url.
//   4. Traiteur opérationnel → organisations.logo_url de l'org opératrice
//      (l.88 : « sinon logo traiteur opérationnel »).
//   5. Sinon → aucun logo client (en-tête Savr seul, fallback du template).
//
// Exclusion (l.90) : PAS d'override branding pour un programmateur `gestionnaire_lieux`
// (usage interne, pas de partage client final) — traité de fait par le test de type
// `agence` de l'étape 1 (un gestionnaire ne déclenche jamais l'override).

export interface OrgLogo {
  type?: string | null;
  logo_url?: string | null;
}

export interface LogoCascadeInput {
  /** Organisation programmatrice (evenements.organisation_id). */
  programmateur: OrgLogo | null;
  /** Organisation client organisateur (evenements.client_organisateur_organisation_id). */
  client_organisateur: OrgLogo | null;
  /** Logo uploadé par le traiteur à la programmation (evenements.logo_client_organisateur_url). */
  evenement_logo_client_url?: string | null;
  /** Organisation opératrice (traiteur_operationnel, sinon programmatrice). */
  traiteur_operationnel: OrgLogo | null;
}

export type LogoSource =
  | 'agence'
  | 'client_organisateur_compte'
  | 'client_organisateur_upload'
  | 'traiteur_operationnel'
  | 'savr';

export interface ResolvedLogo {
  /** URL du logo gagnant de la cascade — undefined = en-tête Savr seul. */
  logo_url?: string;
  source: LogoSource;
}

const nonVide = (s: string | null | undefined): s is string =>
  typeof s === 'string' && s.trim().length > 0;

/** Résout le logo client d'un rapport selon la cascade §12 §1.2. Fonction pure. */
export function resolveRapportLogo(input: LogoCascadeInput): ResolvedLogo {
  // 1. Agence programmatrice prime (si elle a un logo). Sinon, on retombe sur le standard.
  if (
    input.programmateur?.type === 'agence' &&
    nonVide(input.programmateur.logo_url)
  ) {
    return { logo_url: input.programmateur.logo_url, source: 'agence' };
  }

  // 2. Client organisateur — compte Savr (logo de son organisation).
  if (nonVide(input.client_organisateur?.logo_url)) {
    return {
      logo_url: input.client_organisateur!.logo_url as string,
      source: 'client_organisateur_compte',
    };
  }

  // 3. Client organisateur — logo uploadé par le traiteur à la programmation.
  if (nonVide(input.evenement_logo_client_url)) {
    return {
      logo_url: input.evenement_logo_client_url,
      source: 'client_organisateur_upload',
    };
  }

  // 4. Traiteur opérationnel.
  if (nonVide(input.traiteur_operationnel?.logo_url)) {
    return {
      logo_url: input.traiteur_operationnel!.logo_url as string,
      source: 'traiteur_operationnel',
    };
  }

  // 5. Aucun logo client → en-tête Savr seul.
  return { source: 'savr' };
}
