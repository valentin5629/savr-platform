import { NextResponse } from 'next/server';

// ─── Saisie de l'acceptation manuelle d'une mission A Toutes! ────────────────
//
// §06.06 §3 Bloc 0 (arbitrage Val 2026-09-16) : quand l'API du vélo-cargo est
// indisponible, Ops cale la course par téléphone et saisit :
//   · la RÉFÉRENCE DE MISSION communiquée par A Toutes! — obligatoire, écrite
//     dans `tournees.external_ref_commande` comme au dispatch normal ;
//   · le contact joint — obligatoire (la contrainte `created_manually` l’exige,
//     M14 §04 « texte libre obligatoire si created_manually ») ;
//   · l'heure d'appel et un commentaire — facultatifs.
//
// La référence n'a pas de format documenté côté A Toutes! (le client API la lit
// en `String(raw.mission_id ?? raw.id)`). On ne présume donc pas d'alphabet : on
// refuse seulement ce qui ne peut PAS être un identifiant — blancs internes,
// caractères de contrôle, demi-surrogate. Elle repart telle quelle comme
// `mission_id` dans l'appel d'annulation : une espace dictée au téléphone y
// produirait un 404 chez le transporteur, donc une annulation qui n'annule rien.
// 64 caractères : bien au-delà d'un identifiant de mission plausible, assez bas
// pour qu'une saisie collée par erreur (un paragraphe) soit refusée.

export const BORNES_ACCEPTATION_MANUELLE = {
  reference_mission: 64,
  contact_joint: 120,
  commentaire: 1000,
} as const;

/* eslint-disable no-control-regex -- désigner ces plages EST l'objet des gardes. */
const CONTROLE = /[\u0000-\u001F\u007F-\u009F]/;
const CONTROLE_HORS_BLANCS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
/* eslint-enable no-control-regex */
const SURROGATE_ORPHELIN = /\p{Surrogate}/u;
const BLANC = /\s/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface AcceptationManuelle {
  collecte_id: string;
  reference_mission: string;
  contact_joint: string;
  commentaire: string | null;
  heure_appel: string | null;
}

type Champ = keyof AcceptationManuelle;

const LIBELLES: Record<Champ, string> = {
  collecte_id: 'collecte inconnue',
  reference_mission: `référence de mission A Toutes! obligatoire (sans espace, ${BORNES_ACCEPTATION_MANUELLE.reference_mission} caractères max)`,
  contact_joint: `contact joint obligatoire (${BORNES_ACCEPTATION_MANUELLE.contact_joint} caractères max, une ligne)`,
  commentaire: `commentaire trop long (${BORNES_ACCEPTATION_MANUELLE.commentaire} caractères max)`,
  heure_appel: 'heure d’appel au format HH:MM',
};

/** Chaîne `trim()`ée, ou `undefined` si la valeur n'est pas une chaîne. */
function texte(v: unknown): string | undefined {
  return typeof v === 'string' ? v.trim() : undefined;
}

export function validerAcceptationManuelle(
  source: unknown,
): { valeurs: AcceptationManuelle } | { error: NextResponse } {
  const o =
    typeof source === 'object' && source !== null && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {};
  const invalides: Champ[] = [];

  const collecteId = texte(o['collecte_id']);
  if (!collecteId || !UUID.test(collecteId)) invalides.push('collecte_id');

  const reference = texte(o['reference_mission']);
  if (
    !reference ||
    reference.length > BORNES_ACCEPTATION_MANUELLE.reference_mission ||
    BLANC.test(reference) ||
    CONTROLE.test(reference) ||
    SURROGATE_ORPHELIN.test(reference)
  ) {
    invalides.push('reference_mission');
  }

  const contact = texte(o['contact_joint']);
  if (
    !contact ||
    contact.length > BORNES_ACCEPTATION_MANUELLE.contact_joint ||
    CONTROLE.test(contact) ||
    SURROGATE_ORPHELIN.test(contact)
  ) {
    invalides.push('contact_joint');
  }

  let commentaire: string | null = null;
  if (o['commentaire'] !== undefined && o['commentaire'] !== null) {
    const c = texte(o['commentaire']);
    if (
      c === undefined ||
      c.length > BORNES_ACCEPTATION_MANUELLE.commentaire ||
      CONTROLE_HORS_BLANCS.test(c) ||
      SURROGATE_ORPHELIN.test(c)
    ) {
      invalides.push('commentaire');
    } else {
      commentaire = c === '' ? null : c;
    }
  }

  let heureAppel: string | null = null;
  if (
    o['heure_appel'] !== undefined &&
    o['heure_appel'] !== null &&
    o['heure_appel'] !== ''
  ) {
    const h = texte(o['heure_appel']);
    if (h === undefined || !HEURE.test(h)) invalides.push('heure_appel');
    else heureAppel = h;
  }

  if (invalides.length > 0) {
    return {
      error: NextResponse.json(
        {
          error: `Saisie invalide : ${invalides.map((c) => LIBELLES[c]).join(' ; ')}.`,
          champs_invalides: invalides,
        },
        { status: 422 },
      ),
    };
  }

  return {
    valeurs: {
      collecte_id: collecteId!,
      reference_mission: reference!,
      contact_joint: contact!,
      commentaire,
      heure_appel: heureAppel,
    },
  };
}
