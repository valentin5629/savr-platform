'use client';

import type * as React from 'react';
import { Combobox } from '@/components/ui/combobox';
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
  lieuId: string;
  client: string;
  infoIncomplete: '' | 'oui' | 'non';
  programmeePar: string[];
}

export const FILTRES_COLLECTE_VIDES: CollecteFiltres = {
  statuts: [],
  from: '',
  to: '',
  lieuId: '',
  client: '',
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
    a.lieuId === b.lieuId &&
    a.client === b.client &&
    a.infoIncomplete === b.infoIncomplete &&
    memeListe(a.programmeePar, b.programmeePar)
  );
}

export function filtresCollecteActifs(f: CollecteFiltres): boolean {
  return (
    f.statuts.length > 0 ||
    f.from !== '' ||
    f.to !== '' ||
    f.lieuId !== '' ||
    f.client !== '' ||
    f.infoIncomplete !== '' ||
    f.programmeePar.length > 0
  );
}

/**
 * Filtres ⇄ query-string de la page. Clés partagées avec le drill-down des
 * dashboards (`statut`, `from`, `to`, `lieu`) : arriver depuis une Top liste
 * pré-remplit donc la barre, et un filtre posé survit au rechargement.
 */
const CLES_URL = {
  statuts: 'statut',
  from: 'from',
  to: 'to',
  lieuId: 'lieu',
  client: 'client',
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
    lieuId: params.get(CLES_URL.lieuId) ?? '',
    client: params.get(CLES_URL.client) ?? '',
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
  poser(CLES_URL.lieuId, f.lieuId);
  poser(CLES_URL.client, f.client);
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
 * Barre de filtres de la liste Collectes traiteur — §06.04 §3 « Filtres
 * disponibles » (BL-P2-14, volet filtres) : Statut (multi) · Période · Lieu ·
 * Client Organisateur · « Info incomplète » oui/non · « Programmée par » (multi).
 * Le filtre Type est porté par le sélecteur ZD/AG de l'en-tête.
 *
 * Mise en page = pattern DS `FilterBar` : un FormField + un Combobox (ou le
 * DateRangePicker de la période) par filtre, grille de 3 colonnes.
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

      <DateRangePicker
        titre="Période"
        id="filtre-periode"
        data-testid="filtre-periode"
        value={{ from: value.from, to: value.to }}
        onChange={(p) => onChange({ ...value, from: p.from, to: p.to })}
      />

      <Combobox
        titre="Lieu"
        id="filtre-lieu"
        data-testid="filtre-lieu"
        searchPlaceholder="Rechercher un lieu…"
        options={[
          { value: '', label: 'Tous les lieux' },
          ...options.lieux.map((l) => ({ value: l.id, label: l.nom })),
        ]}
        value={value.lieuId}
        onChange={(v) => set('lieuId', v)}
      />

      <Combobox
        titre="Client organisateur"
        id="filtre-client"
        data-testid="filtre-client"
        searchPlaceholder="Rechercher un client…"
        options={[
          { value: '', label: 'Tous les clients' },
          ...options.clients.map((c) => ({ value: c, label: c })),
        ]}
        value={value.client}
        onChange={(v) => set('client', v)}
      />

      <Combobox
        titre="Info incomplète"
        id="filtre-info-incomplete"
        data-testid="filtre-info-incomplete"
        placeholder="Toutes"
        options={[
          { value: '', label: 'Toutes' },
          { value: 'oui', label: 'Oui' },
          { value: 'non', label: 'Non' },
        ]}
        value={value.infoIncomplete}
        onChange={(v) => set('infoIncomplete', v as '' | 'oui' | 'non')}
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
