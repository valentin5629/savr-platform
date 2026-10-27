// Template PDF — Rapport de don cumulé sur un événement (Anti-Gaspi).
//
// RÉCAPITULATIF sans valeur fiscale (décision Val 2026-10-26) : il cumule les
// collectes AG réalisées de l'événement et renvoie aux attestations de don
// numérotées de chaque collecte, seules pièces fiscales. Titre « Rapport de
// don », nom unique des documents AG (décision Val 2026-10-09), sous-titre
// « Récapitulatif de l'événement ». Une collecte sans excédent y figure, à 0
// repas. Fabriqué au clic depuis la fiche événement, jamais stocké.
//
// Identité Savr des rapports @3 (Nunito, bandeau navy) : styles et en-tête
// repris du rapport de recyclage.

import {
  CSS_MARQUE,
  INSECABLE,
  LOGO_DEFS,
  dec,
  enTeteRapport,
  entier,
  esc,
  tonnesCo2,
  type EnTeteRapportData,
} from './rapport-recyclage-zd.js';

// Version figée du gabarit — doit rester égale à
// TEMPLATE_VERSIONS['rapport-don-evenement'] du contrat partagé (@savr/shared).
// Vérifié par check:pdf-contract.
export const TEMPLATE_VERSION = 'rapport-don-evenement@1';

/** Une collecte AG réalisée de l'événement. */
export interface LigneCollecteDon {
  /** « JJ/MM/AAAA ». */
  date_collecte: string;
  sans_excedent: boolean;
  association_nom?: string | null;
  repas: number;
  /** Numéro de l'attestation de don (ATT-DON-…), null tant qu'elle n'est pas émise. */
  attestation_numero?: string | null;
}

export interface AssociationDon {
  nom: string;
  ville?: string | null;
  repas: number;
  /** « Description pour le rapport d'impact » de la fiche association. */
  description?: string | null;
  /** Logo inliné en data URI ; absent = initiale de l'association. */
  logo_url?: string | null;
}

export interface RapportDonEvenementData extends EnTeteRapportData {
  /** « Cumul des 2 collectes réalisées, sur 3 collectes de l'événement. » */
  couverture: string;
  repas_donnes: number;
  co2_evite_kg?: number | null;
  associations: AssociationDon[];
  collectes: LigneCollecteDon[];
}

const VIDE = '—';

function piece(c: LigneCollecteDon): string {
  if (c.sans_excedent) return 'Événement sans excédent';
  return c.attestation_numero
    ? `Attestation ${esc(c.attestation_numero)}`
    : 'Attestation à venir';
}

export function renderRapportDonEvenement(
  data: RapportDonEvenementData,
): string {
  const { bandeau, meta } = enTeteRapport(
    data,
    'Rapport de don',
    'Récapitulatif de l’événement',
  );
  const repasParPax =
    data.nb_pax && data.nb_pax > 0
      ? dec(data.repas_donnes / data.nb_pax, 2)
      : VIDE;

  const associations = data.associations
    .map((a) => {
      const logo = a.logo_url
        ? `<img class="rz-asso-logo" src="${esc(a.logo_url)}" alt=""/>`
        : `<div class="rz-asso-logo rz-asso-initiale">${esc(a.nom.trim().charAt(0).toUpperCase())}</div>`;
      return `<div class="rz-asso">
        ${logo}
        <div class="rz-asso-corps">
          <div class="rz-asso-tete"><span class="rz-asso-nom">${esc(a.nom)}</span>${a.ville ? `<span class="rz-asso-ville">${esc(a.ville)}</span>` : ''}<span class="rz-asso-repas">${entier(a.repas)} repas</span></div>
          ${a.description ? `<p class="rz-asso-desc">${esc(a.description)}</p>` : ''}
        </div>
      </div>`;
    })
    .join('');
  const collectes = data.collectes
    .map(
      (c) =>
        `<tr><td>${esc(c.date_collecte)}</td><td>${c.sans_excedent ? VIDE : esc(c.association_nom) || VIDE}</td><td class="rz-num">${entier(c.repas)}</td><td>${piece(c)}</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
${CSS_MARQUE}
  .rz-sous-titre { font-size: 12px; font-weight: 600; color: #bdc8e5; margin-top: 4px; white-space: nowrap; }
  .rz-page.rz-don { height: auto; min-height: 1122px; overflow: visible; }
  .rz-don .rz-body { gap: 14px; }
  .rz-assos { display: flex; flex-direction: column; }
  .rz-asso { display: flex; gap: 14px; align-items: flex-start; padding: 12px 0; border-top: 1px solid #dde1eb; break-inside: avoid; }
  .rz-asso:first-child { border-top: 0; padding-top: 4px; }
  .rz-asso-logo { width: 56px; height: 56px; flex: none; object-fit: contain; border-radius: 8px; border: 1px solid #dde1eb; background: #fff; }
  .rz-asso-initiale { display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; color: #223870; background: #eff2f9; }
  .rz-asso-corps { flex: 1; min-width: 0; }
  .rz-asso-tete { display: flex; align-items: baseline; gap: 10px; }
  .rz-asso-nom { font-size: 13.5px; font-weight: 700; color: #223870; }
  .rz-asso-ville { font-size: 11.5px; color: #6e7790; }
  .rz-asso-repas { margin-left: auto; font-size: 12.5px; font-weight: 700; color: #223870; white-space: nowrap; }
  .rz-asso-desc { margin: 5px 0 0; font-size: 11.5px; color: #3c4459; line-height: 1.5; }
  .rz-couv { font-size: 12.5px; color: #515a72; }
  .rz-fiscal { border: 1px solid #fde68a; background: #fffbeb; border-radius: 8px; padding: 12px 16px; font-size: 11.5px; color: #3c4459; line-height: 1.5; }
  .rz-fiscal b { color: #92400e; }
  .rz-pied { font-size: 9.5px; color: #6e7790; border-top: 1px solid #dde1eb; padding-top: 9px; }
</style>
</head>
<body>
${LOGO_DEFS}

<div class="rz-page rz-don">
  ${bandeau}
  <div class="rz-body">
    ${meta}
    <p class="rz-couv">${esc(data.couverture)}</p>
    <div class="rz-duo">
      <div class="rz-card rz-hero rz-pave">
        <div class="rz-h2">Repas donnés</div>
        <div class="rz-chiffre">${entier(data.repas_donnes)}</div>
        <div class="rz-eq-fort">Soit ${repasParPax} repas par convive.</div>
      </div>
      <div class="rz-card rz-pave">
        <div class="rz-h2">CO₂ évité</div>
        <div class="rz-chiffre rz-chiffre-40">${data.co2_evite_kg != null ? tonnesCo2(data.co2_evite_kg) : VIDE}</div>
        <div class="rz-methode rz-methode-11">Estimation FAO — 2,5${INSECABLE}kgCO₂e par repas sauvé du gaspillage.</div>
      </div>
    </div>

    ${
      associations
        ? `<div class="rz-card rz-card-large">
      <div class="rz-h2">${data.associations.length > 1 ? 'Associations bénéficiaires' : 'Association bénéficiaire'}</div>
      <div class="rz-assos">${associations}</div>
    </div>`
        : ''
    }

    <div class="rz-card rz-card-large">
      <div class="rz-h2">Détail des collectes</div>
      <table class="rz-tbl">
        <tr><th>Date de collecte</th><th>Association</th><th class="rz-num">Repas</th><th>Pièce justificative</th></tr>
        ${collectes}
        <tr class="rz-tot"><td>Total</td><td></td><td class="rz-num">${entier(data.repas_donnes)}</td><td></td></tr>
      </table>
    </div>

    <div class="rz-fiscal"><b>Ce récapitulatif ne vaut pas reçu fiscal.</b> Seules les attestations de don numérotées, émises pour chaque collecte, font foi ; elles se téléchargent depuis la fiche de chaque collecte.</div>

    <div class="rz-pied">Document généré par Savr · gosavr.io</div>
  </div>
</div>

</body>
</html>`;
}
