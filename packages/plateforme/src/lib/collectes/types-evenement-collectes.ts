// Type d'événement affiché au niveau d'un ÉVÉNEMENT (fiche Événement du
// gestionnaire, colonne « Type d'événement » de l'export Événements) : les types
// de SES COLLECTES (décision Val du 2026-10-24, lot C1, Q2 « Types de ses
// collectes »). Chaque collecte porte son type depuis la refonte du formulaire ;
// `evenements.type_evenement_id` n'en est que la copie de la collecte n°1.
//
// Ordre : celui de la collecte n°1 (`fn_evenement_suit_collecte_n1`, décision Val
// B1-Q2 du 2026-10-23) — collectes non annulées, Zéro-Déchet avant Anti-Gaspi,
// puis date, heure et création. Le premier type nommé est donc toujours celui que
// l'événement recopie. Sans doublon. Un événement dont toutes les collectes sont
// annulées nomme les types de ses collectes annulées ; sans aucun type lisible,
// le repli (la copie de l'événement) est rendu.

type Libelle = { libelle?: string | null };

export interface CollecteTypee {
  id: string;
  type: string;
  statut: string;
  date_collecte?: string | null;
  heure_collecte?: string | null;
  created_at?: string | null;
  type_evenement?: Libelle | Libelle[] | null;
}

function libelleDe(c: CollecteTypee): string | null {
  const t = Array.isArray(c.type_evenement)
    ? c.type_evenement[0]
    : c.type_evenement;
  const l = t?.libelle?.trim();
  return l ? l : null;
}

// NULLS LAST, comme l'ORDER BY de la collecte n°1.
function comparer(a: string | null | undefined, b: string | null | undefined) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

function ordreCollecteN1(a: CollecteTypee, b: CollecteTypee): number {
  const zd =
    Number(b.type === 'zero_dechet') - Number(a.type === 'zero_dechet');
  return (
    zd ||
    comparer(a.date_collecte, b.date_collecte) ||
    comparer(a.heure_collecte, b.heure_collecte) ||
    comparer(a.created_at, b.created_at) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Libellés des types d'événement des collectes, séparés par « , », dans l'ordre
 * de la collecte n°1 ; `repli` quand aucune collecte ne porte de type lisible.
 */
export function typesEvenementDesCollectes(
  collectes: readonly CollecteTypee[],
  repli: string | null,
): string | null {
  const actives = collectes.filter((c) => c.statut !== 'annulee');
  const retenues = actives.length > 0 ? actives : [...collectes];
  const libelles: string[] = [];
  for (const c of [...retenues].sort(ordreCollecteN1)) {
    const l = libelleDe(c);
    if (l && !libelles.includes(l)) libelles.push(l);
  }
  return libelles.length > 0 ? libelles.join(', ') : repli;
}
