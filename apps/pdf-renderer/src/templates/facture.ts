// Template PDF — Facture (copie de travail visuelle).
//
// ⚠ CECI N'EST PAS LA FACTURE LÉGALE. Le §06.08 §1 (l.30, l.343) est explicite :
// le PDF généré par Savr est une COPIE DE TRAVAIL (affichage client, archivage
// interne) ; la facture légale au format Factur-X est celle émise par Pennylane
// (factures.pdf_url_pennylane). Ce document sert d'aperçu lisible côté plateforme.
//
// Données = payload enfilé par validation-admin.ts::validerFacture (succès emise),
// écrit dans factures.pdf_url_savr par le worker (linkFichierToEntity, entity='factures').
//
// Mention « TVA non applicable, art. 293 B du CGI » : NON RENDUE en V1. Savr est
// assujettie à la TVA (aucun régime de franchise en base) — arbitrage Val 2026-07-08,
// cf. _Divergences/M1.7_20260708.md. La franchise en base est un régime propre à
// l'émetteur, pas dérivable d'un taux 0 (qui peut relever de l'autoliquidation).

// Version figée du gabarit — doit rester égale à TEMPLATE_VERSIONS['facture'] du
// contrat partagé (@savr/shared/src/pdf/document-types.ts). Vérifié par le gate CI
// check:pdf-contract. Incrémenter @N à toute modif structurelle.
export const TEMPLATE_VERSION = 'facture@1';

export interface FactureLigne {
  designation: string;
  quantite: number;
  pu_ht: number;
  taux_tva: number;
  montant_ht: number;
}

export interface FactureData {
  numero: string;
  date_emission: string;
  date_echeance: string;
  /** Entité juridique facturée (source de vérité facture — pas l'organisation). */
  entite_raison_sociale: string;
  entite_siret?: string | null;
  entite_tva_intracom?: string | null;
  entite_adresse?: string | null;
  entite_code_postal?: string | null;
  entite_ville?: string | null;
  entite_pays?: string | null;
  /** evenements.reference_affaire (n° d'affaire client), affichage seul. */
  reference_affaire?: string | null;
  /** Conditions de paiement (texte libre, Bloc 5). */
  conditions_paiement?: string | null;
  devise: string;
  lignes: FactureLigne[];
  total_ht: number;
  total_tva: number;
  total_ttc: number;
}

function fmtMontant(n: number, devise: string): string {
  const v = n.toFixed(2).replace('.', ',');
  return devise === 'EUR' ? `${v} €` : `${v} ${devise}`;
}

function fmtTaux(n: number): string {
  return `${n.toFixed(n % 1 === 0 ? 0 : 1).replace('.', ',')} %`;
}

export function renderFacture(data: FactureData): string {
  const lignesHtml = data.lignes
    .map(
      (l) => `<tr>
        <td>${esc(l.designation)}</td>
        <td class="num">${l.quantite}</td>
        <td class="num">${fmtMontant(l.pu_ht, data.devise)}</td>
        <td class="num">${fmtTaux(l.taux_tva)}</td>
        <td class="num">${fmtMontant(l.montant_ht, data.devise)}</td>
      </tr>`,
    )
    .join('');

  // TVA par taux (Bloc 4 §06.08) — regroupement des lignes par taux.
  const parTaux = new Map<number, { base: number; tva: number }>();
  for (const l of data.lignes) {
    const base = l.montant_ht;
    const cur = parTaux.get(l.taux_tva) ?? { base: 0, tva: 0 };
    cur.base += base;
    cur.tva += (base * l.taux_tva) / 100;
    parTaux.set(l.taux_tva, cur);
  }
  const tvaLignes = Array.from(parTaux.entries())
    .sort((a, b) => b[0] - a[0])
    .map(
      ([taux, v]) =>
        `<tr><td>TVA ${fmtTaux(taux)} (base ${fmtMontant(
          v.base,
          data.devise,
        )})</td><td class="num">${fmtMontant(v.tva, data.devise)}</td></tr>`,
    )
    .join('');

  const refBloc = data.reference_affaire
    ? `<p><span class="k">Référence client</span> ${esc(data.reference_affaire)}</p>`
    : '';
  const condBloc = data.conditions_paiement
    ? `<div class="section conditions"><h2>Conditions de paiement</h2><p>${esc(
        data.conditions_paiement,
      )}</p></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 28px 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #16a34a; padding-bottom: 14px; margin-bottom: 8px; }
  .logo-savr { font-size: 22px; font-weight: 800; color: #16a34a; letter-spacing: -0.5px; }
  .logo-savr small { display: block; font-size: 9px; font-weight: 400; color: #6b7280; letter-spacing: 0; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 15px; font-weight: 700; color: #1a1a1a; }
  .doc-title .numero { font-size: 12px; color: #374151; margin-top: 2px; font-weight: 600; }
  .doc-title .dates { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .copie-mention { font-size: 9px; color: #b45309; margin-bottom: 18px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
  .section { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
  .section h2 { font-size: 10px; font-weight: 600; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; margin-bottom: 8px; }
  .section p { font-size: 11px; line-height: 1.5; }
  .section .k { color: #9ca3af; }
  table.lignes { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.lignes thead tr { background: #16a34a; color: #fff; }
  table.lignes thead th { padding: 8px 10px; text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
  table.lignes thead th.num { text-align: right; }
  table.lignes tbody tr:nth-child(even) { background: #f9fafb; }
  table.lignes tbody td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totaux { width: 46%; margin-left: auto; border-collapse: collapse; margin-bottom: 18px; }
  .totaux td { padding: 5px 10px; border-bottom: 1px solid #eee; }
  .totaux tr.ttc td { font-weight: 700; font-size: 12px; border-top: 2px solid #16a34a; border-bottom: none; color: #15803d; }
  .conditions { margin-bottom: 18px; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 12px; display: flex; justify-content: space-between; }
  .footer-mention { font-size: 9px; color: #9ca3af; }
  .official { font-size: 10px; font-weight: 600; color: #374151; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-savr">Savr<small>gosavr.io</small></div>
    <div class="doc-title">
      <h1>Facture</h1>
      <div class="numero">${esc(data.numero)}</div>
      <div class="dates">Émise le ${esc(data.date_emission)} · Échéance ${esc(
        data.date_echeance,
      )}</div>
    </div>
  </div>
  <div class="copie-mention">Copie de travail — la facture légale (Factur-X) est celle émise par Pennylane.</div>

  <div class="grid-2">
    <div class="section">
      <h2>Client</h2>
      <p><strong>${esc(data.entite_raison_sociale)}</strong></p>
      ${data.entite_adresse ? `<p>${esc(data.entite_adresse)}</p>` : ''}
      ${
        data.entite_code_postal || data.entite_ville
          ? `<p>${esc(data.entite_code_postal)} ${esc(data.entite_ville)}</p>`
          : ''
      }
      ${data.entite_siret ? `<p><span class="k">SIRET</span> ${esc(data.entite_siret)}</p>` : ''}
      ${
        data.entite_tva_intracom
          ? `<p><span class="k">TVA</span> ${esc(data.entite_tva_intracom)}</p>`
          : ''
      }
    </div>
    <div class="section">
      <h2>Facture</h2>
      <p><span class="k">Numéro</span> ${esc(data.numero)}</p>
      <p><span class="k">Date d'émission</span> ${esc(data.date_emission)}</p>
      <p><span class="k">Échéance</span> ${esc(data.date_echeance)}</p>
      ${refBloc}
    </div>
  </div>

  <table class="lignes">
    <thead>
      <tr>
        <th>Désignation</th>
        <th class="num">Qté</th>
        <th class="num">PU HT</th>
        <th class="num">TVA</th>
        <th class="num">Montant HT</th>
      </tr>
    </thead>
    <tbody>
      ${lignesHtml}
    </tbody>
  </table>

  <table class="totaux">
    <tbody>
      <tr><td>Total HT</td><td class="num">${fmtMontant(data.total_ht, data.devise)}</td></tr>
      ${tvaLignes}
      <tr><td>Total TVA</td><td class="num">${fmtMontant(data.total_tva, data.devise)}</td></tr>
      <tr class="ttc"><td>Total TTC</td><td class="num">${fmtMontant(
        data.total_ttc,
        data.devise,
      )}</td></tr>
    </tbody>
  </table>

  ${condBloc}

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
