import {
  BORDEREAU_CSS,
  renderBordereauBody,
  type BordereauZdData,
  type FluxDetail,
} from './bordereau-zd.js';
import { NUNITO_WOFF2_BASE64, SAVR_LOGO_MASK } from './assets/marque.js';

// Version figée du gabarit — doit rester égale à
// TEMPLATE_VERSIONS['rapport-recyclage-zd'] du contrat partagé (@savr/shared).
// Vérifié par check:pdf-contract.
// @3 (2026-10-13) : maquettes validées par Val dans Claude Design. La page 1 existe
// en deux versions, choisies par `options.benchmark` :
//   - avec radar : comparaison kg/convive au parc Savr (radar base 100 + liste) ;
//   - sans radar : taux, carbone, tableau des tonnages et camembert.
// Identité Savr (bandeau navy, Nunito, logo officiel). La page 2 reste le
// bordereau de pesée, inchangé ; elle est retirée quand le demandeur ne peut
// pas lire ce bordereau sous sa RLS (décision Val 2026-10-27, §12 §1.7).
export const TEMPLATE_VERSION = 'rapport-recyclage-zd@3';

/** Une ligne du benchmark kg/convive (1 par flux pesé). */
export interface BenchmarkFluxGauge {
  flux_nom: string;
  flux_code?: string;
  collecte_kg_pax: number | null;
  /**
   * Repère parc. `null` quand le k-anonymat a masqué le segment côté SQL. La
   * cause n'est pas exposée ici et le gabarit ne rejoue jamais le seuil : la
   * garde est portée par la fonction SQL seule.
   */
  benchmark_kg_pax?: number | null;
}

export interface RapportRecyclageZdData {
  // En-tête
  /** Nom du client organisateur ; à défaut le gabarit affiche `nom_evenement`. */
  client_nom?: string | null;
  nom_evenement: string;
  traiteur_nom: string;
  date_evenement: string;
  lieu_nom: string;
  lieu_adresse: string;
  nb_pax?: number | null;
  logo_client_url?: string | null;
  logo_traiteur_url?: string | null;
  /** Logo unique des payloads @2 (cascade) — lu comme logo client s'il est seul. */
  logo_url?: string | null;

  // Données mesurées (toujours présentes)
  taux_recyclage?: number | null;
  flux: FluxDetail[];
  poids_total_kg: number;
  co2_evite_kg?: number | null;
  co2_induit_kg?: number | null;
  co2_net_kg?: number | null;
  energie_primaire_evitee_kwh?: number | null;
  equivalences?: {
    km_voiture?: number | null;
    foyer?: number | null;
  } | null;
  /** Taux de captation figés à la clôture (`collectes.caps_appliques`). */
  caps_appliques?: Record<string, unknown> | null;

  // Version du rapport : le radar n'apparaît que si le demandeur l'a choisi.
  options?: { benchmark?: boolean } | null;
  benchmark_flux?: BenchmarkFluxGauge[] | null;
  benchmark_legende?: string | null;

  // Page 2, absente quand le demandeur ne peut pas lire le bordereau sous sa RLS.
  bordereau?: BordereauZdData | null;
}

// ─── Référentiel d'affichage des flux ────────────────────────────────────────
// Ordre = ordre d'affichage du référentiel (axes du radar). Reconnaissance par le
// code quand le payload le porte, sinon par le nom (payloads antérieurs à @3).
// Couleurs = celles des graphiques à l'écran (tokens `--color-savr-flux-*`,
// décision Val 2026-10-30).
const FLUX_REF = [
  { code: 'biodechet', motif: /bio/i, couleur: '#12a459', court: 'Biodéchets' },
  {
    code: 'emballage',
    motif: /emball/i,
    couleur: '#ffbd59',
    court: 'Emballages',
  },
  { code: 'carton', motif: /carton/i, couleur: '#87684d', court: 'Cartons' },
  { code: 'verre', motif: /verre/i, couleur: '#09337a', court: 'Verre' },
  {
    code: 'dechet_residuel',
    motif: /r[ée]sidu|ordure/i,
    couleur: '#a6b1b7',
    court: 'Résiduel',
  },
] as const;

const CODE_RESIDUEL = 'dechet_residuel';

interface RefFlux {
  code: string | null;
  rang: number;
  couleur: string;
  court: string;
}

function refFlux(code: string | undefined | null, nom: string): RefFlux {
  const i = FLUX_REF.findIndex((r) =>
    code ? r.code === code : r.motif.test(nom),
  );
  const r = i >= 0 ? FLUX_REF[i] : undefined;
  return r
    ? { code: r.code, rang: i, couleur: r.couleur, court: r.court }
    : {
        code: code ?? null,
        rang: FLUX_REF.length,
        couleur: '#515a72',
        court: nom,
      };
}

/** Couleur figée d'un flux (code, sinon nom) — partagée avec le PDF de synthèse. */
export function couleurFlux(
  code: string | undefined | null,
  nom: string,
): string {
  return refFlux(code, nom).couleur;
}

// ─── Formats ─────────────────────────────────────────────────────────────────
export const INSECABLE = ' ';
export const dec = (n: number, d: number) => n.toFixed(d).replace('.', ',');
export const entier = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, INSECABLE);
export const kg = (n: number) => `${dec(n, 1)}${INSECABLE}kg`;
export const pct = (n: number) => `${dec(n, 1)}${INSECABLE}%`;
export const tonnesCo2 = (kilos: number) =>
  `${dec(kilos / 1000, 3)}${INSECABLE}t${INSECABLE}CO₂e`;
/** kg par convive : 3 décimales sous 0,1 (sinon « 0,06 » et « 0,05 » se confondent). */
const kgPax = (n: number) => dec(n, n < 0.1 ? 3 : 2);

export function esc(s: string | number | undefined | null): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Logo Savr (masque de luminance, cf. assets/marque.ts) ───────────────────
export const LOGO_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><mask id="rz-logo-masque"><image href="${SAVR_LOGO_MASK}" width="551" height="150" preserveAspectRatio="none"/></mask><clipPath id="rz-logo-coin"><rect x="52" y="0" width="46" height="98"/><rect x="52" y="52" width="98" height="46"/></clipPath></defs></svg>`;

/** Croix « + » du logo Savr ; `base` = couleur du logo, coin vert (contexte ZD). */
function logoSavr(taille: number, base: string): string {
  return `<svg class="rz-logo-savr" viewBox="2 2 146 146" width="${taille}" height="${taille}" role="img" aria-label="Savr"><rect width="551" height="150" fill="${base}" mask="url(#rz-logo-masque)"/><g clip-path="url(#rz-logo-coin)"><rect width="551" height="150" fill="#16a34a" mask="url(#rz-logo-masque)"/></g></svg>`;
}

// ─── Styles du bordereau, limités à la page 2 ────────────────────────────────
// Le bordereau écrit ses règles sur `body`, `*`, `table`… : on les rattache au
// conteneur `.bz` pour qu'elles n'atteignent jamais la page 1.
function limiterALaPortee(css: string, portee: string): string {
  return css
    .split('\n')
    .map((ligne) => {
      const i = ligne.indexOf('{');
      if (i < 0) return ligne;
      const selecteurs = ligne
        .slice(0, i)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) =>
          s === 'body' ? portee : s === '*' ? `${portee} *` : `${portee} ${s}`,
        );
      return `  ${selecteurs.join(', ')} ${ligne.slice(i)}`;
    })
    .join('\n');
}

// ─── Radar kg/convive (base 100 = parc) ──────────────────────────────────────
// Géométrie de la maquette : centre (100,100), parc à 56, anneaux à 28 (50) et
// 84 (150). Un flux au-delà de 150 % du parc est borné à l'anneau extérieur.
const R_PARC = 56;
const R_MAX = 84;
const R_MIN = 28;

function radarSvg(axes: { libelle: string; ratio: number }[]): string {
  const n = axes.length;
  const point = (i: number, r: number) => {
    const a = ((-90 + (360 * i) / n) * Math.PI) / 180;
    return { x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a), a };
  };
  const coords = (r: (i: number) => number) =>
    axes
      .map((_, i) => {
        const p = point(i, r(i));
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(' ');
  const rayonVous = (i: number) =>
    Math.min(R_MAX, Math.max(0, R_PARC * (axes[i]?.ratio ?? 0)));

  const rayons = axes
    .map((_, i) => {
      const p = point(i, R_MAX);
      return `<line class="rz-ax" x1="100" y1="100" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"></line>`;
    })
    .join('');
  const points = axes
    .map((_, i) => {
      const p = point(i, rayonVous(i));
      return `<circle class="rz-vpt" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6"></circle>`;
    })
    .join('');
  const libelles = axes
    .map((axe, i) => {
      const p = point(i, R_MAX);
      const cos = Math.cos(p.a);
      const sin = Math.sin(p.a);
      const cote = Math.abs(cos) < 0.05 ? 0 : Math.sign(cos);
      let x = p.x;
      let y = p.y;
      let ancre = 'middle';
      if (sin < -0.9) {
        y -= 10;
      } else if (sin > 0.5) {
        x += cote * 4.6;
        y += 16;
      } else {
        x += cote * 6;
        y -= 2;
        ancre = cote > 0 ? 'start' : 'end';
      }
      return `<text class="rz-axl" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${ancre}">${esc(axe.libelle)}</text>`;
    })
    .join('');

  return `<svg class="rz-radar" viewBox="-30 -8 260 215" role="img" aria-label="Radar kg par convive par flux">
        <polygon class="rz-ring" points="${coords(() => R_MIN)}"></polygon>
        <polygon class="rz-ring" points="${coords(() => R_MAX)}"></polygon>
        ${rayons}
        <polygon class="rz-parc" points="${coords(() => R_PARC)}"></polygon>
        <polygon class="rz-vous" points="${coords(rayonVous)}"></polygon>
        ${points}
        ${libelles}
      </svg>`;
}

/** Données de la page de synthèse (page 1), sans le bordereau de la page 2. */
export type SyntheseRecyclageData = Omit<RapportRecyclageZdData, 'bordereau'>;

/** Ce qui distingue le rapport d'une collecte de celui d'un événement. */
export interface OptionsSynthese {
  titre: string;
  /** Ligne sous le nom du client, dans le bandeau (rien si absente). */
  sousTitre?: string;
  /** Phrase sous le taux de recyclage. */
  mentionTaux: string;
  /** Styles et HTML des pages qui suivent la page 1. */
  cssSuite: string;
  suite: string;
}

const MENTION_TAUX_COLLECTE =
  'Calculé selon la méthode UE 2019/1004 — taux de captation par filière, figé à la clôture de la collecte. Voir Méthodologie.';

export function renderRapportRecyclageZd(data: RapportRecyclageZdData): string {
  const bordereau = data.bordereau;
  // Sans bordereau (le demandeur ne peut pas le lire), le rapport s'arrête à la
  // page 1 (décision Val 2026-10-27, §12 §1.7).
  if (!bordereau) {
    return renderSyntheseRecyclage(data, {
      titre: 'Rapport de recyclage',
      mentionTaux: MENTION_TAUX_COLLECTE,
      cssSuite: '',
      suite: '',
    });
  }
  return renderSyntheseRecyclage(data, {
    titre: 'Rapport de recyclage',
    mentionTaux: MENTION_TAUX_COLLECTE,
    cssSuite: `
  /* ── Page 2 : bordereau de pesée (styles du gabarit bordereau) ─────────── */
  .bz { break-before: page; }
${limiterALaPortee(BORDEREAU_CSS, '.bz')}
  /* Sélecteur à deux classes : il l'emporte sur la remise à zéro du bordereau (.bz *). */
  .bz .bz-annexe { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 14px; margin-bottom: 16px; font-size: 10px; color: #15803d; font-weight: 600; }
`,
    suite: `<!-- PAGE 2 — Bordereau de pesée intégré -->
<div class="bz">
  <div class="bz-annexe">Annexe — Bordereau de pesée Savr (${esc(bordereau.numero)})</div>
  ${renderBordereauBody(bordereau)}
</div>
`,
  });
}

/** Ce que l'en-tête des rapports imprime (bandeau et ligne date · lieu · convives). */
export type EnTeteRapportData = Pick<
  RapportRecyclageZdData,
  | 'client_nom'
  | 'nom_evenement'
  | 'traiteur_nom'
  | 'date_evenement'
  | 'lieu_nom'
  | 'lieu_adresse'
  | 'nb_pax'
  | 'logo_client_url'
  | 'logo_traiteur_url'
  | 'logo_url'
>;

/** Bandeau navy et ligne date · lieu · convives, communs aux rapports. */
export function enTeteRapport(
  data: EnTeteRapportData,
  titre: string,
  sousTitre?: string,
): { bandeau: string; meta: string } {
  // ── Bandeau ────────────────────────────────────────────────────────────────
  const titreClient = data.client_nom?.trim() || data.nom_evenement;
  const traiteur =
    data.traiteur_nom && data.traiteur_nom !== titreClient
      ? `<span class="rz-x">× ${esc(data.traiteur_nom)}</span>`
      : '';
  const logos = [data.logo_client_url ?? data.logo_url, data.logo_traiteur_url]
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((u) => `<div class="rz-logo"><img src="${esc(u)}" alt=""/></div>`)
    .join('');
  const bandeau = `
  <div class="rz-band">
    <div class="rz-band-savr">${logoSavr(64, '#ffffff')}</div>
    <div class="rz-band-titre">
      <div class="rz-ttl">${esc(titre)}</div>
      <div class="rz-client"><span>${esc(titreClient)}</span>${traiteur}</div>${sousTitre ? `<div class="rz-sous-titre">${esc(sousTitre)}</div>` : ''}
    </div>
    ${logos ? `<div class="rz-logos">${logos}</div>` : ''}
  </div>`;

  const meta = `
    <div class="rz-meta">
      <div><div class="rz-k">Date de l'événement</div><div class="rz-v">${esc(data.date_evenement)}</div></div>
      <div><div class="rz-k">Lieu</div><div class="rz-v">${esc(data.lieu_nom)}</div><div class="rz-vs">${esc(data.lieu_adresse)}</div></div>
      <div><div class="rz-k">Convives</div><div class="rz-v">${data.nb_pax ? entier(data.nb_pax) : '—'}</div></div>
    </div>`;

  return { bandeau, meta };
}

/**
 * Styles de la page de synthèse (identité Savr : Nunito, bandeau navy, cartes),
 * communs aux rapports d'une collecte et d'un événement.
 */
export const CSS_MARQUE = `  @font-face { font-family: 'Nunito'; font-style: normal; font-weight: 200 1000; src: url(data:font/woff2;base64,${NUNITO_WOFF2_BASE64}) format('woff2'); }
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }

  /* ── Page 1 ───────────────────────────────────────────────────────────── */
  .rz-page, .rz-page * { margin: 0; padding: 0; box-sizing: border-box; }
  .rz-page { width: 794px; height: 1122px; overflow: hidden; display: flex; flex-direction: column; background: #fff; font-family: 'Nunito', system-ui, sans-serif; color: #161a26; font-size: 12px; line-height: 1.45; }
  .rz-page svg text { font-family: 'Nunito', system-ui, sans-serif; }
  .rz-band { background: #223870; color: #fff; padding: 18px 48px 16px; display: flex; justify-content: space-between; align-items: center; gap: 24px; }
  .rz-band-savr { flex-shrink: 0; width: 64px; height: 64px; }
  .rz-band-titre { flex: 1; min-width: 0; }
  .rz-ttl { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; white-space: nowrap; }
  .rz-client { font-size: 15px; font-weight: 700; margin-top: 8px; letter-spacing: -0.01em; display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
  .rz-client span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .rz-x { color: #bdc8e5; font-weight: 600; }
  .rz-logos { display: flex; gap: 8px; flex-shrink: 0; }
  .rz-logo { width: 100px; height: 48px; border-radius: 8px; background: #fff; display: flex; align-items: center; justify-content: center; padding: 6px; }
  .rz-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .rz-body { flex: 1; padding: 16px 48px 16px; display: flex; flex-direction: column; }
  /* Écart minimal 12px ; l'espace restant se répartit (≈ 20px au cas nominal). */
  .rz-body-radar { gap: 12px; justify-content: space-between; }
  .rz-body-simple { gap: 18px; padding-top: 22px; justify-content: space-between; }
  .rz-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding-bottom: 6px; border-bottom: 1px solid #dde1eb; text-align: center; }
  .rz-meta > div { padding: 0 16px; min-width: 0; }
  .rz-v, .rz-vs { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rz-meta > div + div { border-left: 1px solid #dde1eb; }
  .rz-k { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #6e7790; margin-bottom: 3px; }
  .rz-v { font-size: 15px; font-weight: 700; color: #161a26; margin-top: 1px; }
  .rz-vs { font-size: 12px; color: #515a72; }
  .rz-card { border: 1px solid #dde1eb; border-radius: 8px; padding: 11px 16px; background: #fff; }
  .rz-card-large { padding: 20px 22px; }
  .rz-hero { background: #eff2f9; border-color: #dee4f2; }
  .rz-h2 { font-size: 12.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #515a72; margin-bottom: 7px; }
  .rz-duo { display: grid; grid-template-columns: 1.7fr 1fr; gap: 11px; }
  .rz-duo-egal { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; align-items: start; }
  .rz-pave { display: flex; flex-direction: column; justify-content: flex-start; gap: 10px; padding: 20px 22px; }
  .rz-chiffre-ligne { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .rz-chiffre { font-size: 50px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; color: #223870; white-space: nowrap; }
  .rz-chiffre-64 { font-size: 64px; }
  .rz-chiffre-40 { font-size: 40px; }
  .rz-pill { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 800; letter-spacing: 0; background: #f0fdf4; color: #15803d; vertical-align: middle; margin-left: 6px; }
  .rz-chiffre-ligne .rz-pill { margin-left: 0; }
  .rz-eq-fort { font-size: 15px; font-weight: 700; color: #3c4459; }
  .rz-eq { font-size: 11px; color: #515a72; margin-top: 3px; }
  .rz-kv { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; font-size: 11.5px; }
  .rz-kv-aere { margin-top: 6px; font-size: 13px; row-gap: 6px; }
  .rz-kv-125 { font-size: 12.5px; }
  .rz-l { color: #515a72; }
  .rz-r { font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rz-n { font-size: 10px; color: #6e7790; font-weight: 400; }
  .rz-methode { color: #515a72; line-height: 1.45; }
  .rz-methode-12 { font-size: 12px; margin-top: 2px; }
  .rz-methode-11 { font-size: 11px; }
  .rz-taux-large { display: flex; flex-direction: row; align-items: center; gap: 30px; padding: 24px 26px; }
  .rz-taux-bloc { flex: 0 0 auto; }

  /* Tonnages — version avec radar : barre empilée */
  .rz-barre { display: flex; height: 34px; border-radius: 8px; overflow: hidden; gap: 2px; background: #fff; }
  .rz-seg { display: flex; align-items: center; justify-content: center; min-width: 0; }
  .rz-seg span { font-size: 11px; font-weight: 800; color: #fff; white-space: nowrap; }
  .rz-leg-grille { display: grid; gap: 10px; margin-top: 10px; }
  .rz-leg-item { display: flex; gap: 6px; align-items: flex-start; min-width: 0; }
  .rz-leg-dot { flex-shrink: 0; width: 10px; height: 10px; border-radius: 3px; margin-top: 3px; }
  .rz-leg-nom { font-size: 11px; font-weight: 700; color: #223870; white-space: nowrap; }
  .rz-leg-kg { font-size: 14px; font-weight: 800; color: #161a26; white-space: nowrap; }
  .rz-total { margin-top: 6px; padding-top: 6px; border-top: 1px solid #eef0f5; font-size: 11.5px; color: #515a72; }
  .rz-total b { color: #161a26; font-size: 13px; }

  /* Tonnages — version sans radar : tableau + anneau */
  .rz-flux { display: grid; grid-template-columns: 1fr 190px; gap: 28px; align-items: center; }
  .rz-tbl { width: 100%; border-collapse: collapse; }
  .rz-tbl th { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #6e7790; text-align: left; padding: 2px 6px 3px; border-bottom: 1px solid #dde1eb; }
  .rz-tbl td { padding: 6px; border-bottom: 1px solid #eef0f5; font-size: 12px; }
  .rz-tbl th.rz-num, .rz-tbl td.rz-num { text-align: right; font-variant-numeric: tabular-nums; }
  .rz-tbl tr.rz-tot td { font-weight: 800; border-top: 2px solid #223870; border-bottom: none; padding: 8px 6px; color: #15213f; }
  .rz-dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 7px; vertical-align: -1px; }
  .rz-split { display: flex; gap: 18px; font-size: 11px; color: #515a72; margin-top: 5px; }
  .rz-split b { color: #161a26; }
  .rz-donut { width: 170px; height: 170px; }

  /* Radar */
  .rz-bench { display: grid; grid-template-columns: 260px 1fr; gap: 12px; align-items: center; }
  .rz-bench-liste { grid-template-columns: 1fr; }
  .rz-radar { width: 260px; height: 230px; display: block; overflow: visible; }
  .rz-ax, .rz-ring { stroke: #dde1eb; stroke-width: 1; fill: none; }
  .rz-parc { stroke: #92a3d2; stroke-width: 1.5; fill: #eff2f9; fill-opacity: .6; }
  .rz-vous { stroke: #223870; stroke-width: 2; fill: none; stroke-linejoin: round; }
  .rz-vpt { fill: #223870; }
  .rz-axl { font-size: 9.5px; font-weight: 700; fill: #3c4459; }
  .rz-blist { display: flex; flex-direction: column; gap: 2px; }
  .rz-brow { display: grid; grid-template-columns: 100px 72px 1fr 62px; gap: 10px; white-space: nowrap; align-items: center; font-size: 11.5px; padding: 3px 0; border-bottom: 1px solid #eef0f5; }
  .rz-f { font-weight: 700; }
  .rz-kgp { font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; }
  .rz-pk { font-size: 10.5px; color: #6e7790; font-variant-numeric: tabular-nums; text-align: center; }
  .rz-bdg { display: inline-block; justify-self: end; min-width: 48px; text-align: center; padding: 2px 7px; border-radius: 9999px; font-size: 10px; font-weight: 800; }
  .rz-ok { background: #f0fdf4; color: #15803d; }
  .rz-wn { background: #fffbeb; color: #b45309; }
  .rz-bd { background: #fef2f2; color: #b91c1c; }
  .rz-nd { background: #eef0f5; color: #515a72; }
  .rz-leg { display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 10px; color: #515a72; margin-top: 5px; align-items: center; }
  .rz-leg > span { white-space: nowrap; }
  .rz-sw { display: inline-block; width: 14px; height: 0; border-top: 2px solid #223870; margin-right: 5px; vertical-align: middle; }
  .rz-sw2 { display: inline-block; width: 14px; height: 8px; background: #eff2f9; border: 1px solid #92a3d2; margin-right: 5px; vertical-align: middle; }
  .rz-mention { font-size: 9.5px; color: #6e7790; margin-top: 6px; line-height: 1.4; }

  /* Encart Savr + méthodologie */
  .rz-savr { display: flex; gap: 14px; align-items: center; background: #eff2f9; border: 1px solid #dee4f2; border-radius: 8px; padding: 8px 12px; }
  .rz-body-simple .rz-savr { padding: 10px 14px; }
  .rz-savr-logo { flex-shrink: 0; width: 40px; height: 40px; }
  .rz-savr-txt { min-width: 0; font-size: 10.5px; line-height: 1.45; color: #3c4459; text-wrap: pretty; }
  .rz-savr-txt b { color: #223870; }
  .rz-metho { font-size: 9.5px; color: #515a72; line-height: 1.45; border-top: 1px solid #dde1eb; padding-top: 9px; }
  .rz-body-simple .rz-metho { font-size: 11px; }
  .rz-metho b { color: #272d3d; }
  .rz-caps { display: flex; gap: 14px; margin-top: 4px; }
  .rz-caps span { white-space: nowrap; }
  .rz-caps b { color: #161a26; }`;

/**
 * Document complet : page 1 de synthèse (avec ou sans radar, au choix du
 * demandeur), puis les pages de `options.suite`.
 */
export function renderSyntheseRecyclage(
  data: SyntheseRecyclageData,
  options: OptionsSynthese,
): string {
  const total = data.poids_total_kg;

  // Flux pesés, du plus lourd au plus léger (ordre de la planche avec radar).
  const flux = data.flux
    .map((f) => ({
      ...f,
      ref: refFlux(f.code, f.nom),
      part: total > 0 ? (f.poids_kg / total) * 100 : 0,
    }))
    .sort((a, b) => b.poids_kg - a.poids_kg || a.ref.rang - b.ref.rang);

  const { bandeau, meta } = enTeteRapport(
    data,
    options.titre,
    options.sousTitre,
  );
  // ── Carbone (règle ABC : évité en chiffre principal, induit et net à part) ──
  const evite = data.co2_evite_kg;
  const net = data.co2_net_kg;
  const eq = data.equivalences;
  const kmVoiture =
    evite != null && eq?.km_voiture != null
      ? `Soit l'équivalent de ≈${INSECABLE}${entier(eq.km_voiture)}${INSECABLE}km en voiture.`
      : '';
  const foyers =
    eq?.foyer != null && eq.foyer >= 1
      ? ` <span class="rz-n">≈${INSECABLE}${entier(eq.foyer)} foyer${eq.foyer >= 2 ? 's' : ''} / an</span>`
      : '';
  const lignesCarbone = (avecFoyers: boolean) => `
      <div class="rz-l">Émissions induites <span class="rz-n">(transport, traitement)</span></div><div class="rz-r">${data.co2_induit_kg != null ? tonnesCo2(data.co2_induit_kg) : '—'}</div>
      <div class="rz-l">${net != null && net > 0 ? 'Émissions nettes' : 'Émissions nettes évitées'}</div><div class="rz-r">${net != null ? tonnesCo2(Math.abs(net)) : '—'}</div>
      <div class="rz-l">Énergie primaire évitée</div><div class="rz-r">${data.energie_primaire_evitee_kwh != null ? `${entier(data.energie_primaire_evitee_kwh)}${INSECABLE}kWh${avecFoyers ? foyers : ''}` : '—'}</div>`;
  const chiffreEvite = evite != null ? tonnesCo2(evite) : '—';
  const pastilleEvite =
    evite != null ? '<span class="rz-pill">évitées</span>' : '';
  const taux = data.taux_recyclage != null ? pct(data.taux_recyclage) : '—';
  const mentionTaux = options.mentionTaux;

  // ── Pied de page 1 : encart Savr + méthodologie ────────────────────────────
  const encartSavr = `
    <div class="rz-savr">
      <div class="rz-savr-logo">${logoSavr(40, '#223870')}</div>
      <div class="rz-savr-txt"><b>Savr, la gestion des déchets événementiels clé en main.</b> Savr collecte, trie et pèse chaque flux sur place, puis l'achemine vers des filières de valorisation agréées. Vous ne gérez aucune logistique et vous recevez des données mesurées et traçables pour votre reporting CSRD, votre conformité AGEC et vos communications RSE.</div>
    </div>`;
  const caps = (() => {
    const c = data.caps_appliques;
    if (!c) return '';
    const items = (
      [
        ['verre', 'verre'],
        ['carton', 'carton'],
        ['biodechet', 'biodéchets'],
        ['emballage', 'emballages'],
      ] as const
    )
      .flatMap(([cle, libelle]) => {
        // Filière absente du snapshot : pas de ligne (Number(null) vaudrait 0 %).
        const brut = c[cle];
        if (brut == null || brut === '') return [];
        const v = Number(brut);
        if (!Number.isFinite(v)) return [];
        const p = Math.round(v * 1000) / 10;
        return [{ libelle, txt: dec(p, Number.isInteger(p) ? 0 : 1) }];
      })
      // « Captation » ouvre la ligne, quelle que soit la première filière présente.
      .map(
        (f, k) =>
          `<span>${k === 0 ? 'Captation ' : ''}${f.libelle} <b>${f.txt}${INSECABLE}%</b></span>`,
      )
      .join('');
    return items ? `<div class="rz-caps">${items}</div>` : '';
  })();
  const methodologie = `
    <div class="rz-metho">
      <b>Méthodologie.</b> Données mesurées : pesée individuelle par flux, bordereaux horodatés, exutoires référencés. Niveau de qualité conforme à la norme ESRS E5 (mesurée, niveau primaire le plus élevé). Taux de recyclage selon la méthode UE 2019/1004${caps ? ' avec les taux de captation ci-dessous' : ''}. Facteurs carbone ADEME. Rapport utilisable comme pièce justificative pour le reporting CSRD, la conformité AGEC et la sécurisation des communications environnementales. Document confidentiel destiné à l'organisation productrice.
      ${caps}
    </div>`;

  // ── Benchmark : lignes comparables, dans l'ordre du référentiel ────────────
  const lignesBench = (data.benchmark_flux ?? [])
    .filter((g) => g.collecte_kg_pax != null)
    .map((g) => {
      const vous = g.collecte_kg_pax as number;
      const parc = g.benchmark_kg_pax ?? null;
      const comparable = parc != null && parc > 0;
      return {
        ref: refFlux(g.flux_code, g.flux_nom),
        nom: g.flux_nom,
        vous,
        parc,
        ratio: comparable ? vous / parc : null,
      };
    })
    .sort((a, b) => a.ref.rang - b.ref.rang);
  const avecRadar = data.options?.benchmark === true && lignesBench.length > 0;

  const corps = avecRadar ? corpsAvecRadar() : corpsSansRadar();

  function corpsAvecRadar(): string {
    const segments = flux
      .filter((f) => f.poids_kg > 0)
      .map(
        (f) =>
          `<div class="rz-seg" style="flex:0 0 calc(${f.part.toFixed(2)}% - 2px);background:${f.ref.couleur}">${f.part >= 7 ? `<span>${pct(f.part)}</span>` : ''}</div>`,
      )
      .join('');
    const legende = flux
      .map(
        (f) =>
          `<div class="rz-leg-item"><span class="rz-leg-dot" style="background:${f.ref.couleur}"></span><div><div class="rz-leg-nom">${esc(f.nom)}</div><div class="rz-leg-kg">${kg(f.poids_kg)}</div></div></div>`,
      )
      .join('');

    // Un flux sans repère parc (segment masqué) sort du radar ; sous 3 axes, la
    // liste est affichée seule.
    const axes = lignesBench
      .filter((l) => l.ratio != null)
      .map((l) => ({ libelle: l.ref.court, ratio: l.ratio as number }));
    const radar = axes.length >= 3 ? radarSvg(axes) : '';
    const lignes = lignesBench
      .map((l) => {
        // Seuils de l'écran (BenchmarkRadar) : comparés sur le ratio, pas sur
        // l'écart arrondi — à 130 % du parc exactement, le badge reste orange.
        const ecart = l.ratio != null ? (l.ratio - 1) * 100 : null;
        const classe =
          l.ratio == null
            ? 'rz-nd'
            : l.ratio <= 1
              ? 'rz-ok'
              : l.ratio <= 1.3
                ? 'rz-wn'
                : 'rz-bd';
        const badge =
          ecart == null
            ? 'n/d'
            : `${ecart < 0 ? '−' : '+'}${dec(Math.abs(ecart), 0)}${INSECABLE}%`;
        return `<div class="rz-brow"><span class="rz-f"><span class="rz-dot" style="background:${l.ref.couleur}"></span>${esc(l.nom)}</span><span class="rz-kgp">${kgPax(l.vous)} kg/pax</span><span class="rz-pk">${l.parc != null ? `parc ${kgPax(l.parc)}` : 'parc n/d'}</span><span class="rz-bdg ${classe}">${badge}</span></div>`;
      })
      .join('');
    const masque = lignesBench.some((l) => l.ratio == null)
      ? '<div class="rz-mention">n/d : données insuffisantes pour comparer ce flux.</div>'
      : '';
    const legendeFiltres = data.benchmark_legende
      ? `<div class="rz-mention">Benchmark parc Savr calculé sur : ${esc(data.benchmark_legende).replace(' · lieux', '<br>lieux')}.</div>`
      : '';

    return `
  <div class="rz-body rz-body-radar">
    ${meta}
    <div class="rz-duo">
      <div class="rz-card rz-hero rz-pave">
        <div class="rz-h2">Impact carbone</div>
        <div class="rz-chiffre-ligne"><div class="rz-chiffre">${chiffreEvite}</div>${pastilleEvite}</div>
        ${kmVoiture ? `<div class="rz-eq-fort">${kmVoiture}</div>` : ''}
        <div class="rz-kv rz-kv-aere">${lignesCarbone(false)}
        </div>
      </div>
      <div class="rz-card rz-pave">
        <div class="rz-h2">Taux de recyclage</div>
        <div class="rz-chiffre">${taux}</div>
        <div class="rz-methode rz-methode-12">${mentionTaux}</div>
      </div>
    </div>

    <div class="rz-card">
      <div class="rz-h2">Tonnages par flux</div>
      <div class="rz-barre">${segments}</div>
      <div class="rz-leg-grille" style="grid-template-columns:repeat(${Math.max(flux.length, 1)},minmax(0,1fr))">${legende}</div>
      <div class="rz-total">Total collecté <b>${kg(total)}</b></div>
    </div>

    <div class="rz-card">
      <div class="rz-h2">Vos déchets par convive, comparés aux autres événements Savr</div>
      <div class="rz-bench${radar ? '' : ' rz-bench-liste'}">
        ${radar}
        <div>
          <div class="rz-blist">${lignes}</div>
          <div class="rz-leg"><span><span class="rz-sw"></span>Vous</span><span><span class="rz-sw2"></span>Parc Savr (base 100)</span><span>Vert ≤ parc · orange jusqu'à +30${INSECABLE}% · rouge au-delà</span></div>
          ${masque}
          ${legendeFiltres}
        </div>
      </div>
    </div>

    ${encartSavr}
    ${methodologie}
  </div>`;
  }

  function corpsSansRadar(): string {
    // Planche sans radar : flux valorisés du plus lourd au plus léger, le
    // résiduel fermant le tableau et l'anneau.
    const estResiduel = (f: (typeof flux)[number]) =>
      f.ref.code === CODE_RESIDUEL;
    const fluxTries = [
      ...flux.filter((f) => !estResiduel(f)),
      ...flux.filter(estResiduel),
    ];
    const lignesFlux = fluxTries
      .map(
        (f) =>
          `<tr><td><span class="rz-dot" style="background:${f.ref.couleur}"></span>${esc(f.nom)}</td><td class="rz-num">${kg(f.poids_kg)}</td><td class="rz-num">${total > 0 ? pct(f.part) : '—'}</td></tr>`,
      )
      .join('');
    const residuel = flux
      .filter(estResiduel)
      .reduce((s, f) => s + f.poids_kg, 0);
    const repartition =
      total > 0
        ? `<div class="rz-split"><span>Valorisé <b>${kg(total - residuel)}</b> (${pct(((total - residuel) / total) * 100)})</span><span>Résiduel <b>${kg(residuel)}</b> (${pct((residuel / total) * 100)})</span></div>`
        : '';
    // Anneau : circonférence normalisée à 100, même point de départ (décalage
    // 175) et même sens que la maquette.
    let cumul = 0;
    const anneau = fluxTries
      .filter((f) => f.poids_kg > 0)
      .map((f) => {
        const s = `<circle r="15.915" cx="21" cy="21" fill="transparent" stroke="${f.ref.couleur}" stroke-width="6" stroke-dasharray="${f.part.toFixed(2)} ${(100 - f.part).toFixed(2)}" stroke-dashoffset="${(175 - cumul).toFixed(2)}"></circle>`;
        cumul += f.part;
        return s;
      })
      .join('');
    const nbFlux = flux.filter((f) => f.poids_kg > 0).length;

    return `
  <div class="rz-body rz-body-simple">
    ${meta}
    <div class="rz-card rz-hero rz-taux-large">
      <div class="rz-taux-bloc">
        <div class="rz-h2">Taux de recyclage</div>
        <div class="rz-chiffre rz-chiffre-64">${taux}</div>
      </div>
      <div class="rz-methode rz-methode-11">${mentionTaux}</div>
    </div>

    <div class="rz-card rz-card-large">
      <div class="rz-h2">Impact carbone</div>
      <div class="rz-duo-egal">
        <div>
          <div class="rz-chiffre rz-chiffre-40">${chiffreEvite} ${pastilleEvite}</div>
          ${kmVoiture ? `<div class="rz-eq">${kmVoiture}</div>` : ''}
        </div>
        <div class="rz-kv rz-kv-125">${lignesCarbone(true)}
        </div>
      </div>
    </div>

    <div class="rz-card rz-card-large">
      <div class="rz-h2">Tonnages par flux</div>
      <div class="rz-flux">
        <div>
          <table class="rz-tbl">
            <tr><th>Flux</th><th class="rz-num">Poids</th><th class="rz-num">Part</th></tr>
            ${lignesFlux}
            <tr class="rz-tot"><td>Total collecté</td><td class="rz-num">${kg(total)}</td><td class="rz-num">${total > 0 ? `100${INSECABLE}%` : '—'}</td></tr>
          </table>
          ${repartition}
        </div>
        <svg class="rz-donut" viewBox="0 0 42 42" role="img" aria-label="Répartition par flux">
          <circle r="15.915" cx="21" cy="21" fill="transparent" stroke="#eef0f5" stroke-width="6"></circle>
          ${anneau}
          <text x="21" y="20.5" text-anchor="middle" font-size="6.5" font-weight="800" fill="#223870">${entier(total)} kg</text>
          <text x="21" y="25.5" text-anchor="middle" font-size="3.2" font-weight="700" fill="#6e7790">${nbFlux} FLUX</text>
        </svg>
      </div>
    </div>

    ${encartSavr}
    ${methodologie}
  </div>`;
  }

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
${CSS_MARQUE}
${options.cssSuite}</style>
</head>
<body>
${LOGO_DEFS}

<!-- PAGE 1 — Synthèse (${avecRadar ? 'avec radar' : 'sans radar'}) -->
<div class="rz-page" data-version="${avecRadar ? 'avec-radar' : 'sans-radar'}">
  ${bandeau}
  ${corps}
</div>

${options.suite}
</body>
</html>`;
}
