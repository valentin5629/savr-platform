// Cloisonnement par provider des tournées d'une collecte — commun MTS-1 / Everest.
//
// `tournees.external_ref_commande` ne dit PAS quel provider a dispatché la
// tournée : l'adapter Everest y stocke son id de mission exactement comme
// l'adapter MTS-1 y stocke son customerOrderId (#313). La seule marque de
// provider portée par une tournée est `prestataire_logistique_id`, et c'est
// `transporteurs.type_tms` qui tranche — même résolution que le worker
// (`fetchTransporteur`).
//
// Le filtre est appliqué À LA SOURCE (findTournee / findTournees des deux
// adapters) et non dans chaque handler : E1 dispatch, E2 update, E3 cancel et
// E5 lieu lisent tous les tournées par là. #313 n'avait fermé que E5.
//
// Toujours filtrer sur le TYPE, jamais sur `this.transporteur` : le worker
// instancie l'adapter avec « n'importe quel » transporteur du type (`.limit(1)`),
// donc discriminer sur le prestataire injecté rendrait Marathon muet dès qu'il
// tire Strike.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { TypeTms } from './index.js';
import { LogistiqueTransientError } from './index.js';

/** Colonnes minimales qu'une ligne de tournée doit porter pour être cloisonnée. */
export interface TourneeProvider {
  id: string;
  rang: number;
  statut: string;
  external_ref_commande: string | null;
  prestataire_logistique_id: string | null;
}

// Statuts `plateforme.tournee_statut` sous lesquels une commande peut encore
// être vivante chez le provider (les deux autres, 'terminee'/'annulee', sont
// terminaux : plus rien à annuler ni à corriger chez l'autre provider).
const STATUTS_TOURNEE_VIVANTE = new Set(['planifiee', 'en_cours']);

const LIBELLE_PROVIDER: Record<TypeTms, string> = {
  mts1: 'MTS-1',
  a_toutes: 'A Toutes! (Everest)',
  autre: 'hors TMS',
  par_mail: 'hors TMS (mail)',
  par_telephone: 'hors TMS (téléphone)',
};

/**
 * Prestataires logistiques joignables par un type de TMS
 * (`transporteurs.type_tms`).
 *
 * Sur erreur, `data` est null → Set vide → aucune tournée retenue, et l'event
 * serait marqué `done` par le worker : fail-closed sur la fuite, mais
 * fail-SILENT sur la propagation (rien n'est parti, personne ne le sait). On
 * lève donc en Transient pour rendre la main aux 3 paliers de retry.
 */
export async function prestatairesDuType(
  supabase: SupabaseClient,
  typeTms: TypeTms,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('transporteurs')
    .select('prestataire_logistique_id')
    .eq('type_tms', typeTms);

  if (error) {
    throw new LogistiqueTransientError(
      `Référentiel transporteurs ${typeTms} illisible — ${error.message}`,
    );
  }

  const rows = (data ?? []) as Array<{
    prestataire_logistique_id: string | null;
  }>;
  // `typeof === 'string'` et pas `!= null` : une colonne absente du `select`
  // (ou une ligne partielle) remonte `undefined`. Laisser `undefined` entrer
  // dans le Set le rendrait vrai pour toute tournée dont le prestataire est lui
  // aussi `undefined` — le filtre dégénérerait en « tout passe » (#313).
  return new Set(
    rows
      .map((t) => t.prestataire_logistique_id)
      .filter((id): id is string => typeof id === 'string' && id !== ''),
  );
}

/**
 * Ne retient que les tournées exécutées par le provider courant.
 *
 * Arbitrage « ignorer vs alerter » (tracé ici, demandé par la revue de #313) :
 * une tournée résiduelle d'un AUTRE provider (refus Everest puis re-dispatch
 * MTS-1, ou l'inverse) est toujours ÉCARTÉE — jamais d'appel croisé — mais
 * elle n'est ignorée en silence que si plus rien ne peut être vivant chez
 * l'autre provider. Si elle porte une référence de commande ET un statut non
 * terminal, une commande peut encore courir là-bas (un camion ou un vélo qui
 * se présente sur une collecte annulée, ou qui n'a pas reçu la modification) :
 * alerte Ops in-app, dédupliquée par `f_upsert_alerte_admin` sur
 * (code, collecte, statut='ouverte'). Canal in-app et non Slack : anomalie
 * fonctionnelle (CLAUDE.md §13 — seules les alertes techniques vont sur Slack).
 */
export async function retenirTourneesDuProvider<
  T extends TourneeProvider,
>(opts: {
  supabase: SupabaseClient;
  typeTms: TypeTms;
  prestataires: Set<string>;
  collecteId: string;
  tournees: T[];
}): Promise<T[]> {
  const { supabase, typeTms, prestataires, collecteId, tournees } = opts;

  const duProvider = tournees.filter(
    (t) =>
      typeof t.prestataire_logistique_id === 'string' &&
      prestataires.has(t.prestataire_logistique_id),
  );

  const residuellesVivantes = tournees.filter(
    (t) =>
      !duProvider.includes(t) &&
      typeof t.external_ref_commande === 'string' &&
      t.external_ref_commande !== '' &&
      STATUTS_TOURNEE_VIVANTE.has(t.statut),
  );

  if (residuellesVivantes.length > 0) {
    await alerterTourneeAutreProvider(
      supabase,
      typeTms,
      collecteId,
      residuellesVivantes,
    );
  }

  return duProvider;
}

async function alerterTourneeAutreProvider(
  supabase: SupabaseClient,
  typeTms: TypeTms,
  collecteId: string,
  residuelles: TourneeProvider[],
): Promise<void> {
  const rangs = residuelles.map((t) => t.rang).join(', ');
  await supabase
    .rpc('f_upsert_alerte_admin', {
      p_code: 'tournee_autre_provider',
      p_titre: 'Tournée résiduelle chez un autre transporteur',
      p_message:
        `La collecte ${collecteId} est dispatchée chez ${LIBELLE_PROVIDER[typeTms]}, ` +
        `mais ${residuelles.length} tournée(s) non terminée(s) d'un autre transporteur y sont rattachées ` +
        `(rang ${rangs}). Elles ne sont ni modifiées ni annulées par ${LIBELLE_PROVIDER[typeTms]} : ` +
        `vérifier auprès de l'autre transporteur que la commande correspondante est bien close.`,
      p_entity_type: 'collectes',
      p_entity_id: collecteId,
    })
    // Une alerte perdue ne doit pas faire échouer l'event (le worker rejouerait
    // un dispatch/annulation déjà propagé). Même tolérance qu'ailleurs dans le
    // repo (route organisations/shadow).
    .then(
      () => undefined,
      () => undefined,
    );
}
