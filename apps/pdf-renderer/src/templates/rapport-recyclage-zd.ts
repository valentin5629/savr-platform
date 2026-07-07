import type { FluxDetail, BordereauZdData } from './bordereau-zd.js';
import { renderBordereauZd } from './bordereau-zd.js';

// Version figée du gabarit — doit rester égale à
// TEMPLATE_VERSIONS['rapport-recyclage-zd'] du contrat partagé (@savr/shared).
// Vérifié par check:pdf-contract.
// @2 (R21a) : bloc benchmark 5 jauges + point rouge + légende filtres, équivalences
// pédagogiques CO₂, comparaison moyenne Savr anonymisée, camembert par flux, mention
// pied de page de régénération.
export const TEMPLATE_VERSION = 'rapport-recyclage-zd@2';

/** Une jauge benchmark (1 par flux pesé) — §12 §1.2 « 5 jauges + point rouge parc ». */
export interface BenchmarkFluxGauge {
  flux_nom: string;
  collecte_kg_pax: number | null;
  /** Point rouge = moyenne pondérée parc. null si segment < 5 collectes (k-anonymat). */
  benchmark_kg_pax?: number | null;
  nb_collectes_segment: number;
}

export interface RapportRecyclageZdData {
  // En-tête événement
  nom_evenement: string;
  date_evenement: string;
  date_collecte: string;
  lieu_nom: string;
  lieu_adresse: string;
  nb_pax?: number;
  traiteur_nom: string;
  logo_url?: string;
  programmateur_nom?: string;
  programmateur_logo_url?: string;

  // Métriques RSE
  taux_recyclage?: number; // null = —
  flux: FluxDetail[];
  poids_total_kg: number;

  // CO₂ (règle ABC : evite = headline, induit + net = lignes séparées)
  co2_evite_kg?: number;
  co2_induit_kg?: number;
  co2_net_kg?: number;
  energie_primaire_evitee_kwh?: number;
  co2_facteurs_version?: string;
  // Équivalences pédagogiques du CO₂ évité (§12 §1.2 l.63) — comptes déjà calculés
  // (batch, depuis co2_facteurs_snapshot.equivalences). Absent = pas d'équivalence.
  equivalences?: {
    km_voiture?: number | null;
    repas_boeuf?: number | null;
    foyer?: number | null;
  };

  // Comparaison vs moyenne Savr anonymisée (§12 §1.2 l.67, ≥3 acteurs — distinct du
  // benchmark kg/pax k≥5). Absent si < 3 organisations dans le parc.
  comparaison_savr?: {
    taux_moyen_pondere: number;
    nb_organisations: number;
  };

  // Benchmark kg/pax × parc (§12 §1.2 l.69) — 5 jauges + légende des filtres appliqués.
  benchmark_flux?: BenchmarkFluxGauge[];
  benchmark_legende?: string;

  // Photos
  photos_urls?: string[];

  // Mention de régénération (§12 §1.4) — présente uniquement sur un document régénéré.
  regenere_le?: string;

  // Bordereau intégré (page 2)
  bordereau: BordereauZdData;
}

// Palette flux (camembert + repères). Indexée sur l'ordre du tableau flux.
const FLUX_COULEURS = [
  '#16a34a',
  '#2563eb',
  '#f59e0b',
  '#0d9488',
  '#6b7280',
  '#9333ea',
];

export function renderRapportRecyclageZd(data: RapportRecyclageZdData): string {
  const tauxAffiche =
    data.taux_recyclage != null
      ? `${data.taux_recyclage.toFixed(1).replace('.', ',')} %`
      : '—';

  const lignesFlux = data.flux
    .map(
      (f, i) => `
      <tr>
        <td><span class="flux-dot" style="background:${FLUX_COULEURS[i % FLUX_COULEURS.length]}"></span>${esc(f.nom)}</td>
        <td class="num">${f.poids_kg.toFixed(2).replace('.', ',')} kg</td>
        <td class="num">${data.poids_total_kg > 0 ? ((f.poids_kg / data.poids_total_kg) * 100).toFixed(1).replace('.', ',') + ' %' : '—'}</td>
      </tr>`,
    )
    .join('');

  // Camembert par flux (§12 §1.2 l.68) — donut SVG (circonférence normalisée à 100).
  const camembert = (() => {
    if (data.poids_total_kg <= 0 || data.flux.length === 0) return '';
    let offset = 25; // départ à 12h (décalage d'un quart de tour)
    const segments = data.flux
      .map((f, i) => {
        const pct = (f.poids_kg / data.poids_total_kg) * 100;
        const dash = `${pct.toFixed(2)} ${(100 - pct).toFixed(2)}`;
        const circle = `<circle class="donut-seg" r="15.915" cx="21" cy="21" fill="transparent" stroke="${FLUX_COULEURS[i % FLUX_COULEURS.length]}" stroke-width="7" stroke-dasharray="${dash}" stroke-dashoffset="${(100 - offset + 100).toFixed(2)}"></circle>`;
        offset += pct;
        return circle;
      })
      .join('');
    return `
      <div class="camembert-wrap">
        <svg viewBox="0 0 42 42" class="donut" role="img" aria-label="Répartition par flux">
          <circle r="15.915" cx="21" cy="21" fill="transparent" stroke="#eef2f0" stroke-width="7"></circle>
          ${segments}
        </svg>
        <div class="camembert-legend">
          ${data.flux
            .map(
              (f, i) =>
                `<div><span class="flux-dot" style="background:${FLUX_COULEURS[i % FLUX_COULEURS.length]}"></span>${esc(f.nom)}</div>`,
            )
            .join('')}
        </div>
      </div>`;
  })();

  const logoBlock = (() => {
    const url = data.programmateur_logo_url ?? data.logo_url;
    return url
      ? `<img src="${esc(url)}" alt="logo" style="max-height:40px;max-width:160px;object-fit:contain"/>`
      : '<span class="logo-savr">Savr</span>';
  })();

  const photosBlock =
    data.photos_urls && data.photos_urls.length > 0
      ? `<div class="photos-grid">${data.photos_urls.map((u) => `<img src="${esc(u)}" class="photo-item" alt="photo collecte"/>`).join('')}</div>`
      : '';

  const co2Block = (() => {
    if (data.co2_evite_kg == null) return '';
    const t = (kg: number) =>
      (kg / 1000).toFixed(3).replace('.', ',') + ' t CO₂e';
    const eq = data.equivalences;
    const nombre = (n: number) =>
      Math.round(n)
        .toLocaleString('fr-FR')
        .replace(/[\u202f\u00a0]/g, ' ');
    // Équivalences pédagogiques du CO₂ évité (§12 §1.2 l.63) : km voiture + repas bœuf.
    const equivEvite: string[] = [];
    if (eq?.km_voiture != null)
      equivEvite.push(`${nombre(eq.km_voiture)} km en voiture`);
    if (eq?.repas_boeuf != null)
      equivEvite.push(`${nombre(eq.repas_boeuf)} repas avec bœuf`);
    const equivEviteHtml =
      equivEvite.length > 0
        ? `<p class="co2-equiv">Soit l'équivalent de ≈ ${equivEvite.join(' · ≈ ')}.</p>`
        : '';
    // Équivalence énergie primaire évitée → foyers (§12 §1.2 l.65).
    const equivFoyerHtml =
      data.energie_primaire_evitee_kwh != null && eq?.foyer != null
        ? ` <span class="equiv">≈ ${nombre(eq.foyer)} foyers (conso élec/an)</span>`
        : '';
    return `
      <div class="co2-headline">
        <span class="co2-value">${t(data.co2_evite_kg)}</span>
        <span class="co2-label">de CO₂e évités</span>
      </div>
      ${equivEviteHtml}
      <table class="co2-detail">
        <tr><td>CO₂ induit (transport, traitement)</td><td class="num">${data.co2_induit_kg != null ? t(data.co2_induit_kg) : '—'}</td></tr>
        <tr><td>Bilan CO₂ net</td><td class="num">${data.co2_net_kg != null ? t(data.co2_net_kg) : '—'}</td></tr>
        ${data.energie_primaire_evitee_kwh != null ? `<tr><td>Énergie primaire évitée</td><td class="num">${data.energie_primaire_evitee_kwh.toFixed(0)} kWh${equivFoyerHtml}</td></tr>` : ''}
      </table>
      <p class="co2-mention">Facteurs ADEME (±50 % d'incertitude) · Version ${esc(data.co2_facteurs_version ?? 'ADEME 2024')}</p>`;
  })();

  // Comparaison vs moyenne Savr anonymisée (§12 §1.2 l.67, ≥3 acteurs).
  const comparaisonBlock = (() => {
    const c = data.comparaison_savr;
    if (!c) return '';
    const moyenne = c.taux_moyen_pondere.toFixed(1).replace('.', ',');
    const votre =
      data.taux_recyclage != null
        ? `${data.taux_recyclage.toFixed(1).replace('.', ',')} %`
        : '—';
    return `
      <div class="section">
        <h2>Comparaison au parc Savr</h2>
        <p>Votre taux de recyclage : <strong>${votre}</strong></p>
        <p>Moyenne du parc Savr (anonymisée) : <strong>${moyenne} %</strong></p>
        <p class="mention-benchmark">Moyenne pondérée par tonnage sur ${c.nb_organisations} organisations · anonymisée (≥ 3 acteurs)</p>
      </div>`;
  })();

  // Bloc benchmark kg/pax × parc — 5 jauges (1 par flux) + point rouge + légende (§12 §1.2 l.69).
  const benchmarkBlock = (() => {
    const gauges = data.benchmark_flux;
    if (!gauges || gauges.length === 0) return '';
    const rows = gauges
      .map((g) => {
        const val = g.collecte_kg_pax ?? 0;
        const bench = g.benchmark_kg_pax ?? null;
        const suffisant = bench != null && g.nb_collectes_segment >= 5;
        // Échelle de la jauge : max(valeur, point rouge) avec marge de 25 %.
        const echelle = Math.max(val, bench ?? 0, 0.001) * 1.25;
        const pctVal = Math.min(100, (val / echelle) * 100);
        const pctBench = suffisant
          ? Math.min(100, (bench! / echelle) * 100)
          : 0;
        const fmt = (n: number) => n.toFixed(2).replace('.', ',');
        return `
        <div class="gauge">
          <div class="gauge-head">
            <span>${esc(g.flux_nom)}</span>
            <span class="gauge-val">${fmt(val)} kg/convive</span>
          </div>
          <div class="gauge-track">
            <div class="gauge-fill" style="width:${pctVal.toFixed(1)}%"></div>
            ${suffisant ? `<div class="gauge-marker" style="left:${pctBench.toFixed(1)}%" title="Point rouge parc Savr"></div>` : ''}
          </div>
          <div class="gauge-foot">${
            suffisant
              ? `Parc Savr : <strong>${fmt(bench!)} kg/convive</strong> · ${g.nb_collectes_segment} collectes`
              : 'Données insuffisantes pour benchmark (moins de 5 collectes comparables)'
          }</div>
        </div>`;
      })
      .join('');
    const legende = data.benchmark_legende
      ? `<p class="mention-benchmark">Benchmark parc Savr calculé sur : ${esc(data.benchmark_legende)}. K-anonymat ≥ 5.</p>`
      : '';
    return `
      <div class="section benchmark-section">
        <h2>Benchmark kg/convive par flux — parc Savr</h2>
        <div class="gauge-caption"><span class="gauge-marker-legend"></span> Point rouge = moyenne du parc Savr sur le segment comparable.</div>
        ${rows}
        ${legende}
      </div>`;
  })();

  const bordereauHtml = renderBordereauZd(data.bordereau);
  // On extrait le body du bordereau pour l'intégrer en page 2
  const bordereauBody = bordereauHtml
    .replace(/^[\s\S]*?<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*$/, '');

  // Mention de régénération en pied de page (§12 §1.4) — uniquement si régénéré.
  const regenMention = data.regenere_le
    ? `<div class="regen-mention">Version mise à jour — générée le ${esc(data.regenere_le)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #1a1a1a; }
  .page { padding: 28px 32px; min-height: 100vh; }
  .page-break { page-break-before: always; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #16a34a; padding-bottom: 14px; margin-bottom: 20px; }
  .logo-savr { font-size: 22px; font-weight: 800; color: #16a34a; letter-spacing: -0.5px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 15px; font-weight: 700; }
  .doc-title .sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .event-banner { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; }
  .event-banner strong { color: #15803d; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
  .section { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; margin-bottom: 14px; }
  .section h2 { font-size: 10px; font-weight: 600; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; margin-bottom: 8px; }
  .taux-block { text-align: center; padding: 18px; background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 8px; margin-bottom: 18px; }
  .taux-value { font-size: 38px; font-weight: 800; color: #16a34a; }
  .taux-label { font-size: 12px; color: #374151; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  thead tr { background: #16a34a; color: #fff; }
  thead th { padding: 7px 10px; text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  tbody td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
  td.num, th.num { text-align: right; }
  .flux-dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
  .flux-block { display: flex; gap: 16px; align-items: flex-start; }
  .flux-block > table { flex: 1; }
  .camembert-wrap { display: flex; flex-direction: column; align-items: center; width: 150px; }
  .donut { width: 110px; height: 110px; }
  .camembert-legend { font-size: 8.5px; color: #4b5563; margin-top: 6px; line-height: 1.6; }
  .co2-headline { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
  .co2-value { font-size: 26px; font-weight: 800; color: #16a34a; }
  .co2-label { font-size: 13px; color: #374151; }
  .co2-equiv { font-size: 10px; color: #374151; margin-bottom: 8px; }
  .co2-detail td { padding: 4px 8px; font-size: 10px; }
  .co2-mention { font-size: 9px; color: #9ca3af; margin-top: 6px; }
  .equiv { color: #6b7280; font-weight: 400; }
  .mention-benchmark { font-size: 9px; color: #9ca3af; margin-top: 6px; }
  .benchmark-section .gauge-caption { font-size: 9px; color: #6b7280; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
  .gauge { margin-bottom: 10px; }
  .gauge-head { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px; }
  .gauge-val { font-weight: 700; color: #16a34a; }
  .gauge-track { position: relative; height: 12px; background: #e5e7eb; border-radius: 6px; overflow: visible; }
  .gauge-fill { position: absolute; left: 0; top: 0; height: 12px; background: #86efac; border-radius: 6px; }
  .gauge-marker { position: absolute; top: -2px; width: 3px; height: 16px; background: #dc2626; border-radius: 1px; }
  .gauge-marker-legend { display: inline-block; width: 3px; height: 12px; background: #dc2626; border-radius: 1px; }
  .gauge-foot { font-size: 8.5px; color: #6b7280; margin-top: 3px; }
  .photos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
  .photo-item { width: 100%; height: 110px; object-fit: cover; border-radius: 4px; border: 1px solid #e5e7eb; }
  .methodo { font-size: 9px; color: #9ca3af; line-height: 1.5; border-top: 1px solid #e5e7eb; padding-top: 10px; margin-top: 10px; }
  .regen-mention { font-size: 9px; color: #b45309; font-style: italic; margin-top: 10px; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 10px; display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; margin-top: 16px; }
</style>
</head>
<body>

<!-- PAGE 1 — Synthèse RSE -->
<div class="page">
  <div class="header">
    <div>${logoBlock}</div>
    <div class="doc-title">
      <h1>Rapport de recyclage</h1>
      <div class="sub">Zéro Déchet · ${esc(data.date_evenement)}</div>
    </div>
  </div>

  <div class="event-banner">
    <strong>${esc(data.nom_evenement)}</strong>
    ${data.date_collecte !== data.date_evenement ? ` · Intervention le ${esc(data.date_collecte)}` : ''}
    · ${esc(data.lieu_nom)}${data.nb_pax ? ` · ${data.nb_pax} convives` : ''}
    <br/><span style="color:#374151">Traiteur : ${esc(data.traiteur_nom)}</span>
  </div>

  <div class="taux-block">
    <div class="taux-value">${tauxAffiche}</div>
    <div class="taux-label">Taux de recyclage</div>
  </div>

  <div class="section">
    <h2>Tonnages par flux</h2>
    <div class="flux-block">
      <table>
        <thead><tr><th>Flux</th><th class="num">Poids</th><th class="num">%</th></tr></thead>
        <tbody>
          ${lignesFlux}
          <tr style="font-weight:700;background:#ecfdf5">
            <td>Total valorisé</td>
            <td class="num">${data.poids_total_kg.toFixed(2).replace('.', ',')} kg</td>
            <td class="num">—</td>
          </tr>
        </tbody>
      </table>
      ${camembert}
    </div>
  </div>

  ${co2Block ? `<div class="section"><h2>Bilan carbone</h2>${co2Block}</div>` : ''}

  ${comparaisonBlock}

  ${benchmarkBlock}

  ${photosBlock}

  <div class="methodo">
    Rapport établi par Savr conformément aux référentiels ESRS E5 (déchets), loi AGEC (art. 70). Taux de recyclage = (poids valorisé ÷ poids total collecté) × 100. Facteurs CO₂ issus de la base ADEME, snapshots figés à la date de la collecte — valeurs indicatives (incertitude ±50 %). Les données de ce rapport sont confidentielles et destinées exclusivement à l'organisation productrice.
  </div>

  ${regenMention}

  <div class="footer">
    <span>Document confidentiel · ${esc(data.traiteur_nom)}</span>
    <span>Savr · gosavr.io</span>
  </div>
</div>

<!-- PAGE 2 — Bordereau intégré -->
<div class="page page-break">
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:8px 14px;margin-bottom:16px;font-size:10px;color:#15803d;font-weight:600">
    Annexe — Bordereau de pesée Savr (${esc(data.bordereau.numero)})
  </div>
  ${bordereauBody}
</div>

</body>
</html>`;
}

function esc(s: string | undefined | null): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
