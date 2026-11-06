// Niveau événement d'une collecte ajoutée à un événement existant (§06.01
// « Ajouter une collecte à un événement existant ») : figé, lu sur
// l'événement, jamais choisi par le navigateur.

export type CollecteNiveauEvenement = {
  statut?: string | null;
  controle_acces_requis?: boolean | null;
};

// Le contrôle d'accès est saisi une fois pour l'événement puis copié sur
// chaque collecte (§06.01 2.c) ; il n'a pas de colonne sur `evenements`, et
// une modification peut le changer sur une seule collecte. Requis dès qu'une
// collecte de l'événement l'exige : la contrainte vient du site, pas de la
// collecte (§06.01 ; décision Val 2026-10-21).
export function controleAccesEvenement(
  collectes: readonly CollecteNiveauEvenement[] | null | undefined,
): boolean {
  return (collectes ?? []).some((c) => c.controle_acces_requis === true);
}

// Événement pas encore confirmé : au moins une de ses collectes est en
// brouillon. L'ajout y est refusé (décision Val 2026-10-21) : il créerait une
// collecte programmée, envoyée au transporteur pour une ZD, à côté d'un
// brouillon que l'utilisateur n'a pas confirmé (ou ne peut pas confirmer : le
// brouillon d'un collègue commercial).
export function evenementEnBrouillon(
  collectes: readonly CollecteNiveauEvenement[] | null | undefined,
): boolean {
  return (collectes ?? []).some((c) => c.statut === 'brouillon');
}
