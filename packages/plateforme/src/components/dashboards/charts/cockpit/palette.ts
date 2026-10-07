/**
 * Chrome data-viz « Cockpit » (R24) — DÉRIVÉ des tokens DS §10 (globals.css
 * `@theme`). Les couleurs de SÉRIE (5 flux ZD, taux, repas, ratio) vivent dans
 * `flux.ts` (palette §2.4) ; ici = le « chrome » partagé des graphes (encre,
 * axes, grilles, pistes, surfaces, statuts, héros navy) et les pastilles des
 * cartes KPI des 6 dashboards. Source unique pour que la déclinaison reste DRY
 * et tracée au §10.
 *
 * Valeurs = références `var(--color-savr-*)` (R-UI-6a) : changer un token dans
 * `globals.css` change les graphes. Les attributs SVG `fill` / `stroke` et les
 * styles inline résolvent `var()` dans tous les navigateurs supportés (SVG 2 :
 * attributs de présentation = valeurs CSS). Aucun hex ne vit ici — le test
 * `lib/design-tokens-existent` vérifie que chaque token référencé existe.
 */

// ── Encre & texte ─────────────────────────────────────────────────────────
export const INK = 'var(--color-savr-neutral-900)';
export const TEXT_STRONG = 'var(--color-savr-neutral-700)';
export const TEXT_MUTED = 'var(--color-savr-neutral-500)';
export const TEXT_FAINT = 'var(--color-savr-neutral-400)';
export const TEXT_XFAINT = 'var(--color-savr-neutral-300)';

// ── Blanc (points, contours sur fond coloré) ──────────────────────────────
export const WHITE = 'var(--color-savr-white)';

// ── Grilles / pistes / surfaces ───────────────────────────────────────────
export const GRID = 'var(--color-savr-neutral-100)'; // lignes internes
export const GRID_BASELINE = 'var(--color-savr-neutral-200)'; // ligne de base
export const TRACK = 'var(--color-savr-neutral-100)'; // fond de jauge / anneau
export const SURFACE_HOVER = 'var(--color-savr-neutral-50)'; // survol de ligne

// ── Navy de repère (bullet, ratio) et moyenne parc ────────────────────────
export const NAVY = 'var(--color-savr-primary-700)';
export const PARC = 'var(--color-savr-primary-300)';

// ── Texte orange lisible (axe droit / valeurs taux) ───────────────────────
export const ACCENT_TEXT = 'var(--color-savr-accent-700)';

// ── Teintes avatar / chip (fond pastel + texte lisible) ───────────────────
export const TINT = {
  navy: {
    background: 'var(--color-savr-primary-50)',
    color: 'var(--color-savr-primary-700)',
  },
  orange: {
    background: 'var(--color-savr-accent-50)',
    color: 'var(--color-savr-accent-700)',
    border: 'var(--color-savr-accent-100)',
  },
} as const;

// ── Statut benchmark (vert / orange / rouge) — §10 sémantique + accent ─────
export const STATUT = {
  vert: {
    fill: 'var(--color-savr-success)',
    badge: 'var(--color-savr-success)',
    badgeBg: 'var(--color-savr-success-subtle)',
  },
  orange: {
    fill: 'var(--color-savr-accent-500)',
    badge: 'var(--color-savr-accent-700)',
    badgeBg: 'var(--color-savr-accent-50)',
  },
  rouge: {
    fill: 'var(--color-savr-error)',
    badge: 'var(--color-savr-error)',
    badgeBg: 'var(--color-savr-error-subtle)',
  },
} as const;

// ── Badge de variation KPI (▲/▼) ──────────────────────────────────────────
export const VAR_POS = {
  color: 'var(--color-savr-success-strong)',
  bg: 'var(--color-savr-success-subtle)',
};
export const VAR_NEG = {
  color: 'var(--color-savr-error)',
  bg: 'var(--color-savr-error-subtle)',
};

// ── Badge d'alerte du pack (épuisé = rouge, solde faible = orange) ────────
export const PACK_BADGE = {
  epuise: {
    color: 'var(--color-savr-error)',
    backgroundColor: 'var(--color-savr-error-subtle)',
    border: '1px solid var(--color-savr-error-soft)',
  },
  faible: {
    color: 'var(--color-savr-accent-700)',
    backgroundColor: 'var(--color-savr-accent-50)',
    border: '1px solid var(--color-savr-accent-100)',
  },
} as const;

// ── Héros CO₂ (surface navy foncée) — tons DS primary + accents assumés ───
export const CO2 = {
  bg: 'var(--color-savr-primary-700)',
  tile: 'var(--color-savr-primary-800)',
  border: 'var(--color-savr-primary-600)',
  label: 'var(--color-savr-primary-200)',
  labelSoft: 'var(--color-savr-primary-300)',
  labelFaint: 'var(--color-savr-primary-400)',
  filetEvite: 'var(--color-savr-success)',
  netInk: 'var(--color-savr-success-on-dark)', // vert clair lisible sur navy
  netWarn: 'var(--color-savr-accent-300)', // bilan net défavorable : induit > évité
} as const;

// ── Anneau pack : orange sain / rouge à sec (redondance couleur ↔ badge) ──
export const RING_OK = 'var(--color-savr-accent-500)';
export const RING_LOW = 'var(--color-savr-error)';

// ── Dégradé de rang (leaderboard) = échelle navy DS ───────────────────────
export const RANK = [
  'var(--color-savr-primary-700)',
  'var(--color-savr-primary-500)',
  'var(--color-savr-primary-400)',
  'var(--color-savr-primary-300)',
  'var(--color-savr-primary-200)',
];

// ── Pastilles des cartes KPI (palette data-viz §2.4, figée par sens) ──────
// Partagées par les 5 dashboards de rôle (traiteur, agence, gestionnaire,
// organisateur, Admin « dashboard client ») — ex-constantes `DOT` locales.
export const KPI_DOT = {
  navy: 'var(--color-savr-dataviz-1)',
  navy2: 'var(--color-savr-dataviz-3)',
  green: 'var(--color-savr-dataviz-4)',
  navy3: 'var(--color-savr-dataviz-5)',
  accent: 'var(--color-savr-dataviz-2)',
} as const;

// ── Pastilles des KPI opérationnels Admin (sévérité → sémantique §10) ─────
// La pastille encode la SÉVÉRITÉ (à traiter / à jour), le badge de pied la
// reformule en clair — remplace l'ancien code couleur porté par la bordure.
export const OPS_DOT = {
  warn: 'var(--color-savr-warning)',
  error: 'var(--color-savr-error)',
  success: 'var(--color-savr-success)',
  info: 'var(--color-savr-info)',
  neutral: 'var(--color-savr-neutral-400)',
} as const;
