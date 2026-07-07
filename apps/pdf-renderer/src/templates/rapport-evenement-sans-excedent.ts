// Template PDF — Rapport « Événement sans excédent alimentaire » (§12 §1.3-bis).
//
// Justificatif texte seul destiné aux collectes AG terminées en
// `realisee_sans_collecte` (le chauffeur a déclaré « aucun repas à collecter »).
// Aucune attestation 2041-GE n'est générée (pas de don à certifier) : ce PDF
// documente la prestation. PAS de photos (décision Val 2026-05-04 — la photo lieu
// reste côté TMS, accès Ops). PAS de watermark / QR (V1.1).
//
// Données = payload enqueué par le batch runBatchSansExcedent
// (packages/plateforme/.../batch-pdf-sans-excedent.ts). Slug CDC =
// rapport_evenement_sans_excedent ; pas de variante par flux (un seul flux AG).

// Version figée du gabarit — doit rester égale à
// TEMPLATE_VERSIONS['rapport-evenement-sans-excedent'] du contrat partagé (@savr/shared).
// Vérifié par check:pdf-contract. Incrémenter @N à toute modif structurelle.
export const TEMPLATE_VERSION = 'rapport-evenement-sans-excedent@1';

export interface RapportEvenementSansExcedentData {
  // En-tête événement (§1.3-bis)
  nom_evenement: string;
  /** Date de l'événement (référence client) — evenements.date_evenement. */
  date_evenement: string;
  lieu_nom: string;
  lieu_adresse: string;
  traiteur_nom: string;
  nb_pax?: number | null;
  /** Client organisateur si renseigné (evenements.nom_client_organisateur). */
  client_organisateur_nom?: string | null;

  // Logo client (cascade §1.2) — résolu par le batch, sinon en-tête Savr seul.
  logo_url?: string | null;

  // Bloc « Constat »
  /** Date + heure de présentation chauffeur sur site (tournees.heure_debut_reelle, FR). */
  presentation_datetime?: string | null;
  chauffeur_nom?: string | null;
  /** Plaque véhicule — présente UNIQUEMENT si controle_acces_requis (masquée sinon). */
  plaque_immatriculation?: string | null;
  /** Motif déclaré par le chauffeur (collectes.aucun_repas_motif). */
  motif?: string | null;

  // Bloc « Conséquences »
  /** Numéro de facture si déjà émise (référence dans les conséquences). */
  reference_facture?: string | null;

  // Mention de régénération (§12 §1.4) — présente uniquement sur un document régénéré.
  regenere_le?: string | null;
}

export function renderRapportEvenementSansExcedent(
  data: RapportEvenementSansExcedentData,
): string {
  const logoBlock = data.logo_url
    ? `<img src="${esc(data.logo_url)}" alt="logo" style="max-height:40px;max-width:160px;object-fit:contain"/>`
    : '<span class="logo-savr">Savr</span>';

  // Bloc « Constat » — chaque ligne conditionnelle. La plaque n'est rendue que si
  // le batch l'a fournie (== controle_acces_requis true), sinon masquée (§1.3-bis).
  const constatLignes = [
    data.presentation_datetime
      ? `<tr><td>Présentation sur site</td><td>${esc(data.presentation_datetime)}</td></tr>`
      : '',
    data.chauffeur_nom
      ? `<tr><td>Chauffeur</td><td>${esc(data.chauffeur_nom)}</td></tr>`
      : '',
    data.plaque_immatriculation
      ? `<tr><td>Véhicule</td><td>${esc(data.plaque_immatriculation)}</td></tr>`
      : '',
    data.motif
      ? `<tr><td>Motif déclaré</td><td>${esc(data.motif)}</td></tr>`
      : '',
  ]
    .filter(Boolean)
    .join('');
  const constatBloc = constatLignes
    ? `<table class="constat"><tbody>${constatLignes}</tbody></table>`
    : `<p class="constat-vide">Aucune information d'intervention n'a été remontée par le transporteur.</p>`;

  const refFactureBloc = data.reference_facture
    ? `<p>Référence facture : <strong>${esc(data.reference_facture)}</strong></p>`
    : '';

  const clientLigne = data.client_organisateur_nom
    ? ` · Client organisateur : ${esc(data.client_organisateur_nom)}`
    : '';
  const paxLigne = data.nb_pax != null ? ` · ${data.nb_pax} convives` : '';

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
  .doc-title .sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .event-banner { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; }
  .event-banner strong { color: #15803d; }
  .event-banner .meta { color: #374151; margin-top: 4px; display: block; }
  .section { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; }
  .section h2 { font-size: 10px; font-weight: 600; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; margin-bottom: 10px; }
  table.constat { width: 100%; border-collapse: collapse; }
  table.constat td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
  table.constat td:first-child { color: #6b7280; width: 42%; }
  .constat-vide { font-size: 11px; color: #6b7280; font-style: italic; }
  .consequences { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; }
  .consequences h2 { font-size: 10px; font-weight: 600; text-transform: uppercase; color: #b45309; letter-spacing: 0.5px; margin-bottom: 8px; }
  .consequences p { font-size: 11px; line-height: 1.5; margin-bottom: 6px; }
  .consequences p:last-child { margin-bottom: 0; }
  .methodo { font-size: 9px; color: #9ca3af; line-height: 1.5; border-top: 1px solid #e5e7eb; padding-top: 10px; margin-top: 10px; }
  .regen-mention { font-size: 9px; color: #b45309; font-style: italic; margin-top: 10px; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 12px; display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; margin-top: 16px; }
</style>
</head>
<body>
  <div class="header">
    <div>${logoBlock}</div>
    <div class="doc-title">
      <h1>Événement sans excédent alimentaire</h1>
      <div class="sub">Anti-Gaspi · ${esc(data.date_evenement)}</div>
    </div>
  </div>

  <div class="event-banner">
    <strong>${esc(data.nom_evenement)}</strong>
    <span class="meta">Événement du ${esc(data.date_evenement)} · ${esc(data.lieu_nom)}${paxLigne}${clientLigne}
    <br/>Traiteur : ${esc(data.traiteur_nom)}</span>
  </div>

  <div class="section">
    <h2>Constat</h2>
    ${constatBloc}
  </div>

  <div class="consequences">
    <h2>Conséquences</h2>
    <p>Aucun repas n'a été collecté lors de cet événement. Aucune attestation de don 2041-GE n'est générée. La prestation logistique reste facturée au tarif normal au titre du déplacement.</p>
    ${refFactureBloc}
  </div>

  <div class="methodo">
    Document établi par Savr à la suite d'une intervention sans excédent alimentaire à
    collecter. Les informations d'intervention (horaire, chauffeur, motif) sont remontées
    par le transporteur. Ce document est confidentiel et destiné exclusivement à
    l'organisation productrice.
  </div>

  ${data.regenere_le ? `<div class="regen-mention">Version mise à jour — générée le ${esc(data.regenere_le)}</div>` : ''}

  <div class="footer">
    <span>Document confidentiel · ${esc(data.traiteur_nom)}</span>
    <span>Savr · gosavr.io</span>
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
