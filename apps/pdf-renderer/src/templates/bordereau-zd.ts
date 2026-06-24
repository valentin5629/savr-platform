// Version figée du gabarit — doit rester égale à TEMPLATE_VERSIONS['bordereau-zd']
// du contrat partagé (@savr/shared). Vérifié par check:integration-contracts.
export const TEMPLATE_VERSION = 'bordereau-zd@1';

export interface FluxDetail {
  nom: string;
  poids_kg: number;
  nb_bacs?: number;
}

export interface BordereauZdData {
  numero: string;
  date_emission: string;
  date_collecte: string;
  date_evenement: string;
  nom_evenement: string;
  lieu_nom: string;
  lieu_adresse: string;
  producteur_raison_sociale: string;
  producteur_siret?: string;
  producteur_adresse: string;
  transporteur_nom: string;
  exutoire_nom: string;
  nb_pax?: number;
  flux: FluxDetail[];
  poids_total_kg: number;
}

export function renderBordereauZd(data: BordereauZdData): string {
  const lignesFlux = data.flux
    .map(
      (f) => `
      <tr>
        <td class="flux-nom">${esc(f.nom)}</td>
        <td class="num">${f.poids_kg.toFixed(2).replace('.', ',')} kg</td>
        <td class="num">${f.nb_bacs != null ? f.nb_bacs : '—'}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 28px 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #16a34a; padding-bottom: 14px; margin-bottom: 20px; }
  .logo-savr { font-size: 22px; font-weight: 800; color: #16a34a; letter-spacing: -0.5px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 15px; font-weight: 700; color: #1a1a1a; }
  .doc-title .numero { font-size: 12px; color: #6b7280; margin-top: 2px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
  .section { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
  .section h2 { font-size: 10px; font-weight: 600; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; margin-bottom: 8px; }
  .section p { font-size: 11px; line-height: 1.5; }
  .event-banner { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; }
  .event-banner strong { color: #15803d; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  thead tr { background: #16a34a; color: #fff; }
  thead th { padding: 8px 10px; text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  tbody td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .total-row td { font-weight: 700; background: #ecfdf5 !important; border-top: 2px solid #16a34a; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 12px; display: flex; justify-content: space-between; }
  .footer-mention { font-size: 9px; color: #9ca3af; }
  .official { font-size: 10px; font-weight: 600; color: #374151; }
  .signature-block { display: flex; gap: 40px; }
  .sig-box { flex: 1; border: 1px dashed #d1d5db; border-radius: 4px; padding: 10px; min-height: 60px; }
  .sig-box .label { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-savr">Savr</div>
    <div class="doc-title">
      <h1>Bordereau de pesée</h1>
      <div class="numero">${esc(data.numero)}</div>
      <div class="numero">Émis le ${esc(data.date_emission)}</div>
    </div>
  </div>

  <div class="event-banner">
    <strong>${esc(data.nom_evenement)}</strong> — Événement du ${esc(data.date_evenement)}${data.date_collecte !== data.date_evenement ? ` · Intervention le ${esc(data.date_collecte)}` : ''}${data.nb_pax ? ` · ${data.nb_pax} convives` : ''}
  </div>

  <div class="grid-2">
    <div class="section">
      <h2>Producteur</h2>
      <p><strong>${esc(data.producteur_raison_sociale)}</strong></p>
      ${data.producteur_siret ? `<p>SIRET ${esc(data.producteur_siret)}</p>` : ''}
      <p>${esc(data.producteur_adresse)}</p>
    </div>
    <div class="section">
      <h2>Lieu de collecte</h2>
      <p><strong>${esc(data.lieu_nom)}</strong></p>
      <p>${esc(data.lieu_adresse)}</p>
    </div>
    <div class="section">
      <h2>Transporteur</h2>
      <p>${esc(data.transporteur_nom)}</p>
    </div>
    <div class="section">
      <h2>Exutoire</h2>
      <p>${esc(data.exutoire_nom)}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Flux</th>
        <th style="text-align:right">Poids</th>
        <th style="text-align:right">Bacs / Rolls</th>
      </tr>
    </thead>
    <tbody>
      ${lignesFlux}
      <tr class="total-row">
        <td>TOTAL</td>
        <td class="num">${data.poids_total_kg.toFixed(2).replace('.', ',')} kg</td>
        <td class="num">—</td>
      </tr>
    </tbody>
  </table>

  <div class="signature-block" style="margin-bottom:20px">
    <div class="sig-box"><div class="label">Signature chauffeur</div></div>
    <div class="sig-box"><div class="label">Signature représentant traiteur</div></div>
  </div>

  <div class="footer">
    <div class="footer-mention">Document officiel Savr · ${esc(data.numero)}</div>
    <div class="official">Savr — gosavr.io</div>
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
