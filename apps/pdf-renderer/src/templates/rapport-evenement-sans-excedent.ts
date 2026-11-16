// Template PDF — « Rapport de don » d'une collecte anti-gaspi sans excédent
// (`realisee_sans_collecte` : le chauffeur est passé, rien à collecter).
//
// Gabarit @3 (2026-11-16) : maquette illustrée validée par Val dans Claude Design,
// copiée dans design/rapport-de-don/2026-11-16/RapportSansExcedent.dc.html.
// Bandeau et encart Savr = ceux du rapport de recyclage @4, logo à coin orange.
// La page atteste le mandat donné à Savr et montre les deux associations
// partenaires les plus proches du lieu (décision Val 2026-11-16). Retirés à la
// demande de Val : le déroulé du passage (heure, chauffeur, véhicule), la
// remarque du chauffeur et sa photo, l'attestation de passage, la référence de
// facture. Aucun don : aucune donnée CO₂e.
//
// Données : payload du lot runBatchSansExcedent (batch-pdf-sans-excedent.ts),
// complété au rendu par le contexte visuel (logos, mandant, associations) :
// lib/pdf/contexte-rapports-de-don.ts.

import {
  COIN_ANTI_GASPI,
  CSS_RAPPORT_V4,
  LOGO_DEFS,
  bandeauRapportV4,
  croix,
  encartSavr,
  esc,
} from './rapport-recyclage-zd.js';
import { mentionRegeneration } from './attestation-don.js';

// Version figée du gabarit — doit rester égale à
// TEMPLATE_VERSIONS['rapport-evenement-sans-excedent'] du contrat partagé (@savr/shared).
// Vérifié par check:pdf-contract. Incrémenter @N à toute modif structurelle.
// @2 : titre « Rapport de don », ancien titre en sous-titre, phrase « ne vaut pas
// reçu fiscal » à la place de « Aucune attestation de don 2041-GE n'est générée ».
// @3 : rapport illustré d'une page (maquette Val 2026-11-16).
export const TEMPLATE_VERSION = 'rapport-evenement-sans-excedent@3';

/** Association partenaire montrée sur le rapport (au plus deux). */
export interface AssociationProche {
  nom: string;
  ville?: string | null;
  /** Logo (data URI) ; absent : initiale du nom. */
  logo_url?: string | null;
  /** associations.description_rapport_impact. */
  description?: string | null;
}

export interface RapportEvenementSansExcedentData {
  nom_evenement: string;
  /** Date de l'événement (« JJ/MM/AAAA ») — evenements.date_evenement. */
  date_evenement: string;
  lieu_nom: string;
  lieu_adresse?: string | null;
  traiteur_nom: string;
  /** Convives de la collecte (Val Q5 du 2026-10-24). */
  nb_pax?: number | null;
  client_organisateur_nom?: string | null;

  /** Logo unique de la cascade (gabarit @2) : repli du logo client du bandeau. */
  logo_url?: string | null;
  /** Logos du bandeau (data URI) : client, puis traiteur. */
  logo_client_url?: string | null;
  logo_traiteur_url?: string | null;

  /** Organisation qui a mandaté Savr (programmatrice de la collecte). */
  mandant_nom?: string | null;
  /** Les deux associations actives les plus proches du lieu (au plus deux). */
  associations_proches?: AssociationProche[] | null;

  // Champs du gabarit @2, encore reçus, plus imprimés depuis @3.
  presentation_datetime?: string | null;
  chauffeur_nom?: string | null;
  plaque_immatriculation?: string | null;
  motif?: string | null;
  reference_facture?: string | null;

  /** Mention de régénération (§12 §1.4) — présente uniquement sur un document régénéré. */
  regenere_le?: string | null;
}

/**
 * Lignes au plus de la description d'une association : garde-fou mesuré sur la
 * maquette (≈ 190 caractères tiennent quand le nom tient sur deux lignes,
 * ≈ 230 sur une).
 */
export const LIGNES_DESCRIPTION_PROCHE = 5;

function carte(a: AssociationProche): string {
  const nom = a.nom?.trim() || 'Association partenaire';
  const initiale = esc(
    nom
      .replace(/^association\s+/i, '')
      .charAt(0)
      .toUpperCase(),
  );
  const logo = a.logo_url
    ? `<img src="${esc(a.logo_url)}" alt="Logo de l'association" style="max-width: 144px; max-height: 60px; object-fit: contain; display: block;">`
    : `<span style="font-family: Archivo, Inter, sans-serif; font-size: 42px; font-weight: 800; color: #223870; line-height: 1;">${initiale}</span>`;
  const description = a.description?.trim()
    ? `<p style="margin: 0; font-size: 15px; line-height: 1.5; color: #3c4459; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: ${LIGNES_DESCRIPTION_PROCHE}; overflow: hidden;">${esc(a.description.trim())}</p>`
    : '';
  return `<div style="border: 1.5px solid #e3e7ef; border-radius: 16px; padding: 18px 18px; display: flex; flex-direction: column; gap: 14px; min-width: 0; background: #ffffff;">
          <div style="height: 80px; border-radius: 12px; background: #fff4e0; display: flex; align-items: center; justify-content: center;">${logo}</div>
          <div><div style="font-family: Archivo, Inter, sans-serif; font-size: 20px; font-weight: 800; color: #223870; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${esc(nom)}</div>${a.ville ? `<div style="margin-top: 4px; font-size: 14px; font-weight: 600; color: #515a72;">${esc(a.ville)}</div>` : ''}</div>
          ${description}
        </div>`;
}

export function renderRapportEvenementSansExcedent(
  data: RapportEvenementSansExcedentData,
): string {
  const mandant = data.mandant_nom?.trim() || data.traiteur_nom?.trim() || '';
  const phraseMandat = mandant
    ? `Ce document atteste que <b style="font-weight: 700; color: #223870;">${esc(mandant)}</b> a bien mandaté Savr pour collecter et redistribuer les éventuels excédents à une association lors de votre événement`
    : 'Ce document atteste que Savr a bien été mandaté pour collecter et redistribuer les éventuels excédents à une association lors de votre événement';

  const proches = (data.associations_proches ?? []).slice(0, 2);
  const sousTitre =
    proches.length === 1
      ? "L'association partenaire de Savr la plus proche du lieu de l'événement, qui reçoit les excédents des événements."
      : "Les deux associations partenaires de Savr les plus proches du lieu de l'événement, qui reçoivent les excédents des événements.";
  const sectionAssociations = proches.length
    ? `<div aria-hidden="true" style="flex: 1 1 0; min-height: 20px; max-height: 26px;"></div>

    <section aria-label="Associations partenaires" style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;">
      <h2 style="margin: 0; font-family: Archivo, Inter, sans-serif; font-size: 22px; font-weight: 800; color: #223870; letter-spacing: -0.01em; line-height: 1.15;">Vos excédents auraient profité à…</h2>
      <p style="margin: 5px 0 0; font-size: 13px; line-height: 1.45; color: #515a72;">${sousTitre}</p>
      <div style="flex: 1; min-height: 0; margin-top: 12px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;">
        ${proches.map(carte).join('\n        ')}
      </div>
    </section>`
    : '';

  // Sans association à montrer, l'encadré du constat prend la page.
  const hauteurConstat = proches.length
    ? 'flex: none; height: 267px;'
    : 'flex: 1 1 auto;';

  const page = `<div class="pg-1">

  ${croix(250, 'position: absolute; left: -80px; bottom: -70px; transform: rotate(-45deg);', '#fff4e0')}
  ${croix(170, 'position: absolute; right: -55px; bottom: 130px; transform: rotate(-45deg);', '#eef1f7')}

  ${bandeauRapportV4({
    surTitre: 'RAPPORT DE DON',
    nomEvenement: data.nom_evenement ?? '',
    lieu: data.lieu_nom ?? '',
    dateEvenement: data.date_evenement,
    convives: data.nb_pax != null && data.nb_pax > 0 ? data.nb_pax : null,
    // Le contexte lu au rendu pose toujours le champ (null = pas de logo client) ;
    // seul un contenu sans contexte retombe sur le logo unique de la cascade @2.
    logos: [
      'logo_client_url' in data ? data.logo_client_url : data.logo_url,
      data.logo_traiteur_url,
    ],
    coin: COIN_ANTI_GASPI,
  })}

  <main style="position: relative; flex: 1; min-height: 0; padding: 26px 48px 7px; display: flex; flex-direction: column;">

    <section aria-label="Constat" style="${hauteurConstat} box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: #fff4e0; border-radius: 20px; padding: 20px 48px;">
      <span style="width: 100px; height: 100px; border-radius: 9999px; background: #ffe2b0; display: flex; align-items: center; justify-content: center;"><span style="width: 74px; height: 74px; border-radius: 9999px; background: #ff9b00; display: flex; align-items: center; justify-content: center;"><svg aria-hidden="true" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg></span></span>
      <h2 style="margin: 16px 0 0; font-family: Archivo, Inter, sans-serif; font-size: 32px; font-weight: 800; color: #223870; letter-spacing: -0.02em; line-height: 1.1; text-wrap: balance;">Événement sans excédent alimentaire</h2>
      <p style="margin: 8px 0 0; max-width: 560px; font-size: 16px; line-height: 1.5; color: #3c4459; text-wrap: balance;">${phraseMandat}</p>
    </section>

    ${sectionAssociations}

    ${encartSavr('margin-top: 12px; margin-bottom: 34px; ', COIN_ANTI_GASPI)}
  </main>
  ${data.regenere_le ? mentionRegeneration(data.regenere_le) : ''}

</div>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Rapport de don</title>
<style>
${CSS_RAPPORT_V4}
</style>
</head>
<body>
${LOGO_DEFS}
${page}
</body>
</html>`;
}
