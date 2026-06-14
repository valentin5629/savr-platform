import type { FluxDetail, BordereauZdData } from './bordereau-zd.js';
import { renderBordereauZd } from './bordereau-zd.js';

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

  // Benchmark
  benchmark_kg_pax?: number;
  benchmark_nb_collectes?: number; // pour k-anonymat
  filtres_benchmark?: Record<string, unknown>;

  // Photos
  photos_urls?: string[];

  // Bordereau intégré (page 2)
  bordereau: BordereauZdData;
}

export function renderRapportRecyclageZd(data: RapportRecyclageZdData): string {
  const tauxAffiche =
    data.taux_recyclage != null
      ? `${data.taux_recyclage.toFixed(1).replace('.', ',')} %`
      : '—';

  const lignesFlux = data.flux
    .map(
      (f) => `
      <tr>
        <td>${esc(f.nom)}</td>
        <td class="num">${f.poids_kg.toFixed(2).replace('.', ',')} kg</td>
        <td class="num">${data.poids_total_kg > 0 ? ((f.poids_kg / data.poids_total_kg) * 100).toFixed(1).replace('.', ',') + ' %' : '—'}</td>
      </tr>`,
    )
    .join('');

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
    return `
      <div class="co2-headline">
        <span class="co2-value">${t(data.co2_evite_kg)}</span>
        <span class="co2-label">de CO₂e évités</span>
      </div>
      <table class="co2-detail">
        <tr><td>CO₂ induit (transport, traitement)</td><td class="num">${data.co2_induit_kg != null ? t(data.co2_induit_kg) : '—'}</td></tr>
        <tr><td>Bilan CO₂ net</td><td class="num">${data.co2_net_kg != null ? t(data.co2_net_kg) : '—'}</td></tr>
        ${data.energie_primaire_evitee_kwh != null ? `<tr><td>Énergie primaire évitée</td><td class="num">${data.energie_primaire_evitee_kwh.toFixed(0)} kWh</td></tr>` : ''}
      </table>
      <p class="co2-mention">Facteurs ADEME (±50 % d'incertitude) · Version ${esc(data.co2_facteurs_version ?? 'ADEME 2024')}</p>`;
  })();

  const benchmarkBlock = (() => {
    if (data.benchmark_kg_pax == null || (data.benchmark_nb_collectes ?? 0) < 5)
      return '';
    const collecte_kg_pax =
      data.nb_pax && data.nb_pax > 0 ? data.poids_total_kg / data.nb_pax : null;
    return `
      <div class="section">
        <h2>Benchmark secteur</h2>
        <p>Votre collecte : <strong>${collecte_kg_pax != null ? collecte_kg_pax.toFixed(2).replace('.', ',') + ' kg/convive' : '—'}</strong></p>
        <p>Médiane secteur : ${data.benchmark_kg_pax.toFixed(2).replace('.', ',')} kg/convive</p>
        <p class="mention-benchmark">Basé sur ${data.benchmark_nb_collectes} collectes similaires · ESRS E5 / AGEC</p>
      </div>`;
  })();

  const bordereauHtml = renderBordereauZd(data.bordereau);
  // On extrait le body du bordereau pour l'intégrer en page 2
  const bordereauBody = bordereauHtml
    .replace(/^[\s\S]*?<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*$/, '');

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
  .co2-headline { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
  .co2-value { font-size: 26px; font-weight: 800; color: #16a34a; }
  .co2-label { font-size: 13px; color: #374151; }
  .co2-detail td { padding: 4px 8px; font-size: 10px; }
  .co2-mention { font-size: 9px; color: #9ca3af; margin-top: 6px; }
  .mention-benchmark { font-size: 9px; color: #9ca3af; margin-top: 4px; }
  .photos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
  .photo-item { width: 100%; height: 110px; object-fit: cover; border-radius: 4px; border: 1px solid #e5e7eb; }
  .methodo { font-size: 9px; color: #9ca3af; line-height: 1.5; border-top: 1px solid #e5e7eb; padding-top: 10px; margin-top: 10px; }
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
  </div>

  ${co2Block ? `<div class="section"><h2>Bilan carbone</h2>${co2Block}</div>` : ''}

  ${benchmarkBlock}

  ${photosBlock}

  <div class="methodo">
    Rapport établi par Savr conformément aux référentiels ESRS E5 (déchets), loi AGEC (art. 70). Taux de recyclage = (poids valorisé ÷ poids total collecté) × 100. Facteurs CO₂ issus de la base ADEME, snapshots figés à la date de la collecte — valeurs indicatives (incertitude ±50 %). Les données de ce rapport sont confidentielles et destinées exclusivement à l'organisation productrice.
  </div>

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
