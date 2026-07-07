// Template PDF — Attestation de don Anti-Gaspi (Cerfa 2041-GE).
//
// Données = `attestationPayload` enqueué par le batch J+1 AG
// (packages/plateforme/.../batch-pdf-j1-ag.ts). La mention fiscale 238 bis CGI
// n'apparaît QUE si `mention_fiscale_2041ge` (snapshot de
// associations.habilitee_attestation_fiscale) — sinon mention neutre de traçabilité
// (CDC §05 Règles métier + §12 Reporting). Le statut d'habilitation est figé au
// rendu : une attestation déjà émise garde sa mention même si l'asso perd
// l'habilitation ensuite.

// Version figée du gabarit — doit rester égale à TEMPLATE_VERSIONS['attestation-don']
// du contrat partagé (@savr/shared/src/pdf/document-types.ts). Vérifié par le gate
// CI check:integration-contracts. Incrémenter @N à toute modif structurelle.
// @2 (R21a) : mention pied de page de régénération (§12 §1.4).
export const TEMPLATE_VERSION = 'attestation-don@2';

export interface AttestationDonData {
  numero: string;
  date_emission: string;
  date_collecte: string;
  nom_evenement: string;
  date_evenement: string;
  donateur_raison_sociale: string;
  donateur_siret: string;
  association_nom: string;
  association_adresse?: string | null;
  association_numero_rup?: string | null;
  /** Snapshot associations.habilitee_attestation_fiscale au moment du rendu. */
  mention_fiscale_2041ge: boolean;
  volume_repas: number;
  poids_kg?: number | null;
  co2_evite_kg?: number | null;
  /** Équivalence pédagogique en km voiture (snapshot equivalences.km_voiture). */
  co2_km_voiture?: number | null;
  co2_facteurs_version?: string | null;
  /** Mention de régénération (§12 §1.4) — présente uniquement sur un document régénéré. */
  regenere_le?: string | null;
}

export function renderAttestationDon(data: AttestationDonData): string {
  const poidsLigne =
    data.poids_kg != null
      ? `<tr><td>Poids estimé</td><td class="num">${data.poids_kg
          .toFixed(2)
          .replace('.', ',')} kg</td></tr>`
      : '';

  // CO₂e évité + équivalence pédagogique km voiture (§12 §1.3).
  const equivKmVoiture =
    data.co2_km_voiture != null
      ? ` <span class="equiv">≈ ${data.co2_km_voiture} km en voiture</span>`
      : '';
  const co2Ligne =
    data.co2_evite_kg != null
      ? `<tr><td>CO₂e évité<div class="methodo">Estimation FAO — 2,5 kgCO₂e par repas sauvé du gaspillage</div></td><td class="num">${data.co2_evite_kg
          .toFixed(1)
          .replace('.', ',')} kgCO₂e${equivKmVoiture}</td></tr>`
      : '';

  // Bloc mention fiscale — conditionnel (CDC §05).
  const mentionFiscale = data.mention_fiscale_2041ge
    ? `<div class="fiscal fiscal-habilitee">
        <h2>Reçu fiscal — article 238 bis du Code général des impôts</h2>
        <p>L'association bénéficiaire est habilitée à délivrer des reçus fiscaux
        (formulaire Cerfa n° 2041-GE). À ce titre, ce don en nature ouvre droit,
        pour l'entreprise donatrice, à la réduction d'impôt prévue à l'article
        238 bis du CGI, égale à <strong>60 % de la valeur du don</strong> dans la
        limite légale applicable.${
          data.association_numero_rup
            ? ` Association reconnue d'utilité publique — RUP ${esc(
                data.association_numero_rup,
              )}.`
            : ''
        }</p>
        <p class="fiscal-note">La valorisation du don relève de la responsabilité
        du donateur, sur la base de son prix de revient.</p>
      </div>`
    : `<div class="fiscal fiscal-neutre">
        <h2>Document de traçabilité</h2>
        <p>L'association bénéficiaire n'est pas habilitée à délivrer un reçu fiscal
        (Cerfa 2041-GE). La présente attestation certifie la réalité du don de
        denrées alimentaires ; <strong>aucun avantage fiscal n'y est associé</strong>.</p>
      </div>`;

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
  .methodo { font-size: 9px; color: #9ca3af; font-weight: 400; margin-top: 2px; }
  .equiv { color: #6b7280; font-weight: 400; }
  .fiscal { border-radius: 6px; padding: 12px 14px; margin-bottom: 18px; }
  .fiscal h2 { font-size: 11px; font-weight: 700; margin-bottom: 6px; }
  .fiscal p { font-size: 10.5px; line-height: 1.5; }
  .fiscal-habilitee { background: #ecfdf5; border: 1px solid #6ee7b7; }
  .fiscal-habilitee h2 { color: #047857; }
  .fiscal-neutre { background: #f9fafb; border: 1px solid #e5e7eb; }
  .fiscal-neutre h2 { color: #6b7280; }
  .fiscal-note { color: #6b7280; margin-top: 6px; font-size: 9.5px; }
  .signature-block { display: flex; gap: 40px; margin-bottom: 20px; }
  .sig-box { flex: 1; border: 1px dashed #d1d5db; border-radius: 4px; padding: 10px; min-height: 60px; }
  .sig-box .label { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 12px; display: flex; justify-content: space-between; }
  .footer-mention { font-size: 9px; color: #9ca3af; }
  .official { font-size: 10px; font-weight: 600; color: #374151; }
  .regen-mention { font-size: 9px; color: #b45309; font-style: italic; margin-bottom: 8px; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-savr">Savr</div>
    <div class="doc-title">
      <h1>Attestation de don</h1>
      <div class="numero">${esc(data.numero)}</div>
      <div class="numero">Émise le ${esc(data.date_emission)}</div>
    </div>
  </div>

  <div class="event-banner">
    <strong>${esc(data.nom_evenement)}</strong> — Événement du ${esc(data.date_evenement)}${
      data.date_collecte !== data.date_evenement
        ? ` · Don du ${esc(data.date_collecte)}`
        : ''
    }
  </div>

  <div class="grid-2">
    <div class="section">
      <h2>Donateur</h2>
      <p><strong>${esc(data.donateur_raison_sociale)}</strong></p>
      <p>SIRET ${esc(data.donateur_siret)}</p>
    </div>
    <div class="section">
      <h2>Association bénéficiaire</h2>
      <p><strong>${esc(data.association_nom)}</strong></p>
      ${data.association_adresse ? `<p>${esc(data.association_adresse)}</p>` : ''}
      ${data.association_numero_rup ? `<p>RUP ${esc(data.association_numero_rup)}</p>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Nature du don</th>
        <th style="text-align:right">Quantité</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>Repas sauvés du gaspillage</td><td class="num">${data.volume_repas} repas</td></tr>
      ${poidsLigne}
      ${co2Ligne}
    </tbody>
  </table>

  ${mentionFiscale}

  <div class="signature-block">
    <div class="sig-box"><div class="label">Cachet / signature association</div></div>
    <div class="sig-box"><div class="label">Cachet / signature donateur</div></div>
  </div>

  ${data.regenere_le ? `<div class="regen-mention">Version mise à jour — générée le ${esc(data.regenere_le)}</div>` : ''}

  <div class="footer">
    <div class="footer-mention">Document généré par Savr · ${esc(data.numero)}</div>
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
