// Template PDF — « Rapport de don » d'une collecte anti-gaspi avec excédents.
//
// Gabarit @5 (2026-11-16) : maquette illustrée validée par Val dans Claude Design,
// copiée dans design/rapport-de-don/2026-11-16/RapportDon.dc.html (une seule page,
// la page 2 « attestation de collecte et de remise » est reportée, Val
// 2026-11-16). Bandeau et encart Savr = ceux du rapport de recyclage @4, logo à
// coin orange (anti-gaspi). Le type de document reste `attestation-don` : même
// file, même stockage, même nom de fichier « Rapport de don ».
//
// Plus aucune mention fiscale imprimée (Cerfa 2041-GE, article 238 bis, n° RUP,
// donateur) : le rapport montre le parcours du don, l'association et l'impact
// estimé (décision Val, maquette du 2026-11-10 au 2026-11-16). Les champs du
// donateur et de l'habilitation restent dans le contenu reçu, sans être imprimés.
//
// Données : chiffres figés par le lot des attestations (batch-pdf-j1-ag.ts, ou le
// trigger de correction de volume), complétés au rendu par le contexte visuel
// (lieu, convives, logos, association, photo cochée) : lib/pdf/contexte-rapports-de-don.ts.

import {
  COIN_ANTI_GASPI,
  CSS_RAPPORT_V4,
  INSECABLE,
  LOGO_DEFS,
  bandeauRapportV4,
  croix,
  dec,
  encartSavr,
  entier,
  esc,
} from './rapport-recyclage-zd.js';

// Version figée du gabarit — doit rester égale à TEMPLATE_VERSIONS['attestation-don']
// du contrat partagé (@savr/shared/src/pdf/document-types.ts). Vérifié par le gate
// CI check:integration-contracts. Incrémenter @N à toute modif structurelle.
// @2 (R21a) : mention pied de page de régénération (§12 §1.4).
// @3 : titre « Rapport de don », « Attestation de don » en sous-titre (§12 §1.3-bis).
// @4 : logo du client à côté de « Savr » dans l'en-tête (décision Val 2026-10-30).
// @5 : rapport illustré d'une page (maquette Val 2026-11-16), sans mention fiscale.
export const TEMPLATE_VERSION = 'attestation-don@5';

/** Facteur voiture imprimé et appliqué aux km (ADEME, décision Val 2026-11-10). */
export const KGCO2E_PAR_KM_VOITURE = 0.256;

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
  /** Snapshot associations.habilitee_attestation_fiscale (plus imprimé depuis @5). */
  mention_fiscale_2041ge: boolean;
  volume_repas: number;
  poids_kg?: number | null;
  co2_evite_kg?: number | null;
  /** Ancienne équivalence figée à 0,218 kgCO₂e/km : plus imprimée depuis @5. */
  co2_km_voiture?: number | null;
  co2_facteurs_version?: string | null;
  /** Mention de régénération (§12 §1.4) — présente uniquement sur un document régénéré. */
  regenere_le?: string | null;
  /** Logos du bandeau (data URI) : client, puis traiteur. */
  logo_client_url?: string | null;
  logo_traiteur_url?: string | null;

  // ── Contexte visuel, complété au rendu (lib/pdf/contexte-rapports-de-don) ──
  lieu_nom?: string | null;
  nb_pax?: number | null;
  association_ville?: string | null;
  /** Logo de l'association (data URI) ; absent : initiale du nom. */
  association_logo_url?: string | null;
  /** associations.description_rapport_impact. */
  association_description?: string | null;
  /** Photo de la collecte cochée par Savr (data URI) ; absente : encadré pleine largeur. */
  photo_url?: string | null;
  /** Facteur CO₂e évité par équivalent repas de la collecte (snapshot du calcul). */
  co2_facteur_repas_kg?: number | null;
}

const H2 =
  'margin: 0; font-family: Archivo, Inter, sans-serif; font-size: 22px; font-weight: 800; color: #223870; letter-spacing: -0.01em; line-height: 1.15; text-wrap: balance;';
const INTERCALAIRE =
  '<div aria-hidden="true" style="flex: 1 1 0; min-height: 10px; max-height: 24px;"></div>';
const LIBELLE_ETAPE =
  'margin-top: 12px; font-size: 11.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #515a72;';
const rond = (fond: string, icone: string) =>
  `<span style="width: 64px; height: 64px; border-radius: 9999px; background: ${fond}; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 8px #ffffff;">${icone}</span>`;
const ICONE_REPERE =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"></path><circle cx="12" cy="10" r="2.4"></circle></svg>';
const ICONE_CAMION =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5h11v9H2z"></path><path d="M13 9.5h4.2l3.3 3.4v2.6H13z"></path><circle cx="6" cy="17.5" r="1.9"></circle><circle cx="17" cy="17.5" r="1.9"></circle></svg>';
const ICONE_COEUR =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#223870" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"></path></svg>';
const ICONE_NUAGE =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z"></path></svg>';
const ICONE_VOITURE =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#223870" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 16.5v-3.2l2-4.6a2 2 0 0 1 1.8-1.2h9.4a2 2 0 0 1 1.8 1.2l2 4.6v3.2z"></path><path d="M3.5 13.3h17"></path><circle cx="7.5" cy="16.8" r="1.6"></circle><circle cx="16.5" cy="16.8" r="1.6"></circle></svg>';

/** Poids : entier quand il l'est, sinon une décimale (« 139,5 kg »). */
function kgFrise(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? entier(r) : dec(r, 1)}${INSECABLE}kg`;
}

/** Chiffre de la frise réduit quand il ne tiendrait pas dans sa colonne en 40px. */
function tailleChiffre(texte: string): string {
  return texte.length <= 8
    ? ''
    : texte.length <= 10
      ? ' font-size: 32px;'
      : ' font-size: 26px;';
}

/**
 * Lignes au plus de la description de l'association : un garde-fou, sans effet
 * sur un texte qui tient. Mesuré (2026-11-16) : 8 lignes tiennent quand le nom
 * de l'événement tient sur une ligne du bandeau, 6 sur deux (≈ 310 caractères
 * avec photo, ≈ 540 sans). Un nom de plus de 20 caractères est compté sur deux
 * lignes (le titre du bandeau est coupé à deux lignes).
 */
const LIGNES_DESCRIPTION = {
  titreUneLigne: 8,
  titreDeuxLignes: 6,
} as const;
const NOM_SUR_UNE_LIGNE = 20;

/** Mention de régénération (§12 §1.4), dans la marge du bas : n'occupe aucune place. */
export const mentionRegeneration = (le: string) =>
  `<p style="position: absolute; left: 48px; bottom: 10px; margin: 0; font-size: 10px; font-style: italic; color: #9a5600;">Version mise à jour — générée le ${esc(le)}</p>`;

/** Ligne de méthode : facteur de la collecte et sa source. */
function ligneFacteur(facteur: number | null | undefined): string {
  if (facteur == null || !(facteur > 0)) return '';
  const valeur = `${dec(facteur, 2)}${INSECABLE}kgCO₂e évités par équivalent repas`;
  // 2,5 kg = estimation FAO, facteur en vigueur avant le 2026-11-06 : la source
  // imprimée est celle du facteur réellement appliqué à la collecte.
  const source =
    Math.abs(facteur - 2.5) < 0.005
      ? 'estimation FAO, facteur en vigueur lors du calcul'
      : 'facteur moyen « Repas moyen », Base Carbone ADEME';
  return `${valeur} (${source}) · `;
}

export function renderAttestationDon(data: AttestationDonData): string {
  const repas = Math.max(0, Math.round(data.volume_repas || 0));
  const unRepas = repas === 1;
  const titre = unRepas
    ? `Grâce à vous c'est l'équivalent de 1${INSECABLE}repas qui a été redistribué à des personnes dans le besoin`
    : `Grâce à vous c'est l'équivalent de ${entier(repas)} repas qui ont été redistribués à des personnes dans le besoin`;
  const poidsTxt = data.poids_kg != null ? kgFrise(data.poids_kg) : '—';
  const repasTxt = entier(repas);

  const nomAsso = data.association_nom?.trim() || 'Association bénéficiaire';
  const initiale = esc(
    nomAsso
      .replace(/^association\s+/i, '')
      .charAt(0)
      .toUpperCase(),
  );
  const logoAsso = data.association_logo_url
    ? `<img src="${esc(data.association_logo_url)}" alt="Logo de l'association" style="max-width: 100%; max-height: 100%; object-fit: contain; display: block;">`
    : `<span style="font-family: Archivo, Inter, sans-serif; font-size: 30px; font-weight: 800; color: #223870; line-height: 1;">${initiale}</span>`;
  const avecPhoto = !!data.photo_url;
  const lignes =
    (data.nom_evenement ?? '').length <= NOM_SUR_UNE_LIGNE
      ? LIGNES_DESCRIPTION.titreUneLigne
      : LIGNES_DESCRIPTION.titreDeuxLignes;
  const description = data.association_description?.trim()
    ? `<p style="margin: 0; font-size: 14px; line-height: 1.5; color: #3c4459; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: ${lignes}; overflow: hidden;">${esc(data.association_description.trim())}</p>`
    : '';
  const photo = avecPhoto
    ? `<div style="position: relative; min-height: 120px; border-radius: 16px; overflow: hidden; background: #eef0f5;"><img src="${esc(data.photo_url)}" alt="Photo de la collecte" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block;"></div>`
    : '';

  const co2 = data.co2_evite_kg;
  const impact =
    co2 != null
      ? `<section aria-label="Impact" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;">
      <div style="display: flex; align-items: center; justify-content: center; gap: 13px; border: 1.5px solid #e3e7ef; border-radius: 16px; padding: 8px 16px; background: #ffffff;">
        <span style="flex-shrink: 0; width: 40px; height: 40px; border-radius: 9999px; background: #ff9b00; display: flex; align-items: center; justify-content: center;">${ICONE_NUAGE}</span>
        <div><div style="font-family: Archivo, Inter, sans-serif; font-size: 22px; font-weight: 800; color: #223870; letter-spacing: -0.02em; line-height: 1.05;">${entier(co2)}${INSECABLE}kg</div><div style="margin-top: 2px; font-size: 11px; font-weight: 500; color: #515a72;">CO₂e évités (estimation)</div></div>
      </div>
      <div style="display: flex; align-items: center; justify-content: center; gap: 13px; border: 1.5px solid #e3e7ef; border-radius: 16px; padding: 8px 16px; background: #ffffff;">
        <span style="flex-shrink: 0; width: 40px; height: 40px; border-radius: 9999px; background: #ffbd59; display: flex; align-items: center; justify-content: center;">${ICONE_VOITURE}</span>
        <div><div style="font-family: Archivo, Inter, sans-serif; font-size: 22px; font-weight: 800; color: #223870; letter-spacing: -0.02em; line-height: 1.05;">≈${INSECABLE}${entier(co2 / KGCO2E_PAR_KM_VOITURE)}${INSECABLE}km</div><div style="margin-top: 2px; font-size: 11px; font-weight: 500; color: #515a72;">en voiture, même CO₂e</div></div>
      </div>
    </section>


    <section aria-label="Méthode" style="margin-top: 10px; display: flex; flex-direction: column; gap: 3px; font-size: 10px; line-height: 1.45; color: #6e7790;">
      <p style="margin: 0;">Estimation Savr, à partir des poids relevés à la collecte et des facteurs d’émission de la Base Carbone ADEME. Elle porte sur les déchets et excédents collectés par Savr. Des émissions évitées se présentent à part : elles ne se déduisent pas d’un bilan carbone.</p>
      <p style="margin: 0;">1 équivalent repas = 450 g de denrées (hypothèse Savr) · ${ligneFacteur(data.co2_facteur_repas_kg)}Voiture : 0,256 kgCO₂e/km (ADEME) · Méthode détaillée : <span style="color: #223870; text-decoration: underline;">app.gosavr.io/methode-co2</span></p>
    </section>`
      : '';

  const page = `<div class="pg-1">

  ${croix(250, 'position: absolute; left: -80px; bottom: -70px; transform: rotate(-45deg);', '#fff4e0')}
  ${croix(170, 'position: absolute; right: -55px; bottom: 130px; transform: rotate(-45deg);', '#eef1f7')}

  ${bandeauRapportV4({
    surTitre: 'RAPPORT DE DON',
    nomEvenement: data.nom_evenement ?? '',
    lieu: data.lieu_nom ?? '',
    dateEvenement: data.date_evenement,
    convives: data.nb_pax != null && data.nb_pax > 0 ? data.nb_pax : null,
    logos: [data.logo_client_url, data.logo_traiteur_url],
    coin: COIN_ANTI_GASPI,
  })}

  <main style="position: relative; flex: 1; min-height: 0; padding: 26px 48px 7px; display: flex; flex-direction: column;">

    <section aria-label="Parcours du don">
      <h2 style="${H2}">${titre}</h2>
      <div style="position: relative; margin-top: 20px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; text-align: center;">
        <div aria-hidden="true" style="position: absolute; left: 16.67%; right: 16.67%; top: 31px; border-top: 2.5px dashed #ffbd59;"></div>
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; min-width: 0;">
          ${rond('#ff9b00', ICONE_REPERE)}
          <span style="${LIBELLE_ETAPE}">En fin d'événement</span>
          <span style="margin-top: 6px; font-family: Archivo, Inter, sans-serif; font-size: 40px; font-weight: 800; color: #b36400; letter-spacing: -0.02em; line-height: 1;${tailleChiffre(poidsTxt)}">${poidsTxt}</span>
          <span style="margin-top: 5px; font-family: Archivo, Inter, sans-serif; font-size: 16px; font-weight: 700; color: #223870; line-height: 1.2;">collectés</span>
        </div>
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; min-width: 0;">
          ${rond('#223870', ICONE_CAMION)}
          <span aria-hidden="true" style="${LIBELLE_ETAPE}">&nbsp;</span>
          <span style="margin-top: 6px; font-family: Archivo, Inter, sans-serif; font-size: 26px; font-weight: 800; color: #223870; letter-spacing: -0.01em; line-height: 1.1;">Livrés à<br>l'association</span>
        </div>
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; min-width: 0;">
          ${rond('#ffbd59', ICONE_COEUR)}
          <span style="${LIBELLE_ETAPE}">À table</span>
          <span style="margin-top: 6px; font-family: Archivo, Inter, sans-serif; font-size: 40px; font-weight: 800; color: #b36400; letter-spacing: -0.02em; line-height: 1;${tailleChiffre(repasTxt)}">${repasTxt}</span>
          <span style="margin-top: 5px; font-family: Archivo, Inter, sans-serif; font-size: 16px; font-weight: 700; color: #223870; line-height: 1.2;">${unRepas ? 'équivalent repas' : 'équivalents repas'}</span>
        </div>
      </div>
    </section>

    ${INTERCALAIRE}

    <section aria-label="Association bénéficiaire" style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;">
      <h2 style="${H2}">Qui en a profité ?</h2>
      <div style="flex: 1; min-height: 0; margin-top: 8px; display: grid; gap: 12px; grid-template-columns: ${avecPhoto ? 'minmax(0, 1.8fr) minmax(0, 1fr)' : 'minmax(0, 1fr)'};">
        <div style="background: #fff4e0; border-radius: 16px; padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; min-width: 0; overflow: hidden;">
          <div style="display: flex; align-items: center; gap: 16px; min-width: 0;">
            <div style="flex-shrink: 0; width: 112px; height: 60px; border-radius: 14px; background: #ffffff; box-sizing: border-box; padding: 8px; display: flex; align-items: center; justify-content: center;">
              ${logoAsso}
            </div>
            <div style="min-width: 0;">
              <div style="font-family: Archivo, Inter, sans-serif; font-size: 20px; font-weight: 800; color: #223870; letter-spacing: -0.01em; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${esc(nomAsso)}</div>
              ${data.association_ville ? `<div style="margin-top: 3px; font-size: 13px; font-weight: 600; color: #515a72;">${esc(data.association_ville)}</div>` : ''}
            </div>
          </div>
          ${description}
        </div>
        ${photo}
      </div>
    </section>

    ${INTERCALAIRE}

    ${impact}

    ${encartSavr('margin-top: 10px; margin-bottom: 34px; ', COIN_ANTI_GASPI)}
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
