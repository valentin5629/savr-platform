/**
 * Lot « pipeline vivant » de seed_demo — collectes récentes, en cours et à venir,
 * calculées RELATIVEMENT au jour d'exécution du seed.
 *
 * Pourquoi : la matrice CSV committée (478 collectes) s'arrête au 2026-05-28 et
 * ses dates sont figées. Dès qu'on s'en éloigne, seed_demo n'a plus aucune
 * collecte récente ni à venir : tout le pipeline amont (programmation, dispatch,
 * validation, urgence < 48 h, clôture) devient invisible en revue E2E, et les
 * graphes « 12 derniers mois » se vident par la droite. Pire, un état transitoire
 * figé dans le passé est mangé par les crons — les 52 `realisee` de mai 2026 sont
 * toutes repassées `cloturee` via le cron d'embargo H+24.
 *
 * Ce module comble le trou entre la fin de la matrice et aujourd'hui, puis pose
 * le pipeline vivant autour du jour J. La matrice CSV reste figée et intacte :
 * elle porte la profondeur d'historique, ce module porte la fraîcheur.
 *
 * Déterminisme : à ancre égale, sortie identique (PRNG de graine l'ancre, slugs
 * dérivés de la date). `SEED_TODAY=YYYY-MM-DD` épingle l'ancre (tests, CI).
 *
 * Volumétrie et saisonnalité reprises de `specs/fixtures/03 - Timeline seed_demo`
 * (~40 collectes/mois, creux juillet-août, pics mai-juin et septembre-novembre).
 */

import { decalerJour } from '../temps/index.js';

export type CollecteVivante = {
  slug: string;
  /** slug d'organisation traiteur (`org_tr_*`), comme la colonne CSV. */
  traiteur: string;
  type: 'zero_dechet' | 'anti_gaspi';
  /** jour « YYYY-MM-DD » à Paris. */
  date: string;
  lieu: string;
  pax: number;
  camions: number;
  statut: string;
  statutTms: string;
  /** AG encore à attribuer : pas de ligne `attributions_antgaspi`. */
  sansAttribution?: boolean;
  /** collecte non encore dispatchée : `prestataire_logistique_id` à NULL. */
  sansPrestataire?: boolean;
  /** AG `realisee_sans_collecte` : motif + photo obligatoires (§05). */
  motifAucunRepas?: string;
};

/**
 * Dernier jour de la matrice CSV figée. Le lot vivant démarre le lendemain :
 * la timeline reste contiguë de 2025-06 à J+90 sans doublonner la matrice.
 */
export const FIN_MATRICE = '2026-05-28';

/** Horizon de programmation des collectes à venir. */
export const HORIZON_JOURS = 90;

/**
 * Profondeur maximale du comblement. Au-delà d'un an d'écart avec la matrice, on
 * ne remonte pas plus loin : la fenêtre glissante des dashboards fait 12 mois,
 * et on évite que le seed enfle indéfiniment si personne ne régénère la matrice.
 */
const PROFONDEUR_MAX_JOURS = 365;

/** Collectes/mois par mois calendaire — saisonnalité événementielle IDF (spec §03). */
const COLLECTES_PAR_MOIS: Record<number, number> = {
  1: 30, // redémarrage, vœux
  2: 24, // vacances d'hiver zone C
  3: 42, // reprise
  4: 38, // vacances de printemps
  5: 52, // pic printemps
  6: 60, // pic congrès + soirées d'été
  7: 18, // vacances d'été
  8: 10, // creux maximal
  9: 56, // rentrée, salons
  10: 52, // salons (creux Toussaint)
  11: 56, // pic salons/congrès
  12: 40, // galas 1re quinzaine, arrêt Noël
};

/** Poids traiteurs — repris de la répartition observée dans la matrice CSV. */
const TRAITEURS: ReadonlyArray<readonly [string, number]> = [
  ['org_tr_kaspia', 156],
  ['org_tr_potel', 93],
  ['org_tr_lenotre', 66],
  ['org_tr_fleurdemets', 61],
  ['org_tr_butard', 47],
  ['org_tr_grandchemin', 34],
];

/** Poids lieux IDF — mêmes proportions que la matrice (Rouen exclu, cf. Cirette). */
const LIEUX_IDF: ReadonlyArray<readonly [string, number]> = [
  ['lieu_porte_versailles', 183],
  ['lieu_palais_congres', 107],
  ['lieu_champerret', 78],
  ['lieu_arts_forains', 52],
  ['lieu_villepinte', 18],
  ['lieu_trianon', 8],
  ['lieu_le_bourget', 6],
  ['lieu_convention_centre', 5],
];

/** Cirette est le traiteur de Rouen : son lieu est imposé (province, §03). */
const TRAITEUR_PROVINCE = 'org_tr_cirette';
const LIEU_PROVINCE = 'lieu_rouen_normandie';

/** PRNG déterministe (mulberry32) — même ancre, même dataset. */
function mulberry32(graine: number): () => number {
  let a = graine;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tirage<T>(
  rnd: () => number,
  pondere: ReadonlyArray<readonly [T, number]>,
): T {
  const total = pondere.reduce((s, [, p]) => s + p, 0);
  let x = rnd() * total;
  for (const [valeur, poids] of pondere) {
    x -= poids;
    if (x <= 0) return valeur;
  }
  return pondere[pondere.length - 1]![0];
}

function entre(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

/** Nombre de jours du mois (1-12), sans passer par une chaîne de date. */
function joursDuMois(annee: number, mois: number): number {
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

function partiesJour(jour: string): [number, number, number] {
  const [a, m, j] = jour.split('-').map(Number);
  return [a!, m!, j!];
}

/** Compare deux jours « YYYY-MM-DD » (ordre lexicographique = ordre calendaire). */
function avant(a: string, b: string): boolean {
  return a < b;
}

/** pax réaliste : gros salons rares, réceptions moyennes fréquentes. */
function paxAleatoire(rnd: () => number): number {
  const d = rnd();
  if (d < 0.08) return entre(rnd, 1800, 3000); // grands salons (palier haut)
  if (d < 0.35) return entre(rnd, 800, 1800);
  return entre(rnd, 120, 800);
}

function construire(
  rnd: () => number,
  date: string,
  index: number,
  statut: string,
  statutTms: string,
  extra: Partial<CollecteVivante> = {},
): CollecteVivante {
  // 1 collecte sur 12 part en province (Cirette / Rouen), comme la matrice.
  const province = rnd() < 0.045;
  const traiteur = province ? TRAITEUR_PROVINCE : tirage(rnd, TRAITEURS);
  const lieu = province ? LIEU_PROVINCE : tirage(rnd, LIEUX_IDF);
  const type = rnd() < 0.6 ? 'zero_dechet' : 'anti_gaspi';
  const pax = paxAleatoire(rnd);
  const court = traiteur.replace(/^org_tr_/, '');
  const suffixe = type === 'zero_dechet' ? 'zd' : 'ag';
  return {
    slug: `col_${suffixe}_${court}_${date.replace(/-/g, '')}_${String(index).padStart(2, '0')}`,
    traiteur,
    type,
    date,
    lieu,
    pax,
    // Au-delà de 1 500 pax, Ops demande un 2e camion (§05 multi-camions).
    camions: pax > 1500 ? 2 : 1,
    statut,
    statutTms,
    ...extra,
  };
}

/**
 * Comblement de l'historique : du lendemain de la matrice jusqu'à J-8, tout est
 * `cloturee` (donc facturé, avec bordereau/attestation) comme le reste de la
 * profondeur. Volume par mois = saisonnalité, proratisé sur les mois partiels.
 */
function genererHistorique(
  ancre: string,
  rnd: () => number,
): CollecteVivante[] {
  const plancher = decalerJour(ancre, -PROFONDEUR_MAX_JOURS);
  const debut = avant(decalerJour(FIN_MATRICE, 1), plancher)
    ? plancher
    : decalerJour(FIN_MATRICE, 1);
  const fin = decalerJour(ancre, -8);
  if (!avant(debut, fin)) return [];

  const out: CollecteVivante[] = [];
  let curseur = debut;
  while (avant(curseur, fin)) {
    const [annee, mois] = partiesJour(curseur);
    const nbJoursMois = joursDuMois(annee, mois);
    const finMois = `${annee}-${String(mois).padStart(2, '0')}-${String(nbJoursMois).padStart(2, '0')}`;
    const finFenetre = avant(finMois, fin) ? finMois : fin;
    const premierJour = partiesJour(curseur)[2];
    const dernierJour = partiesJour(finFenetre)[2];
    const couverts = dernierJour - premierJour + 1;
    // Prorata du mois partiel : un mois entamé au 20 ne porte pas 40 collectes.
    const cible = Math.round(
      (COLLECTES_PAR_MOIS[mois] ?? 40) * (couverts / nbJoursMois),
    );
    for (let i = 0; i < cible; i++) {
      const jour = `${annee}-${String(mois).padStart(2, '0')}-${String(
        entre(rnd, premierJour, dernierJour),
      ).padStart(2, '0')}`;
      out.push(construire(rnd, jour, i + 1, 'cloturee', 'acceptee'));
    }
    curseur = decalerJour(finFenetre, 1);
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Pipeline vivant autour du jour J : la semaine écoulée en attente de clôture,
 * le jour même en exécution, et l'horizon de programmation à venir.
 *
 * Les cas limites sont posés explicitement (et pas au hasard) pour que chaque
 * écran de revue ait sa donnée : urgence < 48 h non validée, AG à attribuer,
 * AG sans pack actif, collecte non dispatchée, réalisée sans collecte, rejet
 * prestataire, brouillon.
 */
function genererPipeline(ancre: string, rnd: () => number): CollecteVivante[] {
  const out: CollecteVivante[] = [];
  const j = (n: number) => decalerJour(ancre, n);

  // ── J-7 → J-1 : réalisées en attente de clôture (embargo H+24 en cours) ──
  for (let d = 7; d >= 1; d--) {
    for (let i = 0; i < entre(rnd, 1, 3); i++) {
      out.push(construire(rnd, j(-d), i + 1, 'realisee', 'acceptee'));
    }
  }
  // AG sans invendus → `realisee_sans_collecte` (badge + motif + photo, §05).
  out.push(
    construire(rnd, j(-2), 8, 'realisee_sans_collecte', 'acceptee', {
      type: 'anti_gaspi',
      motifAucunRepas: 'Aucun invendu : buffet intégralement consommé.',
    }),
  );
  // Refus prestataire → la collecte retombe dans la corbeille Ops.
  out.push(
    construire(
      rnd,
      j(-3),
      9,
      'rejetee_par_prestataire',
      'rejetee_par_prestataire',
      {
        sansPrestataire: true,
      },
    ),
  );

  // ── J : collectes en cours d'exécution ──
  for (let i = 0; i < 2; i++) {
    out.push(construire(rnd, ancre, i + 1, 'en_cours', 'en_attente_execution'));
  }

  // ── J+1 / J+2 : urgences (alimentent le chip « 48 h non validées ») ──
  out.push(
    construire(rnd, j(1), 1, 'programmee', 'non_envoye', {
      type: 'zero_dechet',
      sansPrestataire: true,
    }),
  );
  out.push(
    construire(rnd, j(2), 1, 'programmee', 'a_attribuer', {
      type: 'anti_gaspi',
      sansAttribution: true,
      sansPrestataire: true,
    }),
  );

  // ── J+3 → J+HORIZON : programmation courante ──
  for (let d = 3; d <= HORIZON_JOURS; d += 2) {
    const nb = entre(rnd, 0, 2);
    for (let i = 0; i < nb; i++) {
      // Plus la collecte est proche, plus elle a de chances d'être déjà validée.
      const proche = d <= 21;
      const valide = rnd() < (proche ? 0.65 : 0.25);
      const c = construire(
        rnd,
        j(d),
        i + 1,
        valide ? 'validee' : 'programmee',
        valide ? 'acceptee' : 'non_envoye',
        valide ? {} : { sansPrestataire: true },
      );
      if (!valide && c.type === 'anti_gaspi') c.sansAttribution = true;
      out.push(c);
    }
  }

  // ── Cas limites nommés ──
  // NB : le compte Nomad reste VOLONTAIREMENT vide (fixture « nouveau client,
  // zéro collecte » de la spec §03) — ne rien lui rattacher ici.
  // Très gros salon multi-camions (palier haut de la grille ZD).
  out.push({
    ...construire(rnd, j(30), 8, 'validee', 'acceptee'),
    slug: `col_zd_kaspia_${j(30).replace(/-/g, '')}_08`,
    traiteur: 'org_tr_kaspia',
    type: 'zero_dechet',
    lieu: 'lieu_porte_versailles',
    pax: 4200,
    camions: 3,
  });
  // Brouillons : programmation commencée, jamais confirmée.
  for (let i = 0; i < 3; i++) {
    out.push(
      construire(rnd, j(20 + i * 9), 9 + i, 'brouillon', 'non_envoye', {
        sansPrestataire: true,
        sansAttribution: true,
      }),
    );
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Lot complet : comblement historique + pipeline vivant, trié par date. */
export function genererPipelineVivant(ancre: string): CollecteVivante[] {
  const rnd = mulberry32(Number(ancre.replace(/-/g, '')));
  return [...genererHistorique(ancre, rnd), ...genererPipeline(ancre, rnd)];
}
