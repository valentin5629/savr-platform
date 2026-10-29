// Options de la barre de filtres de la liste Événements, commune à tous les
// rôles (cf. liste-evenements.ts). Une seule forme de réponse ; ce qui remplit
// chaque liste dépend de l'espace :
//  - gestionnaire : `loadFiltresParcGestionnaire`, la source de son dashboard et
//    de sa liste Collectes (décision Val 2026-10-06 : mêmes listes partout) ;
//  - staff : référentiels complets (lieux, traiteurs, organisations clientes) ;
//  - traiteur, agence, client organisateur : lieux et traiteurs DÉRIVÉS des
//    événements que l'appelant voit déjà (requête sous sa session, RLS
//    `evt_*_select`), les noms de traiteurs par `v_referentiel_traiteurs`.
//    Le traiteur n'a pas de liste de traiteurs : c'est toujours lui.

import { logger } from '@savr/shared/src/logger/index.js';
import {
  loadFiltresParcGestionnaire,
  type DbClient,
} from '@/lib/dashboards/loaders';
import { un, type UnOuListe } from '@/lib/evenements-gestionnaire';
import type { EspaceEvenements } from '@/lib/evenements/liste-evenements';

export interface Option {
  id: string;
  nom: string;
}

export interface OptionsFiltresEvenements {
  lieux: Option[];
  traiteurs: Option[];
  /** Organisations programmatrices : staff seul, vide ailleurs. */
  clients: Option[];
  types: { id: string; libelle: string }[];
}

/** Lecture en échec : levée, pour un 500 plutôt que des listes vides. */
export class OptionsIndisponibles extends Error {}

const parNom = (a: Option, b: Option) => a.nom.localeCompare(b.nom, 'fr');

function nomOrganisation(o: {
  nom: string | null;
  raison_sociale: string | null;
}): string | null {
  return o.nom?.trim() || o.raison_sociale?.trim() || null;
}

async function typesEvenements(supabase: DbClient) {
  const { data } = await supabase
    .from('types_evenements')
    .select('id, libelle')
    .eq('actif', true)
    .order('ordre_affichage', { ascending: true });
  return (data ?? []).map((t) => ({
    id: t.id as string,
    libelle: t.libelle as string,
  }));
}

async function optionsStaff(supabase: DbClient) {
  const [lieux, orgs] = await Promise.all([
    supabase.from('lieux').select('id, nom').order('nom'),
    supabase
      .from('organisations')
      .select('id, nom, raison_sociale, type')
      .in('type', ['traiteur', 'agence', 'gestionnaire_lieux']),
  ]);
  if (lieux.error || orgs.error) {
    logger.error('evenements.filtres.staff_echec', {
      code: lieux.error?.code ?? orgs.error?.code,
    });
    throw new OptionsIndisponibles();
  }
  const organisations = (
    (orgs.data ?? []) as {
      id: string;
      nom: string | null;
      raison_sociale: string | null;
      type: string;
    }[]
  ).flatMap((o) => {
    const nom = nomOrganisation(o);
    return nom ? [{ id: o.id, nom, type: o.type }] : [];
  });
  return {
    lieux: ((lieux.data ?? []) as { id: string; nom: string | null }[])
      .filter((l) => l.nom)
      .map((l) => ({ id: l.id, nom: l.nom! })),
    traiteurs: organisations
      .filter((o) => o.type === 'traiteur')
      .map(({ id, nom }) => ({ id, nom }))
      .sort(parNom),
    clients: organisations.map(({ id, nom }) => ({ id, nom })).sort(parNom),
  };
}

async function optionsDerivees(supabase: DbClient, avecTraiteurs: boolean) {
  // `max_rows` tronque au-delà du millier : par date décroissante, la
  // troncature garde les événements les plus récents.
  const { data, error } = await supabase
    .from('evenements')
    .select('traiteur_operationnel_organisation_id, lieux!lieu_id(id, nom)')
    .not('date_evenement', 'is', null)
    .order('date_evenement', { ascending: false });
  if (error) {
    logger.error('evenements.filtres.derivees_echec', { code: error.code });
    throw new OptionsIndisponibles();
  }
  const evts = (data ?? []) as unknown as {
    traiteur_operationnel_organisation_id: string | null;
    lieux: UnOuListe<{ id: string; nom: string | null }>;
  }[];
  const lieux = new Map<string, string>();
  const traiteurIds = new Set<string>();
  for (const e of evts) {
    const l = un(e.lieux);
    if (l?.nom) lieux.set(l.id, l.nom);
    if (e.traiteur_operationnel_organisation_id)
      traiteurIds.add(e.traiteur_operationnel_organisation_id);
  }
  let traiteurs: Option[] = [];
  if (avecTraiteurs && traiteurIds.size > 0) {
    const { data: refs, error: echec } = await supabase
      .from('v_referentiel_traiteurs')
      .select('id, nom')
      .in('id', [...traiteurIds]);
    if (echec) {
      logger.error('evenements.filtres.traiteurs_echec', { code: echec.code });
      throw new OptionsIndisponibles();
    }
    traiteurs = ((refs ?? []) as { id: string; nom: string | null }[])
      .filter((t) => t.nom)
      .map((t) => ({ id: t.id, nom: t.nom! }))
      .sort(parNom);
  }
  return {
    lieux: [...lieux].map(([id, nom]) => ({ id, nom })).sort(parNom),
    traiteurs,
    clients: [],
  };
}

export async function optionsFiltresEvenements(
  supabase: DbClient,
  espace: EspaceEvenements,
): Promise<OptionsFiltresEvenements> {
  if (espace === 'gestionnaire') {
    // Lecture en échec : `LoaderError`, levée par le loader (déjà journalisée).
    const parc = await loadFiltresParcGestionnaire(supabase);
    if (parc.sansLieu)
      return { lieux: [], traiteurs: [], clients: [], types: [] };
    return {
      lieux: parc.lieux,
      traiteurs: parc.traiteurs,
      clients: [],
      types: await typesEvenements(supabase),
    };
  }
  const [listes, types] = await Promise.all([
    espace === 'admin'
      ? optionsStaff(supabase)
      : optionsDerivees(supabase, espace !== 'traiteur'),
    typesEvenements(supabase),
  ]);
  return { ...listes, types };
}
