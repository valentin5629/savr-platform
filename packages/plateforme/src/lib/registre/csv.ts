import {
  toCsv,
  formatDateFr,
  formatNombreFr,
  type CsvColumn,
} from '@savr/shared/src/csv/index.js';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { FLUX_ORDER, FLUX_LABELS, type RegistreRow } from './registre.js';
import { erreurInterne } from '@/lib/api-helpers.js';

// ---------------------------------------------------------------------------
// Export CSV du registre réglementaire (§06.03 Exports). Grain FLUX : une ligne
// par flux pesé de chaque collecte (décision Val 2026-10-04, divergence
// M4.2_20261004). Les 20 premières colonnes suivent, dans l'ordre, le modèle de
// collecte de données que les gestionnaires de lieux tiennent pour leur propre
// registre (nature, code, producteur, date, tonnage, filière, code de
// traitement, n° de bordereau, puis transporteur / exutoire intermédiaire /
// exutoire final) ; 4 colonnes Savr suivent. Format canonique Savr garanti par
// @savr/shared/src/csv.
// ---------------------------------------------------------------------------

/** Référentiel d'un flux (plateforme.flux_dechets), tel que l'export le lit. */
interface FluxReferentiel {
  nom: string | null;
  code_dechet_europeen: string | null;
  filiere_valorisation: string | null;
  code_traitement: string | null;
  exutoire: string | null;
  exutoire_adresse: string | null;
}

interface FluxPese {
  code: string;
  poidsKg: number;
  ref: FluxReferentiel;
}
// collecte_id → flux pesés de la collecte
type FluxByCollecte = Map<string, FluxPese[]>;

// Les pesées se lisent par tranches de collectes : une réponse est plafonnée à
// 1000 lignes, sans erreur. Mesuré sur savr-dev le 2026-10-04 : 345 collectes
// demandées en une fois → 1000 pesées reçues sur 1725. 100 collectes × 5 flux
// restent sous le plafond, et l'URL (un UUID = 37 caractères) reste courte.
const TRANCHE_COLLECTES = 100;

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

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const cid = row.collecte_id as string;
      const fd = (
        Array.isArray(row.flux_dechets) ? row.flux_dechets[0] : row.flux_dechets
      ) as ({ code?: string } & Partial<FluxReferentiel>) | null;
      const code = fd?.code;
      if (!code) continue;
      const pesees = out.get(cid) ?? [];
      const poidsKg = Number(row.poids_reel_kg ?? 0);
      const dejaVu = pesees.find((p) => p.code === code);
      if (dejaVu) {
        dejaVu.poidsKg += poidsKg;
      } else {
        pesees.push({
          code,
          poidsKg,
          ref: {
            nom: fd.nom ?? null,
            code_dechet_europeen: fd.code_dechet_europeen ?? null,
            filiere_valorisation: fd.filiere_valorisation ?? null,
            code_traitement: fd.code_traitement ?? null,
            exutoire: fd.exutoire ?? null,
            exutoire_adresse: fd.exutoire_adresse ?? null,
          },
        });
      }
      out.set(cid, pesees);
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
  adresse: string | null,
): Omit<Etablissement, 'nom'> {
  const m = /^(.*?),?\s*(\d{5})\s+(\D+)$/.exec((adresse ?? '').trim());
  if (!m) return { voie: (adresse ?? '').trim(), codePostal: '', ville: '' };
  const [, voie = '', codePostal = '', ville = ''] = m;
  return { voie: voie.trim(), codePostal, ville: ville.trim() };
}

function exutoireFinal(l: LigneFlux): Etablissement {
  return {
    nom: l.flux.ref.exutoire ?? '',
    ...decouperAdresse(l.flux.ref.exutoire_adresse),
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

// Filière en clair. Le modèle des gestionnaires attend une classification à
// lettres (« C - Valorisation énergétique ») dont la liste n'est pas connue au
// 2026-10-04 : le libellé de la filière la remplace d'ici là.
const FILIERE_LABELS: Record<string, string> = {
  recyclage: 'Recyclage',
  compostage: 'Compostage',
  methanisation: 'Méthanisation',
  valorisation_energetique: 'Valorisation énergétique',
  enfouissement: 'Enfouissement',
  don_alimentaire: 'Don alimentaire',
};

const COLUMNS: CsvColumn<LigneFlux>[] = [
  {
    header: 'Nature du déchet',
    value: (l) => FLUX_LABELS[l.flux.code] ?? l.flux.ref.nom ?? l.flux.code,
  },
  {
    header: 'Code nomenclature déchets',
    value: (l) => l.flux.ref.code_dechet_europeen ?? '',
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
  {
    header: 'Filière de traitement finale',
    value: (l) => {
      const f = l.flux.ref.filiere_valorisation ?? '';
      return FILIERE_LABELS[f] ?? f;
    },
  },
  {
    header: 'Code D&R de traitement finale',
    value: (l) => l.flux.ref.code_traitement ?? '',
  },
  // Pas de BSD pour ces déchets : le bordereau Savr en tient lieu.
  { header: 'Numéro de BSD', value: (l) => l.row.bordereau_numero ?? '' },
  ...colonnesEtablissement('Transporteur', () => TRANSPORTEUR),
  ...colonnesEtablissement(
    'Exutoire intermédiaire',
    () => EXUTOIRE_INTERMEDIAIRE,
  ),
  ...colonnesEtablissement('Exutoire final', exutoireFinal),
  // Colonnes Savr, hors modèle.
  { header: 'Lieu', value: (l) => l.row.lieu_nom ?? '' },
  { header: 'Traiteur', value: (l) => l.row.traiteur_raison_sociale ?? '' },
  {
    header: 'Date événement',
    value: (l) => formatDateFr(l.row.date_evenement),
  },
  { header: 'N° bordereau', value: (l) => l.row.bordereau_numero ?? '' },
];

function rangFlux(code: string): number {
  const i = (FLUX_ORDER as readonly string[]).indexOf(code);
  return i === -1 ? FLUX_ORDER.length : i;
}

/**
 * Sérialise le registre filtré en CSV canonique Savr, une ligne par flux pesé.
 * Un flux sans poids (0 ou non pesé) n'a pas de ligne : rien n'a été expédié.
 * `nbLignes` = lignes de données du fichier (exports_registre.nb_lignes).
 */
export function buildRegistreCsv(
  rows: RegistreRow[],
  fluxByCollecte: FluxByCollecte,
): { csv: string; nbLignes: number } {
  const lignes: LigneFlux[] = rows.flatMap((row) =>
    (fluxByCollecte.get(row.collecte_id) ?? [])
      .filter((flux) => flux.poidsKg > 0)
      .sort((a, b) => rangFlux(a.code) - rangFlux(b.code))
      .map((flux) => ({ row, flux })),
  );
  return { csv: toCsv(lignes, COLUMNS), nbLignes: lignes.length };
}
