/**
 * Chrome data-viz « Cockpit » (R24) — miroir JS des tokens DS §10 (globals.css
 * `@theme`). Les couleurs de SÉRIE (5 flux ZD, taux, repas, ratio) vivent dans
 * `flux.ts` (palette §2.4) ; ici = le « chrome » partagé des graphes (encre,
 * axes, grilles, pistes, surfaces, statuts, héros navy). Source unique pour que
 * la déclinaison sur les 5 autres dashboards reste DRY et tracée au §10.
 *
 * Valeurs = littéraux hex identiques aux `--color-savr-*` (les attributs SVG
 * `fill`/`stroke` ne résolvent pas `var()`, d'où des hex ici plutôt que des
 * variables CSS).
 */

// ── Encre & texte ─────────────────────────────────────────────────────────
export const INK = '#161A26'; // neutral-900
export const TEXT_STRONG = '#3C4459'; // neutral-700
export const TEXT_MUTED = '#6E7790'; // neutral-500
export const TEXT_FAINT = '#9AA2B8'; // neutral-400
export const TEXT_XFAINT = '#C3C9D9'; // neutral-300

// ── Grilles / pistes / surfaces ───────────────────────────────────────────
export const GRID = '#EEF0F5'; // neutral-100 (lignes internes)
export const GRID_BASELINE = '#DDE1EB'; // neutral-200 (ligne de base)
export const TRACK = '#EEF0F5'; // neutral-100 (fond de jauge / anneau)
export const SURFACE_HOVER = '#F7F8FB'; // neutral-50 (survol de ligne)

// ── Navy de repère (bullet, ratio) ────────────────────────────────────────
export const NAVY = '#223870'; // primary-700

// ── Texte orange lisible (axe droit / valeurs taux) ───────────────────────
export const ACCENT_TEXT = '#B36400'; // accent-700

// ── Statut benchmark (vert / orange / rouge) — §10 sémantique + accent ─────
export const STATUT = {
  vert: { fill: '#16A34A', badge: '#16A34A', badgeBg: '#F0FDF4' }, // success / success-subtle
  orange: { fill: '#FF9B00', badge: '#B36400', badgeBg: '#FFF4E0' }, // accent-500 / 700 / 50
  rouge: { fill: '#DC2626', badge: '#DC2626', badgeBg: '#FEF2F2' }, // error / error-subtle
} as const;

// ── Badge de variation KPI (▲/▼) ──────────────────────────────────────────
export const VAR_POS = { color: '#15803D', bg: '#F0FDF4' }; // success-strong / subtle
export const VAR_NEG = { color: '#DC2626', bg: '#FEF2F2' }; // error / error-subtle

// ── Héros CO₂ (surface navy foncée) — tons DS primary + accents assumés ───
export const CO2 = {
  bg: '#223870', // primary-700
  tile: '#1B2C57', // primary-800
  border: '#2E4080', // primary-600
  label: '#BDC8E5', // primary-200
  labelSoft: '#92A3D2', // primary-300
  labelFaint: '#6379B6', // primary-400
  filetEvite: '#16A34A', // success
  netInk: '#7ED9A6', // teint clair « évité » (assumé, lisible sur navy)
  netWarn: '#FFB340', // accent-300 (bilan net défavorable : induit > évité)
} as const;

// ── Anneau pack : orange sain / rouge à sec (redondance couleur ↔ badge) ──
export const RING_OK = '#FF9B00'; // accent-500
export const RING_LOW = '#DC2626'; // error

// ── Dégradé de rang (leaderboard) = échelle navy DS ───────────────────────
export const RANK = ['#223870', '#3F5599', '#6379B6', '#92A3D2', '#BDC8E5']; // primary 700/500/400/300/200
