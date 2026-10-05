import {
  toCsv,
  formatDateFr,
  formatNombreFr,
  type CsvColumn,
} from '@savr/shared/src/csv/index.js';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  FLUX_ORDER,
  FLUX_LABELS,
  FILIERE_LABELS,
  bordereauDisponible,
  type RegistreRow,
} from './registre.js';
import { erreurInterne } from '@/lib/api-helpers.js';

// ---------------------------------------------------------------------------
// Export CSV du registre réglementaire (§06.03 Exports). Grain FLUX : une ligne
// par flux pesé de chaque collecte (décision Val 2026-10-04, divergence
// M4.2_20261004). Les 20 premières colonnes suivent, dans l'ordre, le modèle de
// collecte de données que les gestionnaires de lieux tiennent pour leur propre
// registre (nature, code, producteur, date, tonnage, filière, code de
// traitement, n° de bordereau, puis transporteur / exutoire intermédiaire /
// exutoire final) ; 2 colonnes Savr suivent (traiteur, date de l'événement). Format canonique Savr garanti par
// @savr/shared/src/csv.
// ---------------------------------------------------------------------------

/** Pesée d'un flux, avec les champs de plateforme.flux_dechets lus par l'export. */
interface FluxPese {
  code: string;
  poidsKg: number;
  nom?: string | null;
  code_dechet_europeen?: string | null;
  filiere_valorisation?: string | null;
  code_traitement?: string | null;
  exutoire?: string | null;
  exutoire_adresse?: string | null;
}
// collecte_id → flux pesés de la collecte
type FluxByCollecte = Map<string, FluxPese[]>;

// Les pesées se lisent par tranches de collectes : PostgREST plafonne une
// réponse à 1000 lignes (max_rows), sans erreur. Une collecte a au plus une
// pesée par flux (uniq_collecte_flux) et il existe 5 flux : 100 collectes
// donnent au plus 500 lignes, pour une URL d'environ 4 000 caractères.
const TRANCHE_COLLECTES = 100;
const PLAFOND_LIGNES_REPONSE = 1000;

/**
 * Charge les pesées par flux des collectes données, avec le référentiel du flux
 * (RLS-safe : collecte_flux est filtré par f_collecte_visible, comme la vue
 * registre).
 */
export async function fetchFluxDetail(
  supabase: SupabaseClient,
  collecteIds: string[],
): Promise<FluxByCollecte> {
  const out: FluxByCollecte = new Map();

  for (let i = 0; i < collecteIds.length; i += TRANCHE_COLLECTES) {
    const { data, error } = await supabase
      .from('collecte_flux')
      .select(
        'collecte_id, poids_reel_kg, flux_dechets!flux_id(code, nom, code_dechet_europeen, filiere_valorisation, code_traitement, exutoire, exutoire_adresse)',
      )
      .in('collecte_id', collecteIds.slice(i, i + TRANCHE_COLLECTES));
    if (error) throw erreurInterne(error, 'registre.csv');
    const pesees = (data ?? []) as Record<string, unknown>[];
    // Une tranche au plafond serait une réponse amputée : plutôt une erreur
    // qu'un registre incomplet.
    if (pesees.length >= PLAFOND_LIGNES_REPONSE) {
      throw erreurInterne(
        new Error('pesées : tranche au plafond de lignes'),
        'registre.csv',
      );
    }

    for (const row of pesees) {
      const cid = row.collecte_id as string;
      const fd = (
        Array.isArray(row.flux_dechets) ? row.flux_dechets[0] : row.flux_dechets
      ) as Partial<FluxPese> | null;
      if (!fd?.code) continue;
      const fluxCollecte = out.get(cid) ?? [];
      fluxCollecte.push({
        ...fd,
        code: fd.code,
        poidsKg: Number(row.poids_reel_kg ?? 0),
      });
      out.set(cid, fluxCollecte);
    }
  }
  return out;
}

interface LigneFlux {
  row: RegistreRow;
  flux: FluxPese;
}

interface Etablissement {
  nom: string;
  voie: string;
  codePostal: string;
  ville: string;
}

// Chaîne logistique ZD (décisions Val 2026-10-04) : Savr enlève sur le lieu,
// massifie à son entrepôt, puis le site de traitement du flux reçoit le déchet.
// Le transporteur affiché est Savr à l'adresse de l'entrepôt — choix provisoire
// (« pour l'instant »), la question du nom du prestataire attend le juriste.
const ENTREPOT_SAVR = {
  voie: '3 rue du Fort de la Briche',
  codePostal: '93200',
  ville: 'Saint-Denis',
} as const;
const TRANSPORTEUR: Etablissement = { nom: 'Savr', ...ENTREPOT_SAVR };
const EXUTOIRE_INTERMEDIAIRE: Etablissement = {
  nom: 'Entrepôt Savr',
  ...ENTREPOT_SAVR,
};

/**
 * Découpe une adresse « voie, code postal ville » (format de
 * flux_dechets.exutoire_adresse). Format non reconnu → tout dans la voie,
 * plutôt qu'un code postal deviné.
 */
export function decouperAdresse(
  adresse: string | null | undefined,
): Omit<Etablissement, 'nom'> {
  const m = /^(.*?),?\s*(\d{5})\s+(\D+)$/.exec((adresse ?? '').trim());
  if (!m) return { voie: (adresse ?? '').trim(), codePostal: '', ville: '' };
  const [, voie = '', codePostal = '', ville = ''] = m;
  return { voie: voie.trim(), codePostal, ville: ville.trim() };
}

function exutoireFinal(l: LigneFlux): Etablissement {
  return {
    nom: l.flux.exutoire ?? '',
    ...decouperAdresse(l.flux.exutoire_adresse),
  };
}

/** Les 4 colonnes d'un établissement, préfixées (le modèle a trois « Nom »). */
function colonnesEtablissement(
  prefixe: string,
  de: (l: LigneFlux) => Etablissement,
): CsvColumn<LigneFlux>[] {
  return [
    { header: `${prefixe} - Nom`, value: (l) => de(l).nom },
    { header: `${prefixe} - Adresse`, value: (l) => de(l).voie },
    { header: `${prefixe} - Code postal`, value: (l) => de(l).codePostal },
    { header: `${prefixe} - Ville`, value: (l) => de(l).ville },
  ];
}

// N° du bordereau ÉMIS seulement : un brouillon porte déjà un numéro, mais
// l'écran le dit « manquant » tant qu'il n'est pas émis.
function numeroBordereau(row: RegistreRow): string {
  return bordereauDisponible(row.bordereau_statut)
    ? (row.bordereau_numero ?? '')
    : '';
}

const COLUMNS: CsvColumn<LigneFlux>[] = [
  {
    header: 'Nature du déchet',
    value: (l) => FLUX_LABELS[l.flux.code] ?? l.flux.nom ?? l.flux.code,
  },
  {
    header: 'Code nomenclature déchets',
    value: (l) => l.flux.code_dechet_europeen ?? '',
  },
  // Producteur au sens du modèle = le site où le déchet est produit.
  {
    header: 'Identité du producteur de déchet',
    value: (l) => l.row.lieu_nom ?? '',
  },
  {
    header: "Date d'expédition",
    value: (l) => formatDateFr(l.row.date_collecte),
  },
  // Tonnes, sans perte : une pesée au gramme près garde ses 6 décimales.
  {
    header: 'Quantité (tonnage)',
    value: (l) => formatNombreFr(l.flux.poidsKg / 1000, 6),
  },
  // Le modèle attend une classification à lettres (« C - Valorisation
  // énergétique ») dont la liste n'est pas connue au 2026-10-04 : le libellé de
  // la filière la remplace d'ici là.
  {
    header: 'Filière de traitement finale',
    value: (l) => {
      const f = l.flux.filiere_valorisation ?? '';
      return FILIERE_LABELS[f] ?? f;
    },
  },
  {
    header: 'Code D&R de traitement finale',
    value: (l) => l.flux.code_traitement ?? '',
  },
  // Pas de BSD pour ces déchets : le bordereau Savr en tient lieu.
  { header: 'Numéro de BSD', value: (l) => numeroBordereau(l.row) },
  ...colonnesEtablissement('Transporteur', () => TRANSPORTEUR),
  ...colonnesEtablissement(
    'Exutoire intermédiaire',
    () => EXUTOIRE_INTERMEDIAIRE,
  ),
  ...colonnesEtablissement('Exutoire final', exutoireFinal),
  // Colonnes Savr, hors modèle. Le lieu et le n° de bordereau n'y figurent pas :
  // ils sont déjà dans « Identité du producteur » et « Numéro de BSD ».
  { header: 'Traiteur', value: (l) => l.row.traiteur_raison_sociale ?? '' },
  {
    header: 'Date événement',
    value: (l) => formatDateFr(l.row.date_evenement),
  },
];

const rangFlux = (code: string): number =>
  (FLUX_ORDER as readonly string[]).indexOf(code);

/**
 * Sérialise le registre filtré en CSV canonique Savr, une ligne par flux pesé.
 * Un flux sans poids (0 ou non pesé) n'a pas de ligne : rien n'a été expédié.
 * Filtre Flux actif (`fluxFiltres`) : seules les lignes de ces flux sortent — la
 * liste, au grain collecte, garde les collectes qui en contiennent ; au grain
 * flux, « les lignes filtrées » sont celles de ces flux.
 * `nbLignes` = lignes de données du fichier (exports_registre.nb_lignes).
 */
export function buildRegistreCsv(
  rows: RegistreRow[],
  fluxByCollecte: FluxByCollecte,
  fluxFiltres: string[],
): { csv: string; nbLignes: number } {
  const lignes: LigneFlux[] = rows.flatMap((row) =>
    (fluxByCollecte.get(row.collecte_id) ?? [])
      .filter(
        (flux) =>
          flux.poidsKg > 0 &&
          (fluxFiltres.length === 0 || fluxFiltres.includes(flux.code)),
      )
      .sort((a, b) => rangFlux(a.code) - rangFlux(b.code))
      .map((flux) => ({ row, flux })),
  );
  return { csv: toCsv(lignes, COLUMNS), nbLignes: lignes.length };
}
