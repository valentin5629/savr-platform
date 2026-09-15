// Référentiel transporteurs servi aux mocks Supabase des adapters.
//
// POURQUOI UN RÉFÉRENTIEL COMPLET
// Les lectures cloisonnées par provider (`findTournee`, `findTournees`,
// `updateLieu`) ne peuvent pas déduire le provider d'une tournée de son
// `external_ref_commande` — cette colonne est PARTAGÉE (l'adapter MTS-1 y stocke
// un customerOrderId, l'adapter Everest un id de mission). Elles le résolvent
// donc via `transporteurs.type_tms`.
//
// Un mock qui servirait une liste DÉJÀ filtrée ne prouverait que « l'adapter
// consulte un Set » — jamais que ce Set est le bon. Celui-ci sert le référentiel
// COMPLET (deux MTS-1, un Everest, un manuel) et applique lui-même les `.eq()`
// reçus, comme le ferait PostgREST : retirer le `.eq('type_tms', …)` du code de
// production fait alors rougir les tests.

export const PRESTA_MTS1 = 'presta-uuid-001';
export const PRESTA_MTS1_BIS = 'presta-uuid-marathon';
export const PRESTA_EVEREST = 'presta-uuid-a-toutes';
export const PRESTA_MANUEL = 'presta-uuid-par-mail';

export const REFERENTIEL_TRANSPORTEURS: ReadonlyArray<
  Record<string, string | null>
> = [
  { type_tms: 'mts1', prestataire_logistique_id: PRESTA_MTS1 },
  { type_tms: 'mts1', prestataire_logistique_id: PRESTA_MTS1_BIS },
  { type_tms: 'a_toutes', prestataire_logistique_id: PRESTA_EVEREST },
  { type_tms: 'par_mail', prestataire_logistique_id: PRESTA_MANUEL },
];

/**
 * Builder Supabase thenable pour `from('transporteurs')`.
 *
 * À router depuis le `from` du mock de chaque test :
 *   from: vi.fn((t) => (t === 'transporteurs' ? builderTransporteurs() : q)),
 *
 * `supplementaires` ajoute les transporteurs propres au fichier de test (chacun
 * a ses propres UUID de prestataire) SANS retirer les lignes non-MTS-1 du
 * référentiel de base : c'est leur présence qui donne au test son pouvoir de
 * réfutation.
 */
export function builderTransporteurs(
  supplementaires: ReadonlyArray<Record<string, string | null>> = [],
): Record<string, unknown> {
  const eqs: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  const referentiel = [...supplementaires, ...REFERENTIEL_TRANSPORTEURS];

  Object.assign(builder, {
    select: () => builder,
    eq: (colonne: string, valeur: unknown) => {
      eqs.push([colonne, valeur]);
      return builder;
    },
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: referentiel.filter((ligne) =>
          eqs.every(([colonne, valeur]) => ligne[colonne] === valeur),
        ),
        error: null,
      }),
  });

  return builder;
}
