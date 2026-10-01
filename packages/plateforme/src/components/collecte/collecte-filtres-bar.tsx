'use client';

import type * as React from 'react';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches } from '@/components/ui/filtre-en-ligne';
import { groupesStatutClient } from '@/lib/statut-collecte-labels';

/** Organisation ayant programmé l'événement (§06.04 filtre « Programmée par »). */
export interface ProgrammateurOption {
  id: string;
  nom: string;
  /** `organisation_type` DB ; null pour l'organisation de l'appelant. */
  type: string | null;
}

export interface CollecteFiltresOptions {
  lieux: { id: string; nom: string }[];
  /** Noms de clients organisateurs (evenements.nom_client_organisateur). */
  clients: string[];
  programmateurs: ProgrammateurOption[];
}

export interface CollecteFiltres {
  /** Statuts DB sélectionnés ; vide = tous ceux de l'onglet courant. */
  statuts: string[];
  from: string;
  to: string;
  /** Lieux cochés ; vide = tous. */
  lieuIds: string[];
  /** Noms de clients organisateurs cochés ; vide = tous. */
  clients: string[];
  /** Filtre à deux valeurs : '' = toutes (aucune ou les deux cases cochées). */
  infoIncomplete: '' | 'oui' | 'non';
  programmeePar: string[];
}

export const FILTRES_COLLECTE_VIDES: CollecteFiltres = {
  statuts: [],
  from: '',
  to: '',
  lieuIds: [],
  clients: [],
  infoIncomplete: '',
  programmeePar: [],
};

/**
 * Égalité structurelle de deux jeux de filtres — sert à ne PAS remplacer l'état
 * quand la graine issue du drill-down est identique à l'état courant (sinon chaque
 * montage produit un nouvel objet → re-render → re-fetch inutile).
 */
export function memeFiltresCollecte(
  a: CollecteFiltres,
  b: CollecteFiltres,
): boolean {
  const memeListe = (x: string[], y: string[]): boolean =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    memeListe(a.statuts, b.statuts) &&
    a.from === b.from &&
    a.to === b.to &&
    memeListe(a.lieuIds, b.lieuIds) &&
    memeListe(a.clients, b.clients) &&
    a.infoIncomplete === b.infoIncomplete &&
    memeListe(a.programmeePar, b.programmeePar)
  );
}

export function filtresCollecteActifs(f: CollecteFiltres): boolean {
  return (
    f.statuts.length > 0 ||
    f.from !== '' ||
    f.to !== '' ||
    f.lieuIds.length > 0 ||
    f.clients.length > 0 ||
    f.infoIncomplete !== '' ||
    f.programmeePar.length > 0
  );
}

/**
 * Filtres ⇄ query-string de la page. Clés partagées avec le drill-down des
 * dashboards (`statut`, `from`, `to`, `lieu`) : arriver depuis une Top liste
 * pré-remplit donc la barre, et un filtre posé survit au rechargement.
 * Listes en CSV (`statut`, `lieu`, `par`), sauf `client`, RÉPÉTÉ : ce sont des
 * noms saisis à la main, une virgule y est possible. Un ancien lien à valeur
 * unique (`?lieu=<id>`, `?client=<nom>`) se lit comme une liste d'un élément.
 */
const CLES_URL = {
  statuts: 'statut',
  from: 'from',
  to: 'to',
  lieuIds: 'lieu',
  clients: 'client',
  infoIncomplete: 'info',
  programmeePar: 'par',
} as const;

export function lireFiltresCollecte(params: URLSearchParams): CollecteFiltres {
  const liste = (k: string) => (params.get(k) ?? '').split(',').filter(Boolean);
  const info = params.get(CLES_URL.infoIncomplete);
  return {
    statuts: liste(CLES_URL.statuts),
    from: params.get(CLES_URL.from) ?? '',
    to: params.get(CLES_URL.to) ?? '',
    lieuIds: liste(CLES_URL.lieuIds),
    clients: params.getAll(CLES_URL.clients).filter(Boolean),
    infoIncomplete: info === 'oui' || info === 'non' ? info : '',
    programmeePar: liste(CLES_URL.programmeePar),
  };
}

/** Réécrit les clés de filtre de `params` (les autres clés sont conservées). */
export function ecrireFiltresCollecte(
  params: URLSearchParams,
  f: CollecteFiltres,
): URLSearchParams {
  const usp = new URLSearchParams(params);
  const poser = (k: string, v: string) => (v ? usp.set(k, v) : usp.delete(k));
  poser(CLES_URL.statuts, f.statuts.join(','));
  poser(CLES_URL.from, f.from);
  poser(CLES_URL.to, f.to);
  poser(CLES_URL.lieuIds, f.lieuIds.join(','));
  usp.delete(CLES_URL.clients);
  for (const c of f.clients) usp.append(CLES_URL.clients, c);
  poser(CLES_URL.infoIncomplete, f.infoIncomplete);
  poser(CLES_URL.programmeePar, f.programmeePar.join(','));
  return usp;
}

// Libellé CDC « Agence : X » / « Gestionnaire : X » ; l'organisation de l'appelant
// est déjà nommée « Mon organisation » par la route d'options (type null).
const PREFIXE_TYPE: Record<string, string> = {
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire',
  traiteur: 'Traiteur',
  client_organisateur: 'Client',
};

function libelleProgrammateur(p: ProgrammateurOption): string {
  const prefixe = p.type ? PREFIXE_TYPE[p.type] : null;
  return prefixe ? `${prefixe} : ${p.nom}` : p.nom;
}

interface Props {
  /** Statuts DB couverts par l'onglet actif (Programmées ou Historique). */
  statutsOnglet: readonly string[];
  options: CollecteFiltresOptions;
  value: CollecteFiltres;
  onChange: (f: CollecteFiltres) => void;
  /** Nombre de collectes affichées après filtrage (compteur sous la barre). */
  resultats: number;
  /** En-tête de la barre : onglets de vue (gauche) et filtre de type (droite). */
  tabs?: React.ReactNode;
  toggle?: React.ReactNode;
}

/**
 * Barre de filtres des listes Collectes traiteur et agence — §06.04 §3
 * « Filtres disponibles » (BL-P2-14, volet filtres) : Période · Statut · Lieu ·
 * Client Organisateur · « Info incomplète » oui/non · « Programmée par ».
 * Le filtre Type est porté par le sélecteur ZD/AG de l'en-tête.
 *
 * Mise en page = pattern DS `FilterBar` : filtres en ligne « Titre  valeur ▾ ».
 * Décisions Val 2026-09-30 : « Période » en premier (DateRangePicker `titre`),
 * puis des listes à cocher (`FiltreCoches`, case « Tous » = aucun filtre) —
 * plus aucun filtre à valeur unique.
 *
 * Le filtre Statut propose les LIBELLÉS de la vue client (mapping canonique
 * 2026-06-30) : l'utilisateur ne voit jamais « Programmée », et un libellé
 * sélectionné couvre tous les statuts DB qu'il regroupe.
 *
 * État porté par le parent (synchronisé dans l'URL par la page, cf.
 * `lireFiltresCollecte`) ; composant purement présentationnel, aucune écriture.
 */
export function CollecteFiltresBar({
  statutsOnglet,
  options,
  value,
  onChange,
  resultats,
  tabs,
  toggle,
}: Props): React.JSX.Element {
  const groupes = groupesStatutClient(statutsOnglet);
  const statutsSet = new Set(value.statuts);
  // Un groupe est coché quand TOUS ses statuts DB sont sélectionnés.
  const groupesSelectionnes = groupes
    .filter((g) => g.statuts.every((s) => statutsSet.has(s)))
    .map((g) => g.label);

  const set = <K extends keyof CollecteFiltres>(
    k: K,
    v: CollecteFiltres[K],
  ): void => onChange({ ...value, [k]: v });

  return (
    <FilterBar
      data-testid="collecte-filtres-bar"
      tabs={tabs}
      toggle={toggle}
      actif={filtresCollecteActifs(value)}
      onReset={() => onChange(FILTRES_COLLECTE_VIDES)}
      count={
        <span data-testid="collectes-resultats-count">
          {resultats} collecte{resultats > 1 ? 's' : ''} correspond
          {resultats > 1 ? 'ent' : ''} à votre sélection
        </span>
      }
    >
      <DateRangePicker
        titre="Période"
        id="filtre-periode"
        data-testid="filtre-periode"
        value={{ from: value.from, to: value.to }}
        onChange={(p) => onChange({ ...value, from: p.from, to: p.to })}
      />

      <FiltreCoches
        label="Statut"
        testid="filtre-statut"
        options={groupes.map((g) => ({ id: g.label, nom: g.label }))}
        selected={groupesSelectionnes}
        onChange={(labels) =>
          set(
            'statuts',
            groupes
              .filter((g) => labels.includes(g.label))
              .flatMap((g) => g.statuts),
          )
        }
      />

      <FiltreCoches
        label="Lieu"
        testid="filtre-lieu"
        options={options.lieux}
        selected={value.lieuIds}
        onChange={(ids) => set('lieuIds', ids)}
      />

      <FiltreCoches
        label="Client organisateur"
        testid="filtre-client"
        options={options.clients.map((c) => ({ id: c, nom: c }))}
        selected={value.clients}
        onChange={(noms) => set('clients', noms)}
      />

      <FiltreCoches
        label="Info incomplète"
        testid="filtre-info-incomplete"
        libelleVide="Toutes"
        libelleTous="Toutes"
        options={[
          { id: 'oui', nom: 'Oui' },
          { id: 'non', nom: 'Non' },
        ]}
        selected={value.infoIncomplete ? [value.infoIncomplete] : []}
        // Deux cases : une seule cochée filtre ; les deux cochées = « Toutes »,
        // que FiltreCoches rend déjà en sélection vide.
        onChange={([v]) =>
          set('infoIncomplete', v === 'oui' || v === 'non' ? v : '')
        }
      />

      {options.programmateurs.length > 1 && (
        <FiltreCoches
          label="Programmée par"
          testid="filtre-programmee-par"
          options={options.programmateurs.map((p) => ({
            id: p.id,
            nom: libelleProgrammateur(p),
          }))}
          selected={value.programmeePar}
          onChange={(ids) => set('programmeePar', ids)}
        />
      )}
    </FilterBar>
  );
}
