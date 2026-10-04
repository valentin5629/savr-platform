// Attributions Anti-Gaspi lues par les chargeurs de dashboards, PAR RÔLE — §04
// « Vue SQL : v_attributions_gestionnaire », arbitrage Val 2026-09-22 (option A).
//  - gestionnaire_lieux : la vue. `aa_select` lui refuse la table dès que
//    l'événement vient d'un traiteur tiers (C-1, jamais élargie) ;
//  - traiteur_manager / traiteur_commercial / agence : la table. La garde de
//    rôle de la vue la rend VIDE pour eux — ne jamais les y repointer.
// Les deux chemins sortent sous la clé `attributions_antgaspi`. La vue porte
// l'association À PLAT (association_nom / association_ville) ; `attributionsAgOf`
// la ramène à la forme imbriquée de la table, seule forme lue par les agrégats.

export interface AssociationEmbed {
  id: string;
  nom: string;
  ville: string | null;
}

/** Forme de la table (embed `associations` imbriqué). */
export interface AttributionAgEmbed {
  volume_repas_realise: number | null;
  association_id: string | null;
  associations: AssociationEmbed | AssociationEmbed[] | null;
}

/** Forme de la vue `v_attributions_gestionnaire` (association à plat). */
interface AttributionAgVue {
  volume_repas_realise: number | null;
  association_id: string | null;
  association_nom: string | null;
  association_ville: string | null;
}

type AttributionLue = AttributionAgEmbed | AttributionAgVue;
/** Embed tel que PostgREST le rend : objet (to-one), tableau, ou rien. */
export type AttributionsAgLues = AttributionLue | AttributionLue[] | null;

const estGestionnaire = (role: string): boolean =>
  role === 'gestionnaire_lieux';

/** Fragment de `select` sous `collectes` : repas seuls. */
export function embedRepasAg(role: string): string {
  return estGestionnaire(role)
    ? 'attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise)'
    : 'attributions_antgaspi(volume_repas_realise)';
}

/** Fragment de `select` sous `collectes` : repas + association bénéficiaire. */
export function embedAttributionsAg(role: string): string {
  return estGestionnaire(role)
    ? `attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise,
         association_id, association_nom, association_ville)`
    : `attributions_antgaspi(volume_repas_realise, association_id,
         associations!association_id(id, nom, ville))`;
}

/** Attributions d'une collecte, en tableau et sous la forme de la table. */
export function attributionsAgOf(
  v: AttributionsAgLues | undefined,
): AttributionAgEmbed[] {
  const liste = Array.isArray(v) ? v : v ? [v] : [];
  return liste.map((a) =>
    'association_nom' in a
      ? {
          volume_repas_realise: a.volume_repas_realise,
          association_id: a.association_id,
          associations:
            a.association_id && a.association_nom != null
              ? {
                  id: a.association_id,
                  nom: a.association_nom,
                  ville: a.association_ville,
                }
              : null,
        }
      : a,
  );
}
