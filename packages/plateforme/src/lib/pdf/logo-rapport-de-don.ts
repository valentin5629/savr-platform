// Logo du client imprimé sur les deux « Rapport de don » d'une collecte AG
// (attestation de don et rapport « Événement sans excédent »). Décision Val
// 2026-10-30 : le logo du client figure sur les deux, et un logo déposé ou changé
// sur l'événement s'applique aussi aux rapports déjà fabriqués (régénération).
//
// Les logos se lisent sur l'événement (cascade §12 §1.2, lib/pdf/logo-cascade) :
// la même sélection sert au lot J+1 et à la régénération, pour qu'un rapport
// refait porte exactement le logo qu'un rapport neuf aurait.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  resolveRapportLogo,
  resolveRapportLogos,
  type LogoCascadeInput,
} from './logo-cascade.js';

/** Colonnes d'un `evenements` utiles à la cascade (à imbriquer dans un select). */
export const SELECT_LOGOS_EVENEMENT = `
  logo_client_organisateur_url,
  organisations!organisation_id ( type, logo_url ),
  traiteur_operationnel:organisations!traiteur_operationnel_organisation_id ( logo_url ),
  client_organisateur:organisations!client_organisateur_organisation_id ( logo_url )
`;

type OrgLogoRow = { type?: string | null; logo_url: string | null } | null;

export interface LogosEvenementRow {
  logo_client_organisateur_url: string | null;
  organisations: OrgLogoRow;
  traiteur_operationnel: OrgLogoRow;
  client_organisateur: OrgLogoRow;
}

export function cascadeDepuisEvenement(
  ev: LogosEvenementRow,
): LogoCascadeInput {
  return {
    programmateur: ev.organisations,
    client_organisateur: ev.client_organisateur,
    evenement_logo_client_url: ev.logo_client_organisateur_url,
    // Opérationnel si désigné, sinon l'organisation programmatrice.
    traiteur_operationnel: ev.traiteur_operationnel ?? ev.organisations,
  };
}

/** Clé du logo de l'attestation : emplacement « client » seul, jamais le traiteur. */
export function cleLogoAttestation(ev: LogosEvenementRow): string | undefined {
  return resolveRapportLogos(cascadeDepuisEvenement(ev)).client;
}

/** Clé du logo du rapport « sans excédent » : cascade complète (traiteur en repli). */
export function cleLogoSansExcedent(ev: LogosEvenementRow): string | undefined {
  return resolveRapportLogo(cascadeDepuisEvenement(ev)).logo_url;
}

/** Lit les logos de l'événement d'une collecte. `null` : collecte ou événement introuvable. */
export async function lireLogosEvenementDeCollecte(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<LogosEvenementRow | null> {
  const { data, error } = await supabase
    .from('collectes')
    .select(`evenements ( ${SELECT_LOGOS_EVENEMENT} )`)
    .eq('id', collecteId)
    .maybeSingle();
  if (error) throw error;
  const ev = (data as { evenements: LogosEvenementRow | null } | null)
    ?.evenements;
  return ev ?? null;
}
