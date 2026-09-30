import {
  anneeParis,
  decalerJour,
  jourParis,
} from '@savr/shared/src/temps/index.js';

// Raccourcis de période des filtres de date (décision Val 2026-09-30 : même
// liste sur tous les filtres, format « colonne de raccourcis + calendrier »).
// Liste CDC §06.04 l.73 / §06.05 l.105 (« Date range picker + raccourcis ») ;
// « 30 derniers jours » couvre aussi le preset du registre (§06.03 l.44).
//
// Jours PARISIENS, calendrier pur (chaînes « YYYY-MM-DD ») : les bornes partent
// filtrer des dates métier côté serveur, elles ne doivent pas dépendre du
// fuseau du poste.

export interface Periode {
  from: string;
  to: string;
}

export type UnitePeriode = 'jours' | 'semaines' | 'mois';

export const UNITES_PERIODE: { value: UnitePeriode; label: string }[] = [
  { value: 'jours', label: 'jours' },
  { value: 'semaines', label: 'semaines' },
  { value: 'mois', label: 'mois' },
];

/** Décale un jour « YYYY-MM-DD » de `mois` mois, jour ramené au dernier du mois si besoin. */
export function decalerMois(jour: string, mois: number): string {
  const [a, m, j] = jour.split('-').map(Number) as [number, number, number];
  const index = a * 12 + (m - 1) + mois;
  const annee = Math.floor(index / 12);
  const moisCible = (index % 12) + 1;
  const dernier = new Date(Date.UTC(annee, moisCible, 0)).getUTCDate();
  const jourCible = Math.min(j, dernier);
  return `${String(annee).padStart(4, '0')}-${String(moisCible).padStart(2, '0')}-${String(jourCible).padStart(2, '0')}`;
}

/** Plafond de N (même borne que le champ du panneau). */
export const DERNIERS_N_MAX = 999;

const JOUR_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * « Derniers N jours / semaines / mois » : fin = aujourd'hui (ou hier si
 * aujourd'hui est exclu), début = fin − N unités. `null` si N n'est pas un
 * entier entre 1 et `DERNIERS_N_MAX`, ou si une borne sortirait invalide — une
 * saisie hors bornes ne doit jamais partir en paramètre d'API.
 */
export function periodeDerniers(
  n: number,
  unite: UnitePeriode,
  inclureAujourdhui = true,
  maintenant: Date = new Date(),
): Periode | null {
  if (!Number.isInteger(n) || n < 1 || n > DERNIERS_N_MAX) return null;
  const aujourdhui = jourParis(maintenant);
  const to = inclureAujourdhui ? aujourdhui : decalerJour(aujourdhui, -1);
  const from =
    unite === 'mois'
      ? decalerMois(to, -n)
      : decalerJour(to, unite === 'semaines' ? -7 * n : -n);
  return JOUR_ISO.test(from) && JOUR_ISO.test(to) ? { from, to } : null;
}

export interface RaccourciPeriode {
  cle: string;
  libelle: string;
  periode: Periode;
  /** Équivalent « Derniers N unités » (pré-remplit la ligne du panneau). */
  relatif?: { n: number; unite: UnitePeriode };
}

export function raccourcisPeriode(
  maintenant: Date = new Date(),
): RaccourciPeriode[] {
  const aujourdhui = jourParis(maintenant);
  const annee = anneeParis(maintenant);
  const mois = Number(aujourdhui.slice(5, 7));
  const debutTrimestre = `${aujourdhui.slice(0, 4)}-${String(Math.floor((mois - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  const derniers = (
    cle: string,
    libelle: string,
    n: number,
    unite: UnitePeriode,
  ): RaccourciPeriode => ({
    cle,
    libelle,
    periode: periodeDerniers(n, unite, true, maintenant)!,
    relatif: { n, unite },
  });
  return [
    derniers('7j', '7 derniers jours', 7, 'jours'),
    derniers('30j', '30 derniers jours', 30, 'jours'),
    {
      cle: 'trimestre',
      libelle: 'Trimestre en cours',
      periode: { from: debutTrimestre, to: aujourdhui },
    },
    derniers('12m', '12 derniers mois', 12, 'mois'),
    {
      cle: 'civile',
      libelle: 'Année civile',
      periode: { from: `${annee}-01-01`, to: `${annee}-12-31` },
    },
  ];
}

/** Raccourci dont la période est exactement `p`, s'il existe. */
export function raccourciDe(
  p: Periode,
  raccourcis: RaccourciPeriode[],
): RaccourciPeriode | undefined {
  return raccourcis.find(
    (r) => r.periode.from === p.from && r.periode.to === p.to,
  );
}
