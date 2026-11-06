// Nom du fichier d'un « Rapport de don », tel que le navigateur le propose à
// l'enregistrement. Le document d'une collecte AG porte ce nom jusque dans son
// fichier (§12 §1.3-bis, décision Val 2026-10-13) :
//
//  · avec excédents (attestation de don) → rapport-de-don-ATT-DON-2026-00001.pdf
//  · sans excédent (pas de numéro)       → rapport-de-don-2026-10-09-gala-fondation.pdf
//
// Le fichier stocké garde sa clé : le nom est posé à la signature de l'URL
// (`getPresignedUrl`), aucun document déjà produit n'est renommé ni déplacé.

import { logger } from '@savr/shared/src/logger/index.js';
import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';

const PREFIXE = 'rapport-de-don';
const LONGUEUR_MAX_EVENEMENT = 60;

/** Réduit un texte libre à des minuscules ASCII séparées par des tirets. */
function enSegment(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Rapport de don d'une collecte AG avec excédents : l'attestation, par son numéro. */
export function nomFichierAttestation(
  numero: string | null | undefined,
): string {
  const segment = (numero ?? '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return [PREFIXE, segment].filter(Boolean).join('-') + '.pdf';
}

/** Rapport de don d'une collecte AG sans excédent : date et nom de l'événement. */
export function nomFichierSansExcedent(
  evenement:
    | { date_evenement?: string | null; nom_evenement?: string | null }
    | null
    | undefined,
): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(evenement?.date_evenement ?? '')?.[0];
  const nom = enSegment(evenement?.nom_evenement ?? '')
    .slice(0, LONGUEUR_MAX_EVENEMENT)
    .replace(/-+$/, '');
  return [PREFIXE, date, nom].filter(Boolean).join('-') + '.pdf';
}

type EvenementJoint = {
  date_evenement?: string | null;
  nom_evenement?: string | null;
};

/**
 * Nom du fichier du rapport (`rapports_rse`) d'une collecte : seul celui d'une
 * collecte AG sans excédent est un « Rapport de don ». Le rapport de recyclage
 * d'une collecte ZD garde le nom de son fichier stocké (`undefined`).
 *
 * La collecte est lue avec le client reçu : sous la RLS de l'utilisateur pour un
 * espace client. Une lecture en échec rend `undefined` : nommer le fichier ne
 * doit jamais priver du téléchargement. L'échec est journalisé (code seul) : un
 * droit de lecture retiré un jour ne doit pas éteindre le nommage sans bruit.
 */
export async function nomFichierDuRapportDeLaCollecte(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<string | undefined> {
  try {
    const { data, error } = await supabase
      .from('collectes')
      .select('type, statut, evenements(nom_evenement, date_evenement)')
      .eq('id', collecteId)
      .maybeSingle();
    if (error) {
      logger.warn('rapport_de_don.nom_fichier_illisible', {
        code: error.code ?? null,
      });
      return undefined;
    }
    if (!data) return undefined;
    const collecte = data as {
      type: string;
      statut: string;
      evenements?: EvenementJoint | EvenementJoint[] | null;
    };
    if (
      collecte.type !== 'anti_gaspi' ||
      collecte.statut !== 'realisee_sans_collecte'
    ) {
      return undefined;
    }
    const evenement = Array.isArray(collecte.evenements)
      ? collecte.evenements[0]
      : collecte.evenements;
    return nomFichierSansExcedent(evenement);
  } catch {
    logger.warn('rapport_de_don.nom_fichier_illisible', { code: 'exception' });
    return undefined;
  }
}
