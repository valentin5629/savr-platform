'use client';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { MultiSelectFilter } from '@/components/dashboards/MultiSelectFilter';
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
}

/**
 * Barre de filtres de la liste Collectes traiteur — §06.04 §3 « Filtres
 * disponibles » (BL-P2-14, volet filtres) : Statut (multi) · Période · Lieu ·
 * Client Organisateur · « Info incomplète » oui/non · « Programmée par » (multi).
 * Le filtre Type est porté par le sélecteur ZD/AG (retiré du bloc 2026-05-07).
 *
 * Le filtre Statut propose les LIBELLÉS de la vue client (mapping canonique
 * 2026-06-30) : l'utilisateur ne voit jamais « Programmée », et un libellé
 * sélectionné couvre tous les statuts DB qu'il regroupe.
 *
 * État porté par le parent (pas de persistance query-string — descopée V1.1,
 * backlog l.401) ; composant purement présentationnel, aucune écriture.
 */
export function CollecteFiltresBar({
  statutsOnglet,
  options,
  value,
  onChange,
  resultats,
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
    <div data-testid="collecte-filtres-bar" className="space-y-2">
      <div className="flex flex-wrap items-end gap-3 rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-3">
        <div className="w-44">
          <MultiSelectFilter
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
        </div>

        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-savr-neutral-600">Du</span>
          <input
            type="date"
            aria-label="Période — du"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => set('from', e.target.value)}
            className="rounded-savr-md border border-savr-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-savr-neutral-600">au</span>
          <input
            type="date"
            aria-label="Période — au"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => set('to', e.target.value)}
            className="rounded-savr-md border border-savr-neutral-300 px-2 py-1 text-sm"
          />
        </label>

        <div className="w-48">
          <span className="mb-1.5 block text-xs font-semibold text-savr-neutral-600">
            Lieu
          </span>
          <Select
            aria-label="Lieu"
            value={value.lieuId}
            onChange={(e) => set('lieuId', e.target.value)}
          >
            <option value="">Tous les lieux</option>
            {options.lieux.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nom}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-48">
          <span className="mb-1.5 block text-xs font-semibold text-savr-neutral-600">
            Client organisateur
          </span>
          <Select
            aria-label="Client organisateur"
            value={value.client}
            onChange={(e) => set('client', e.target.value)}
          >
            <option value="">Tous les clients</option>
            {options.clients.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-40">
          <span className="mb-1.5 block text-xs font-semibold text-savr-neutral-600">
            Info incomplète
          </span>
          <Select
            aria-label="Info incomplète"
            value={value.infoIncomplete}
            onChange={(e) =>
              set('infoIncomplete', e.target.value as '' | 'oui' | 'non')
            }
          >
            <option value="">Toutes</option>
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </Select>
        </div>

        {options.programmateurs.length > 1 && (
          <div className="w-52">
            <MultiSelectFilter
              label="Programmée par"
              testid="filtre-programmee-par"
              options={options.programmateurs.map((p) => ({
                id: p.id,
                nom: libelleProgrammateur(p),
              }))}
              selected={value.programmeePar}
              onChange={(ids) => set('programmeePar', ids)}
            />
          </div>
        )}

        {filtresCollecteActifs(value) && (
          <Button
            variant="ghost"
            onClick={() => onChange(FILTRES_COLLECTE_VIDES)}
            data-testid="filtres-reinitialiser"
          >
            Réinitialiser
          </Button>
        )}
      </div>

      <p
        data-testid="collectes-resultats-count"
        className="text-sm text-savr-neutral-500"
      >
        {resultats} collecte{resultats > 1 ? 's' : ''} correspond
        {resultats > 1 ? 'ent' : ''} à votre sélection
      </p>
    </div>
  );
}
