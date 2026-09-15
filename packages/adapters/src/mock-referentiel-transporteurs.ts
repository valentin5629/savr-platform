// Support de test — référentiel `plateforme.transporteurs` mocké.
//
// Test-only, comme `mts1/mock.ts` : aucun code de production ne l'importe.
//
// Les adapters résolvent le provider d'une tournée en lisant
// `transporteurs.type_tms` (cf. provider-tournees.ts). Tout mock du client
// Supabase qui exerce E1/E2/E3/E5 doit donc répondre à `from('transporteurs')`.
//
// Deux exigences, apprises en revue de #313 :
//   1. servir le référentiel COMPLET (MTS-1 et non-MTS-1 mélangés) et appliquer
//      soi-même les `.eq()` reçus — un mock qui sert une liste DÉJÀ filtrée ne
//      prouve que « la boucle consulte un Set », jamais que ce Set est le bon :
//      supprimer le `.eq('type_tms', …)` du code laisserait la CI verte ;
//   2. ne jamais partager un builder unique entre toutes les tables — sinon
//      `from('transporteurs')` répond le lot de collectes, les lignes ne portent
//      pas `prestataire_logistique_id`, et le filtre dégénère en no-op.

/** Prestataires du référentiel de test (`shared.prestataires.id`). */
export const PRESTA_MTS1 = 'presta-strike-uuid';
export const PRESTA_MTS1_BIS = 'presta-marathon-uuid';
export const PRESTA_EVEREST = 'presta-atoutes-uuid';
export const PRESTA_MANUEL = 'presta-par-mail-uuid';

/** Référentiel complet — volontairement hétérogène (cf. exigence 1 ci-dessus). */
export const REFERENTIEL_TRANSPORTEURS: ReadonlyArray<{
  prestataire_logistique_id: string;
  type_tms: string;
}> = [
  { prestataire_logistique_id: PRESTA_MTS1, type_tms: 'mts1' },
  { prestataire_logistique_id: PRESTA_MTS1_BIS, type_tms: 'mts1' },
  { prestataire_logistique_id: PRESTA_EVEREST, type_tms: 'a_toutes' },
  { prestataire_logistique_id: PRESTA_MANUEL, type_tms: 'par_mail' },
];

/**
 * Builder thenable pour `from('transporteurs')` : accumule les `.eq()` et les
 * applique réellement aux lignes du référentiel à la résolution.
 */
export function builderTransporteurs(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  const egalites: Array<[string, unknown]> = [];
  Object.assign(builder, {
    select: chain,
    eq: (col: string, val: unknown) => {
      egalites.push([col, val]);
      return builder;
    },
    in: chain,
    gte: chain,
    not: chain,
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: REFERENTIEL_TRANSPORTEURS.filter((r) =>
          egalites.every(
            ([col, val]) => (r as Record<string, unknown>)[col] === val,
          ),
        ),
        error: null,
      }),
  });
  return builder;
}
