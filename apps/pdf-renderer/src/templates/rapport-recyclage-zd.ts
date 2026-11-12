import type { FluxDetail } from './bordereau-zd.js';
import { NUNITO_WOFF2_BASE64, SAVR_LOGO_MASK } from './assets/marque.js';
import { PICTOS_FLUX } from './assets/pictos-flux.js';
import {
  ARCHIVO_LATIN_WOFF2_BASE64,
  INTER_GREC_WOFF2_BASE64,
  INTER_LATIN_WOFF2_BASE64,
} from './assets/polices-rapport.js';

// Version figée du gabarit — doit rester égale à
// TEMPLATE_VERSIONS['rapport-recyclage-zd'] du contrat partagé (@savr/shared).
// Vérifié par check:pdf-contract.
// @4 (2026-11-12) : maquettes Claude Design version 76 validées par Val, copiées
// dans design/rapport-recyclage/. Page 1 avec radar (comparaison g/convive +
// anneau du taux) si le demandeur l'a coché, sinon avec la jauge du taux. Page 2 =
// annexe technique (traçabilité par flux, bilan carbone induit et évité séparés,
// méthodologie, cadre réglementaire), identique dans les deux cas : elle remplace
// le bordereau de pesée (C1, qui reste un PDF à part) et suit le rapport, quel que
// soit le demandeur (C2). Polices Inter et Archivo embarquées (C6).
// Les rapports d'un événement gardent la page de synthèse @3 (renderSyntheseRecyclage).
export const TEMPLATE_VERSION = 'rapport-recyclage-zd@4';

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

/**
 * Données de la page de synthèse @3, que gardent les rapports cumulés d'un
 * événement (recyclage et don).
 */
export interface SyntheseRecyclageData {
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

/** Ce que l'en-tête des rapports imprime (bandeau et ligne date · lieu · convives). */
export type EnTeteRapportData = Pick<
  SyntheseRecyclageData,
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

// ═════════════════════════════════════════════════════════════════════════════
// Rapport de recyclage d'une collecte — gabarit @4
// ═════════════════════════════════════════════════════════════════════════════
// Balisage et styles recopiés des maquettes (design/rapport-recyclage/) : seules
// les valeurs viennent des données. Radar, anneau et jauge sont calculés avec la
// géométrie de la maquette.

/** Un flux de l'annexe : pesée et référentiel `flux_dechets`, lus au clic. */
export interface FluxRapport {
  nom: string;
  code?: string;
  /** 0 quand le flux n'a pas été pesé (C5 : tuile et ligne gardées). */
  poids_kg: number;
  code_dechet_europeen?: string | null;
  /** Site de traitement habituel du flux (C4 : « Exutoire habituel »). */
  exutoire?: string | null;
  /** Commune tirée de `exutoire_adresse` (« voie, CP ville »). */
  exutoire_commune?: string | null;
  /** Code R/D du référentiel (C4). */
  code_traitement?: string | null;
  filiere_valorisation?: string | null;
}

export interface RapportRecyclageZdData {
  nom_evenement: string;
  /** « JJ/MM/AAAA ». */
  date_evenement: string;
  lieu_nom: string;
  nb_pax?: number | null;
  logo_client_url?: string | null;
  logo_traiteur_url?: string | null;

  /** En %, 0 à 100. */
  taux_recyclage?: number | null;
  flux: FluxRapport[];
  poids_total_kg: number;
  co2_evite_kg?: number | null;
  co2_induit_kg?: number | null;
  energie_primaire_evitee_kwh?: number | null;
  equivalences?: { km_voiture?: number | null } | null;
  /** Forfait transport ajouté par prudence (snapshot `forfait_collecte`). */
  forfait_transport?: { km: number; fe_camion_kg_km: number } | null;
  /** Taux de captation figés à la clôture (`collectes.caps_appliques`). */
  caps_appliques?: Record<string, unknown> | null;

  bordereau_numero: string;
  /** « JJ/MM/AAAA ». */
  bordereau_date_emission: string;

  // Le radar n'apparaît que si le demandeur l'a choisi.
  options?: { benchmark?: boolean } | null;
  benchmark_flux?: BenchmarkFluxGauge[] | null;
  /** Collectes du segment comparé (le plus grand effectif parmi les flux). */
  benchmark_effectif?: number | null;
  /** Critères de comparaison en clair (« taille M, type : Cocktail »). */
  benchmark_criteres?: string | null;
}

// Ordre des tuiles et du tableau = celui de la maquette ; libellés et couleurs
// de texte aussi (les pictos portent leurs propres couleurs).
const FLUX_V4 = [
  { code: 'emballage', libelle: 'Emballages', couleur: '#9a6a0c' },
  { code: 'biodechet', libelle: 'Biodéchets', couleur: '#0b7a40' },
  { code: 'verre', libelle: 'Verre', couleur: '#09337a' },
  { code: 'carton', libelle: 'Cartons', couleur: '#6b4f37' },
  { code: 'dechet_residuel', libelle: 'Déchet résiduel', couleur: '#515a72' },
] as const;

/** Axes du radar, sens horaire depuis le haut, libellés placés comme la maquette. */
const AXES_RADAR = [
  { code: 'biodechet', x: 100, y: -14, ancre: 'middle' },
  { code: 'emballage', x: 184, y: 68, ancre: 'start' },
  { code: 'carton', x: 122, y: 190, ancre: 'start' },
  { code: 'verre', x: 78, y: 190, ancre: 'end' },
  { code: 'dechet_residuel', x: 12, y: 68, ancre: 'end' },
] as const;

const TRAITEMENT: Record<string, string> = {
  recyclage: 'recyclage',
  methanisation: 'méthanisation, digestat retourné au sol',
  compostage: 'compostage',
  valorisation_energetique: "incinération avec récupération d'énergie",
  enfouissement: 'enfouissement',
};

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** « 18/03/2025 » → « 18 mars 2025 » (toute autre forme est rendue telle quelle). */
function dateLongue(jjmmaaaa: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(jjmmaaaa);
  const mois = m ? MOIS[Number(m[2]) - 1] : undefined;
  return m && mois ? `${Number(m[1])} ${mois} ${m[3]}` : jjmmaaaa;
}

/**
 * Garde-fous de mise en page, sans effet aux valeurs de la maquette : titre
 * coupé à deux lignes, lieu à une, chiffre des tuiles réduit au-delà de 3
 * chiffres (« 113 268 kg » ne tient pas en 34px dans une tuile).
 */
const TITRE_DEUX_LIGNES =
  ' display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;';
const UNE_LIGNE =
  ' max-width: 440px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
function taillePoidsTuile(kilos: number): string {
  const chiffres = String(Math.round(kilos)).length;
  return chiffres <= 3
    ? ''
    : chiffres === 4
      ? ' font-size: 28px;'
      : ' font-size: 21px;';
}
// Marge sous l'encart de la version avec radar : 27,484375px + les 7px du bas de
// <main> = l'encart s'arrête à 1087,515625px, au 1/64 de pixel où la maquette
// le pose (ses 34px de marge la faisaient déborder de 6,515625px dans le vide,
// invisible ; ici ce débordement serait pris sur les écarts). La version jauge
// tient sur la page : 34px, comme la maquette.
// Écarts de 18px entre les blocs de la page 1 (le `gap` de la maquette), qui se
// réduisent jusqu'à 4px quand un titre sur deux lignes ou de gros chiffres ne
// tiendraient pas. Aux valeurs de la maquette, rien ne change.
const INTERCALAIRE_P1 =
  '<div aria-hidden="true" style="flex: 0 1 18px; min-height: 4px;"></div>';

/** Poids de l'annexe : entier quand il l'est, sinon une décimale. */
const kgAnnexe = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? entier(r) : dec(r, 1)}${INSECABLE}kg`;
};

// Tracé limité à x 1-550, y 1-148 (le logo s'arrête avant) : dans le PDF, le
// bord de l'image-masque se lissait en un filet visible sous le logo.
const LOGO_V4_COIN = `<rect x="1" y="1" width="549" height="147" fill="#ffffff" mask="url(#rz-logo-masque)"/><g clip-path="url(#rz-logo-coin)"><rect x="1" y="1" width="549" height="147" fill="#16a34a" mask="url(#rz-logo-masque)"/></g>`;

/** Logo « + savr » complet, blanc à coin vert (celui de la maquette). */
export function logoSavrComplet(
  largeur: number,
  hauteur: number,
  style: string,
) {
  return `<svg viewBox="0 0 551 150" width="${largeur}" height="${hauteur}" preserveAspectRatio="none" role="img" aria-label="Savr" style="${style}">${LOGO_V4_COIN}</svg>`;
}

const CROIX_DECOR =
  'M-47 47V-99A47 47 0 0 1 47 -99V-47H99A47 47 0 0 1 99 47Z M-47 -47H-99A47 47 0 0 0 -99 47H-47Z M-47 47V99A47 47 0 0 0 47 99V47Z';
const croix = (taille: number, style: string, couleur: string) =>
  `<svg aria-hidden="true" viewBox="-150 -150 300 300" width="${taille}" height="${taille}" style="${style}"><path fill="${couleur}" d="${CROIX_DECOR}"></path></svg>`;

const H2_P1 =
  'margin: 0; font-family: Archivo, Inter, sans-serif; font-size: 22px; font-weight: 800; color: #223870; letter-spacing: -0.01em;';

const ENCART_SAVR = `<section aria-label="Présentation de Savr" style="__MARGE__display: flex; gap: 22px; align-items: center; background: #223870; border-radius: 12px; padding: 16px 24px;">
      ${logoSavrComplet(118, 32, 'display: block; flex-shrink: 0;')}
      <div style="display: flex; flex-direction: column; gap: 3px; font-size: 12px; line-height: 1.45; color: #dde4f5;"><b style="color: #ffffff; font-weight: 800; font-size: 13px;">Savr, deux services distincts pour vos événements, clé en main.</b><span style="display: flex; gap: 8px;"><span style="display: inline-block; min-width: 84px; font-weight: 800; color: #ffbd59; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;">Zéro déchet</span><span>Vos déchets triés, pesés et envoyés en filières de valorisation agréées.</span></span><span style="display: flex; gap: 8px;"><span style="display: inline-block; min-width: 84px; font-weight: 800; color: #ffbd59; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;">Anti-gaspi</span><span>Vos repas non servis donnés à des associations d'aide alimentaire.</span></span><span>Aucune logistique à gérer, des données traçables pour votre reporting CSRD et AGEC.</span></div>
    </section>`;
const encartSavr = (marge: string) => ENCART_SAVR.replace('__MARGE__', marge);

/** Mentions fixes du pied de l'annexe (texte de la maquette). */
export const MENTIONS_EMETTEUR =
  'Émetteur et transporteur : Savr, 50 rue des Moines, 75017 Paris · RCS Paris 879 642 890';
export const MENTION_RECEPISSE =
  'Récépissé de déclaration de transport de déchets n° T 26-011, Préfecture de police, 27/04/2026';

export const CSS_RAPPORT_V4 = `@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 800; src: url(data:font/woff2;base64,${INTER_LATIN_WOFF2_BASE64}) format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 800; src: url(data:font/woff2;base64,${INTER_GREC_WOFF2_BASE64}) format('woff2'); unicode-range: U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF; }
@font-face { font-family: 'Archivo'; font-style: normal; font-weight: 600 900; font-stretch: 100%; src: url(data:font/woff2;base64,${ARCHIVO_LATIN_WOFF2_BASE64}) format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@page { size: A4; margin: 0; }
body{margin:0}
a{color:#223870}a:hover{color:#15213f}
/* Hauteur 1122px (et non 1123px comme la maquette) : une page A4 fait 1122,5px,
   un pixel de plus pousserait une page blanche. */
.pg-1{position:relative;width:794px;height:1122px;overflow:hidden;background:#ffffff;font-family:Inter,system-ui,sans-serif;color:#161a26;font-size:12px;line-height:1.35;display:flex;flex-direction:column}
/* Seuls les intercalaires se resserrent quand la page est pleine, jamais les blocs. */
.pg-1 main > *, .pg main > * { flex-shrink: 0; }
.pg-1 main > [aria-hidden], .pg main > [aria-hidden] { flex-shrink: 1; }
.pg{position:relative;width:794px;height:1122px;overflow:hidden;background:#fff;font-family:Inter,system-ui,sans-serif;color:#161a26;font-size:11px;line-height:1.4;display:flex;flex-direction:column;break-before:page}
.pg h2{margin:0 0 7px;font-family:Archivo,Inter,sans-serif;font-size:15px;font-weight:800;color:#223870;letter-spacing:-0.01em;display:flex;align-items:baseline;gap:8px}
.pg h2 i{font-style:normal;font-size:11px;font-weight:800;color:#12a459;font-family:Inter,sans-serif}
.pg h2 small{font-family:Inter,sans-serif;font-size:11px;font-weight:500;color:#6e7790}
.pg table{width:100%;border-collapse:collapse;font-size:11px}
.pg th{text-align:left;font-weight:700;color:#fff;background:#223870;padding:6px 6px;font-size:11px;line-height:1.25;vertical-align:bottom}
.pg th:first-child{border-top-left-radius:8px} .pg th:last-child{border-top-right-radius:8px}
.pg td{padding:6px 6px;border-bottom:1px solid #e3e7ef;vertical-align:middle;line-height:1.35;color:#3c4459}
.pg tr:nth-child(even) td{background:#f7f8fb}
.fx{display:flex;align-items:center;gap:6px;white-space:nowrap} .fx img{height:22px;width:22px;object-fit:contain}
.mono{font-variant-numeric:tabular-nums;white-space:nowrap} .num{text-align:right;font-weight:800;color:#161a26;white-space:nowrap;font-variant-numeric:tabular-nums}
.pg tfoot td{background:#eef1f7!important;font-weight:800;color:#223870;border-bottom:none}
.box{border:1.5px solid #e3e7ef;border-radius:12px;padding:10px 12px}
.pg ul{margin:0;padding-left:15px} .pg li{margin:0 0 3px} .pg li::marker{color:#12a459}`;

/** Rapport de recyclage d'une collecte ZD (gabarit @4). */
export function renderRapportRecyclageZd(data: RapportRecyclageZdData): string {
  const total = data.poids_total_kg;
  const pax = data.nb_pax != null && data.nb_pax > 0 ? data.nb_pax : null;

  // Les 5 flux du référentiel, toujours imprimés (C5 : non pesé = 0 kg).
  const parCode = new Map(
    data.flux.filter((f) => f.code).map((f) => [f.code as string, f]),
  );
  const flux = FLUX_V4.map((r) => {
    const f = parCode.get(r.code);
    return {
      ...r,
      poids: f ? Number(f.poids_kg) || 0 : 0,
      ligne: f ?? null,
      picto: PICTOS_FLUX[r.code] ?? '',
    };
  });

  // ── Taux de recyclage ──────────────────────────────────────────────────────
  const taux = data.taux_recyclage ?? null;
  const tauxTxt = taux != null ? pct(taux) : '—';
  const nonRecycleTxt = taux != null ? pct(100 - taux) : '—';
  const recycleKg = taux != null ? Math.round((total * taux) / 100) : null;

  // ── Benchmark : comparable = valeur de la collecte ET repère du parc ───────
  const bench = new Map(
    (data.benchmark_flux ?? [])
      .filter((g) => g.flux_code)
      .map((g) => [g.flux_code as string, g]),
  );
  const comparables = AXES_RADAR.filter((a) => {
    const g = bench.get(a.code);
    return (
      g?.collecte_kg_pax != null &&
      g.benchmark_kg_pax != null &&
      g.benchmark_kg_pax > 0
    );
  });
  const avecRadar = data.options?.benchmark === true && comparables.length > 0;

  const nom = esc(data.nom_evenement);
  const lieu = esc(data.lieu_nom);
  const date = esc(dateLongue(data.date_evenement));
  const convives = pax ? `${entier(pax)} convives` : '';

  // ── Page 1 : bandeau ───────────────────────────────────────────────────────
  const boiteLogo = (url: string) =>
    `<div style="width: 120px; height: 120px; border-radius: 12px; background: #ffffff; box-sizing: border-box; padding: 12px; display: flex; align-items: center; justify-content: center;"><img src="${esc(url)}" alt="" style="max-width: 100%; max-height: 100%; object-fit: contain; display: block;"></div>`;
  const logos = [data.logo_client_url, data.logo_traiteur_url]
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map(boiteLogo)
    .join('');
  const pilule = (icone: string, texte: string) =>
    `<span style="display: inline-flex; align-items: center; gap: 7px; border: 1.5px solid rgba(255,255,255,0.35); border-radius: 9999px; padding: 5px 13px; font-size: 12px; font-weight: 700;">${icone}${texte}</span>`;
  const iconeDate =
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#ffbd59" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>';
  const iconeConvives =
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#ffbd59" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"></circle><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"></path><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.8 3.5 6"></path></svg>';

  const bandeau = `<header style="position: relative; flex-shrink: 0; overflow: hidden; background: #223870; color: #ffffff; padding: 24px 48px 26px; border-bottom-right-radius: 44px;">
    ${croix(280, 'position: absolute; right: -70px; top: -120px; transform: rotate(-45deg);', '#2b4a91')}
    ${croix(160, 'position: absolute; right: 170px; bottom: -95px; transform: rotate(-45deg);', '#1d5c63')}
    <div style="position: relative; min-height: 52px; display: flex; justify-content: space-between; align-items: flex-start;">
      ${logoSavrComplet(140, 38, 'display: block;')}
      ${logos ? `<div style="position: absolute; right: 0; top: 0; display: flex; gap: 10px;">${logos}</div>` : ''}
    </div>
    <p style="position: relative; margin: 2px 0 0; font-size: 12px; font-weight: 800; letter-spacing: 0.22em; color: #ffbd59;">RAPPORT DE RECYCLAGE</p>
    <h1 style="position: relative; margin: 2px 0 0; max-width: 440px; font-family: Archivo, Inter, sans-serif; font-size: 36px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.08;${TITRE_DEUX_LIGNES}">${nom}</h1>
    <p style="position: relative; margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #dde4f5;${UNE_LIGNE}">${lieu}</p>
    <div style="position: relative; display: flex; flex-wrap: wrap; gap: 9px; margin-top: 12px;">
      ${pilule(iconeDate, date)}
      ${convives ? pilule(iconeConvives, convives) : ''}
    </div>
  </header>`;

  // ── Page 1 : tuiles des flux ───────────────────────────────────────────────
  const tuiles = flux
    .map(
      (
        f,
      ) => `<div style="border-radius: 14px; padding: 12px 8px 14px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 5px;">
        <img src="${f.picto}" alt="" style="height: 64px; width: auto; max-width: 100%; display: block; margin: 0 auto;">
        <span style="font-size: 12.5px; font-weight: 800; letter-spacing: 0.02em; color: ${f.couleur}; margin-top: 2px;">${f.libelle}</span><span style="font-family: Archivo, Inter, sans-serif; font-size: 34px; font-weight: 800; color: ${f.couleur}; letter-spacing: -0.02em; line-height: 1;${taillePoidsTuile(f.poids)}">${entier(f.poids)}<span style="font-size: 17px; font-weight: 700;"> kg</span></span><span style="font-size: 11px; font-weight: 700; color: ${f.couleur}; background: #f2f4f5; border-radius: 9999px; padding: 1px 8px;">${total > 0 ? Math.round((f.poids / total) * 100) : 0}${INSECABLE}% du total</span>
      </div>`,
    )
    .join('\n      ');
  const parConvive = pax
    ? ` · <b style="color: #223870; font-weight: 800;">${entier((total * 1000) / pax)}${INSECABLE}g</b> par convive`
    : '';
  const sectionFlux = `<section>
      <div style="display: flex; flex-direction: column; gap: 3px;"><h2 style="${H2_P1}">Les déchets collectés lors de votre événement</h2><span style="font-size: 12px; color: #223870;"><b style="font-family: Archivo, Inter, sans-serif; font-size: 18px; font-weight: 800; color: #223870;">${entier(total)}${INSECABLE}kg</b> collectés${parConvive}</span></div>
    <div style="margin-top: 8px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 9px;">
      ${tuiles}
    </div>
    </section>`;

  // ── Légende Recyclé / Non recyclé (anneau et jauge) ────────────────────────
  const ligneLegende = (
    couleur: string,
    titre: string,
    detail: string,
    valeur: string,
  ) =>
    `<div style="display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: start;"><span style="width: 10px; height: 10px; border-radius: 3px; background: ${couleur}; margin-top: 2px;"></span><span style="color: #3c4459;"><b style="color: #161a26;">${titre}</b><br><span style="font-size: 10.5px; color: #6e7790;">${detail}</span></span><b style="font-weight: 800;">${valeur}</b></div>`;
  const DETAIL_RECYCLE = 'verre, cartons, biodéchets, emballages';
  const DETAIL_NON_RECYCLE = 'déchet résiduel et refus de tri';
  const ariaTaux =
    taux != null
      ? `Recyclé ${tauxTxt}, non recyclé ${nonRecycleTxt}`
      : 'Taux de recyclage non disponible';
  const sousTitreTaux = `<p style="margin: 2px 0 0; font-size: 11px; color: #515a72;">Part des ${entier(total)}${INSECABLE}kg recyclée, estimée flux par flux.</p>`;

  // ── Page 1 : radar + anneau, ou jauge seule ────────────────────────────────
  const blocComparaison = avecRadar ? sectionRadarEtAnneau() : sectionJauge();

  function radarV4(): string {
    const point = (i: number, r: number) => {
      const a = ((-90 + 72 * i) * Math.PI) / 180;
      return { x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) };
    };
    const poly = (r: number) =>
      AXES_RADAR.map((_, i) => {
        const p = point(i, r);
        return `${+p.x.toFixed(1)},${+p.y.toFixed(1)}`;
      }).join(' ');
    // « Votre collecte » : base 100 = moyenne (rayon 56), bornée à l'anneau
    // extérieur (rayon 84, 150 % de la moyenne). Un flux sans repère n'a pas de
    // sommet : on n'invente pas sa position.
    const sommets = AXES_RADAR.flatMap((a, i) => {
      if (!comparables.includes(a)) return [];
      const g = bench.get(a.code) as BenchmarkFluxGauge;
      const ratio =
        (g.collecte_kg_pax as number) / (g.benchmark_kg_pax as number);
      const p = point(i, Math.min(84, 56 * ratio));
      return [{ x: +p.x.toFixed(1), y: +p.y.toFixed(1) }];
    });
    const g = (v: number | null | undefined) =>
      v != null ? `${entier(v * 1000)}${INSECABLE}g` : 'n/d';
    const libelles = AXES_RADAR.map((a) => {
      const b = bench.get(a.code);
      const libelle = FLUX_V4.find((f) => f.code === a.code)?.libelle ?? a.code;
      return `<text x="${a.x}" y="${a.y}" text-anchor="${a.ancre}">${libelle}</text>
            <text x="${a.x}" y="${a.y + 18}" text-anchor="${a.ancre}" font-size="16.5" font-weight="500" fill="#515a72"><tspan font-weight="800" fill="#161a26">${g(b?.collecte_kg_pax)}</tspan> · moy. ${g(b?.benchmark_kg_pax)}</text>`;
    }).join('\n            ');
    return `<svg role="img" aria-label="Radar des grammes par convive : votre collecte face à la moyenne des événements comparables" viewBox="-140 -32 476 244" width="322" height="165" style="display: block; margin: 6px auto 0;">
          <polygon points="${poly(84)}" fill="#f7f8fb" stroke="#e3e7ef" stroke-width="1"></polygon>
          <polygon points="${poly(28)}" fill="none" stroke="#eef0f5" stroke-width="1"></polygon>
          <polygon points="${poly(56)}" fill="none" stroke="#223870" stroke-width="1.2" stroke-dasharray="3 2.5"></polygon>
          <text x="104" y="52" font-size="9" fill="#92a3d2" font-family="Inter, sans-serif">100</text>
          ${sommets.length >= 2 ? `<polygon points="${sommets.map((p) => `${p.x},${p.y}`).join(' ')}" fill="#ffd699" fill-opacity="0.55" stroke="#ff9b00" stroke-width="2" stroke-linejoin="round"></polygon>` : ''}
          ${sommets.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2.4" fill="#ff9b00"></circle>`).join('\n          ')}
          <g font-family="Inter, sans-serif" font-size="18.5" font-weight="600" fill="#3c4459">
            ${libelles}
          </g>
        </svg>`;
  }

  function sectionRadarEtAnneau(): string {
    // Anneau : circonférence normalisée à 100, départ à midi (décalage 25).
    const arc =
      taux != null
        ? `<circle r="15.915" cx="21" cy="21" fill="none" stroke="#12a459" stroke-width="7" stroke-dasharray="${+taux.toFixed(2)} ${+(100 - taux).toFixed(2)}" stroke-dashoffset="25"></circle>`
        : '';
    return `<section style="display: grid; grid-template-columns: 1.2fr 1fr; grid-template-rows: auto auto 1fr; column-gap: 12px;">
      <div style="display: grid; grid-template-rows: subgrid; grid-row: span 3; align-content: start;">
        <h2 style="${H2_P1}">Vos résultats face aux événements comparables</h2>
        <p style="margin: 2px 0 0; font-size: 11px; color: #515a72;">Déchets par convive (g/pax) face à la moyenne Savr sur 24 mois.</p>
      <div style="margin-top: 8px; border: 1.5px solid #e3e7ef; border-radius: 16px; padding: 10px 16px; display: flex; flex-direction: column;">
        ${radarV4()}
        <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 14px; font-size: 10.5px; color: #515a72; margin-top: 14px;">
          <span><span style="display: inline-block; width: 14px; height: 9px; border-radius: 3px; background: #ffd699; border: 1.5px solid #ff9b00; margin-right: 6px; vertical-align: middle;"></span>Votre collecte</span>
          <span><span style="display: inline-block; width: 16px; border-top: 1.5px dashed #223870; margin-right: 6px; vertical-align: middle;"></span>Moyenne des événements comparables</span>
        </div>
      </div>
      </div>

      <div style="display: grid; grid-template-rows: subgrid; grid-row: span 3; align-content: start;">
        <h2 style="${H2_P1}">Votre taux de recyclage</h2>
        ${sousTitreTaux}
      <div style="margin-top: 8px; border: 1.5px solid #e3e7ef; border-radius: 16px; padding: 10px 16px; display: flex; flex-direction: column;">
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; margin-top: 8px;">
          <svg role="img" aria-label="${ariaTaux}" viewBox="0 0 42 42" width="132" height="132">
            <circle r="15.915" cx="21" cy="21" fill="none" stroke="#223870" stroke-width="7"></circle>
            ${arc}
            <text x="21" y="23.2" text-anchor="middle" font-size="7" font-weight="800" fill="#11743f" font-family="Archivo, Inter, sans-serif">${tauxTxt}</text>
          </svg>
          <div style="width: 100%; display: flex; flex-direction: column; gap: 6px; font-size: 11.5px;">
            ${ligneLegende('#12a459', 'Recyclé', DETAIL_RECYCLE, tauxTxt)}
            ${ligneLegende('#223870', 'Non recyclé', DETAIL_NON_RECYCLE, nonRecycleTxt)}
          </div>
        </div>
      </div>
      </div>
    </section>`;
  }

  function sectionJauge(): string {
    const recycleTxt =
      recycleKg != null
        ? `${entier(recycleKg)}${INSECABLE}kg · ${tauxTxt}`
        : '—';
    const nonRecycleKgTxt =
      recycleKg != null
        ? `${entier(Math.max(0, Math.round(total) - recycleKg))}${INSECABLE}kg · ${nonRecycleTxt}`
        : '—';
    return `<section>
      <h2 style="${H2_P1}">Votre taux de recyclage</h2>
      ${sousTitreTaux}
      <div style="margin-top: 8px; border: 1.5px solid #e3e7ef; border-radius: 16px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; align-items: baseline; gap: 10px;"><span style="font-family: Archivo, Inter, sans-serif; font-size: 34px; font-weight: 800; color: #11743f; letter-spacing: -0.02em; line-height: 1;">${tauxTxt}</span><span style="font-size: 12px; color: #515a72; font-weight: 600;">de vos déchets recyclés${recycleKg != null ? `, soit ${entier(recycleKg)}${INSECABLE}kg` : ''}</span></div>
        <div role="img" aria-label="${ariaTaux}" style="position: relative; display: flex; height: 22px; border-radius: 9999px; overflow: hidden; background: #223870;">
          <div style="width: ${taux != null ? +Math.min(100, Math.max(0, taux)).toFixed(2) : 0}%; background: #12a459;"></div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: 11.5px;">
          ${ligneLegende('#12a459', 'Recyclé', DETAIL_RECYCLE, recycleTxt)}
          ${ligneLegende('#223870', 'Non recyclé', DETAIL_NON_RECYCLE, nonRecycleKgTxt)}
        </div>
      </div>
    </section>`;
  }

  // ── Page 1 : bénéfice du tri (C3 : tuile énergie primaire conservée) ───────
  const evite = data.co2_evite_kg;
  const km = data.equivalences?.km_voiture;
  const energie = data.energie_primaire_evitee_kwh;
  const tuileBenefice = (
    icone: string,
    chiffre: string,
    couleur: string,
    texte: string,
  ) =>
    `<div style="display: flex; align-items: center; gap: 14px; border: 1.5px solid #e3e7ef; border-radius: 16px; padding: 11px 18px; background: #ffffff;">
        ${icone}
        <div><div style="font-family: Archivo, Inter, sans-serif; font-size: 23px; font-weight: 800; color: ${couleur}; letter-spacing: -0.02em; line-height: 1.05;">${chiffre}</div><div style="font-size: 11px; color: #515a72; font-weight: 500; margin-top: 2px;">${texte}</div></div>
      </div>`;
  const sectionBenefice = `<section>
      <h2 style="${H2_P1}">Le bénéfice de votre tri</h2>
    <div style="margin-top: 8px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;">
      ${tuileBenefice(
        '<svg aria-hidden="true" viewBox="0 0 48 32" width="40" height="27" style="flex-shrink: 0;"><path d="M12 30a10 10 0 0 1-1-20 13 13 0 0 1 25 2 9 9 0 0 1 1 18z" fill="#12a459"></path></svg>',
        evite != null ? `${entier(evite)}${INSECABLE}kg` : '—',
        '#11743f',
        `CO₂e évités${evite != null && km != null ? ` · ≈${INSECABLE}${entier(km)}${INSECABLE}km en voiture` : ''}`,
      )}
      ${tuileBenefice(
        '<svg aria-hidden="true" viewBox="0 0 32 40" width="27" height="34" style="flex-shrink: 0;"><path d="M19 2L5 23h10l-3 15 15-22H17z" fill="#12a459"></path></svg>',
        energie != null ? `${entier(energie)}${INSECABLE}kWh` : '—',
        '#223870',
        "d'énergie primaire économisée",
      )}
    </div>
    </section>`;

  const page1 = `<div class="pg-1" data-version="${avecRadar ? 'avec-radar' : 'sans-radar'}">

  ${croix(250, 'position: absolute; left: -80px; bottom: -70px; transform: rotate(-45deg);', '#e3f4ea')}
  ${croix(170, 'position: absolute; right: -55px; bottom: 130px; transform: rotate(-45deg);', '#eef1f7')}

  ${bandeau}

  <main style="position: relative; flex: 1; min-height: 0; padding: 26px 48px 0; display: flex; flex-direction: column;${avecRadar ? '' : ' justify-content: space-between;'} padding-bottom: 7px;">

    ${sectionFlux}
    ${INTERCALAIRE_P1}

    ${blocComparaison}
    ${INTERCALAIRE_P1}

    ${sectionBenefice}
    ${INTERCALAIRE_P1}

    ${encartSavr(avecRadar ? 'margin-top: auto; margin-bottom: 27.484375px; ' : 'margin-bottom: 34px; ')}
  </main>

</div>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Rapport de recyclage</title>
<style>
${CSS_RAPPORT_V4}
</style>
</head>
<body>
${LOGO_DEFS}
<!-- PAGE 1 — ${avecRadar ? 'avec radar' : 'sans radar (jauge)'} -->
${page1}
<!-- PAGE 2 — annexe technique -->
${annexeTechnique(data, flux, avecRadar)}
</body>
</html>`;
}

// Écart de 34px entre les blocs de l'annexe (le `gap` de la maquette), qui se
// réduit jusqu’à 8px quand les données réelles (noms d'exutoires longs) ne
// tiendraient pas sur la page. Aux valeurs de la maquette, rien ne change.
const EXUTOIRE_SUR_UNE_LIGNE = 24;
const INTERCALAIRE =
  '<div aria-hidden="true" style="flex:0 1 34px;min-height:8px"></div>';

/** Page 2 : annexe technique, identique avec ou sans radar (sauf la ligne de comparaison). */
function annexeTechnique(
  data: RapportRecyclageZdData,
  flux: {
    code: string;
    libelle: string;
    couleur: string;
    poids: number;
    ligne: FluxRapport | null;
    picto: string;
  }[],
  avecRadar: boolean,
): string {
  const pax = data.nb_pax != null && data.nb_pax > 0 ? data.nb_pax : null;
  const sousTitre = [
    esc(data.nom_evenement),
    esc(data.lieu_nom),
    esc(dateLongue(data.date_evenement)),
    pax ? `${entier(pax)} convives` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const lignes = flux
    .map((f) => {
      const l = f.ligne;
      const exutoireBrut = [l?.exutoire, l?.exutoire_commune]
        .filter((v): v is string => !!v && v.trim().length > 0)
        .join(', ');
      const exutoire = esc(exutoireBrut);
      // Sur une ligne comme la maquette tant que c'est court ; les noms réels du
      // référentiel (jusqu'à 60 signes) passent à la ligne, sinon la colonne
      // Traitement s'écrase et l'annexe déborde de l'A4.
      const styleExutoire =
        exutoireBrut.length <= EXUTOIRE_SUR_UNE_LIGNE
          ? ' style="white-space:nowrap"'
          : '';
      const traitement = [
        l?.code_traitement ? esc(l.code_traitement) : '',
        l?.filiere_valorisation
          ? esc(TRAITEMENT[l.filiere_valorisation] ?? l.filiere_valorisation)
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<tr><td><span class="fx"><img src="${f.picto}" alt=""><b style="color:${f.couleur}">${f.libelle}</b></span></td><td class="mono">${esc(l?.code_dechet_europeen) || '—'}</td><td class="num">${kgAnnexe(f.poids)}</td><td${styleExutoire}>${exutoire || '—'}</td><td>${traitement || '—'}</td></tr>`;
    })
    .join('\n');
  const total = data.poids_total_kg;

  const induit = data.co2_induit_kg;
  const evite = data.co2_evite_kg;
  const forfait = data.forfait_transport;
  const majoration =
    forfait != null ? Math.round(forfait.km * forfait.fe_camion_kg_km) : null;
  const kgCo2 = (v: number | null | undefined) =>
    v != null ? `${entier(v)}${INSECABLE}kg CO₂e` : '—';

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
    ).flatMap(([cle, libelle]) => {
      // Filière absente du snapshot : rien (Number(null) vaudrait 0 %).
      const brut = c[cle];
      if (brut == null || brut === '') return [];
      const v = Number(brut);
      if (!Number.isFinite(v)) return [];
      const p = Math.round(v * 1000) / 10;
      return [`${dec(p, Number.isInteger(p) ? 0 : 1)}${INSECABLE}% ${libelle}`];
    });
    return items.length ? ` ; captation ${items.join(', ')}` : '';
  })();

  const transport = forfait
    ? `Transport : déjà compté dans les facteurs ADEME ; Savr ajoute par prudence un forfait de ${dec(forfait.km, Number.isInteger(forfait.km) ? 0 : 1)}${INSECABLE}km aller-retour × ${dec(forfait.fe_camion_kg_km, 1)}${INSECABLE}kg CO₂e/km (camion 20 m³, diesel)`
    : 'Transport : déjà compté dans les facteurs ADEME ; Savr ajoute par prudence un forfait de transport (camion 20 m³, diesel)';
  const comparaison = avecRadar
    ? `<li>Comparaison aux événements : moyenne Savr sur 24 mois${data.benchmark_effectif ? `, ${entier(data.benchmark_effectif)} collecte${data.benchmark_effectif > 1 ? 's' : ''}` : ''}${data.benchmark_criteres ? `, critères ${esc(data.benchmark_criteres)}` : ''}</li>`
    : '';

  return `<div class="pg">

  <header style="position:relative;flex-shrink:0;overflow:hidden;background:#223870;color:#fff;padding:14px 40px 13px;border-bottom-right-radius:28px;display:flex;justify-content:space-between;align-items:center;gap:16px">
    <div style="position:relative">
      <p style="margin:0;font-size:10.5px;font-weight:800;letter-spacing:0.2em;color:#ffbd59">RAPPORT DE RECYCLAGE · ANNEXE</p>
      <h1 style="margin:2px 0 0;font-family:Archivo,Inter,sans-serif;font-size:21px;font-weight:800;letter-spacing:-0.01em;line-height:1.15">Annexe technique – Traçabilité et méthodologie</h1>
      <p style="margin:3px 0 0;font-size:11.5px;font-weight:600;color:#dde4f5">${sousTitre}</p>
      <p style="margin:3px 0 0;font-size:11px;color:#dde4f5">Bordereau n° ${esc(data.bordereau_numero)} · Date d'émission : ${esc(data.bordereau_date_emission)}</p>
    </div>
    ${logoSavrComplet(110, 30, 'position:relative;display:block;flex-shrink:0')}
  </header>

  <main style="position:relative;flex:1;min-height:0;padding:18px 40px 0;display:flex;flex-direction:column">

    <section>
      <h2><i>1</i>Traçabilité par flux</h2>
      <table>
        <thead><tr><th>Flux</th><th>Code déchet</th><th style="text-align:right">Poids net</th><th>Exutoire habituel</th><th>Traitement (code R/D)</th></tr></thead>
        <tbody>
${lignes}
        </tbody>
        <tfoot><tr><td>Total</td><td></td><td class="num" style="color:#223870">${kgAnnexe(total)}</td><td colspan="2"></td></tr></tfoot>
      </table>
      <p style="margin:5px 0 0;font-size:11px;color:#6e7790">Déchets dangereux : 0 kg</p>
    </section>
    ${INTERCALAIRE}

    <section>
      <h2><i>2</i>Bilan carbone</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="box">
          <span style="font-weight:700;color:#3c4459">Émissions induites (collecte + traitement)</span>
          <div style="font-family:Archivo,Inter,sans-serif;font-size:20px;font-weight:800;color:#223870;margin:2px 0">${kgCo2(induit)}</div>
          <span style="color:#6e7790">${majoration != null ? `Dont ${entier(majoration)}${INSECABLE}kg de majoration prudente pour le transport. ` : ''}À intégrer au scope 3, catégorie 5 – déchets générés.</span>
        </div>
        <div class="box" style="border-color:#bfe6cf">
          <span style="font-weight:700;color:#3c4459">Émissions évitées</span>
          <div style="font-family:Archivo,Inter,sans-serif;font-size:20px;font-weight:800;color:#11743f;margin:2px 0">${kgCo2(evite)}</div>
          <span style="color:#6e7790">Présentées séparément, non déductibles de l'inventaire. Elles peuvent être plus faibles que les émissions induites : traiter des déchets émet toujours du CO₂, et le recyclage n'en compense qu'une partie.</span>
        </div>
      </div>
    </section>
    ${INTERCALAIRE}

    <section style="display:grid;grid-template-columns:1.15fr 1fr;gap:24px">
      <div>
        <h2><i>3</i>Méthodologie</h2>
        <ul>
          <li>Facteurs d'émission : <a href="https://base-empreinte.ademe.fr/" style="color:#11743f;text-decoration:underline">Base Carbone® ADEME</a> V23.6, facteur du traitement appliqué à chaque flux (verre 34472/34473, carton 34480/34481, biodéchets 34636/34637, résiduel 34650/34651)</li>
          <li>Emballages : facteur moyen pondéré par la composition du bac (hypothèse Savr, dont 30 % de refus de tri), mise à jour par des études de caractérisation régulières</li>
          <li>${transport}</li>
          <li>Taux de recyclage : Σ (poids × taux de captation) ÷ poids total${caps}</li>
          ${comparaison}
        </ul>
      </div>
      <div>
        <h2><i>4</i>Cadre réglementaire</h2>
        <ul>
          <li>Tri à la source des biodéchets (art. L541-21-1 C. env.)</li>
          <li>Calcul du taux de recyclage : <a href="https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32019D1004" style="color:#11743f;text-decoration:underline">décision d'exécution (UE) 2019/1004</a></li>
          <li>Biodéchets méthanisés comptés comme recyclés : directive 2008/98/CE, art. 11 bis §4, ajouté par la <a href="https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32018L0851" style="color:#11743f;text-decoration:underline">directive (UE) 2018/851</a></li>
          <li>Données compatibles avec le registre chronologique des déchets</li>
        </ul>
        <p style="margin:6px 0 0;font-style:italic;color:#515a72">Ce document constitue un élément justificatif. Il ne vaut pas certificat de conformité.</p>
      </div>
    </section>
    ${INTERCALAIRE}
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px">
    <div style="padding-top:10px;border-top:1px solid #dde1eb;display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;font-size:11px;color:#515a72"><span style="line-height: 1.45">${MENTIONS_EMETTEUR}&nbsp;<br>${MENTION_RECEPISSE}</span>
      <b style="color: rgb(34, 56, 112); font-weight: 700">Page 2/2</b>
    </div>
    ${encartSavr('margin-bottom: 34px; ')}
    </div>
  </main>

</div>`;
}
