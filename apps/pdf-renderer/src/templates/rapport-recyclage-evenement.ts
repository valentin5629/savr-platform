// Template PDF — Rapport de recyclage cumulé sur un événement (Zéro Déchet).
//
// Fabriqué au clic depuis la fiche événement (décision Val 2026-10-26), jamais
// stocké. Page 1 = la page de synthèse du rapport d'une collecte (@3), avec ou
// sans radar au choix du demandeur, sur les chiffres CUMULÉS des collectes ZD
// réalisées de l'événement (mêmes règles que le bilan consolidé de l'écran).
// Page 2 = le détail des collectes cumulées ; les bordereaux de pesée restent
// dans le rapport de chaque collecte.

import {
  esc,
  entier,
  kg,
  pct,
  renderSyntheseRecyclage,
  tonnesCo2,
  type SyntheseRecyclageData,
} from './rapport-recyclage-zd.js';

// Version figée du gabarit — doit rester égale à
// TEMPLATE_VERSIONS['rapport-recyclage-evenement'] du contrat partagé
// (@savr/shared). Vérifié par check:pdf-contract.
export const TEMPLATE_VERSION = 'rapport-recyclage-evenement@1';

/** Une collecte ZD réalisée de l'événement. */
export interface LigneCollecteRecyclage {
  /** « JJ/MM/AAAA ». */
  date_collecte: string;
  nb_pax?: number | null;
  poids_kg: number;
  taux_recyclage?: number | null;
  co2_evite_kg?: number | null;
  bordereau_numero?: string | null;
}

export interface RapportRecyclageEvenementData extends Omit<
  SyntheseRecyclageData,
  'caps_appliques' | 'logo_url'
> {
  /** « Cumul des 2 collectes réalisées, sur 3 collectes de l'événement. » */
  couverture: string;
  collectes: LigneCollecteRecyclage[];
}

const VIDE = '—';

export function renderRapportRecyclageEvenement(
  data: RapportRecyclageEvenementData,
): string {
  const lignes = data.collectes
    .map(
      (c) =>
        `<tr><td>${esc(c.date_collecte)}</td><td class="rz-num">${c.nb_pax ? entier(c.nb_pax) : VIDE}</td><td class="rz-num">${kg(c.poids_kg)}</td><td class="rz-num">${c.taux_recyclage != null ? pct(c.taux_recyclage) : VIDE}</td><td class="rz-num">${c.co2_evite_kg != null ? tonnesCo2(c.co2_evite_kg) : VIDE}</td><td>${esc(c.bordereau_numero) || VIDE}</td></tr>`,
    )
    .join('');

  return renderSyntheseRecyclage(
    // Les taux de captation diffèrent d'une collecte à l'autre : pas de ligne
    // « Captation » sous la méthodologie d'un cumul.
    { ...data, caps_appliques: null },
    {
      titre: 'Rapport de recyclage',
      sousTitre: 'Bilan cumulé de l’événement',
      mentionTaux:
        'Calculé selon la méthode UE 2019/1004 — moyenne des taux figés à la clôture de chaque collecte, pondérée par leur poids. Voir Méthodologie.',
      cssSuite: `
  .rz-sous-titre { font-size: 12px; font-weight: 600; color: #bdc8e5; margin-top: 4px; white-space: nowrap; }
  /* Page 2 : détail des collectes, sur autant de pages qu'il faut. */
  .rz-page.rz-suite { break-before: page; height: auto; min-height: 1122px; overflow: visible; }
  .rz-suite .rz-body { padding-top: 32px; gap: 12px; }
  .rz-couv { font-size: 12.5px; color: #515a72; }
`,
      suite: `<!-- PAGE 2 — Détail des collectes -->
<div class="rz-page rz-suite">
  <div class="rz-body">
    <div class="rz-h2">Détail des collectes</div>
    <p class="rz-couv">${esc(data.couverture)}</p>
    <table class="rz-tbl">
      <tr><th>Date de collecte</th><th class="rz-num">Convives</th><th class="rz-num">Poids collecté</th><th class="rz-num">Taux de recyclage</th><th class="rz-num">CO₂ évité</th><th>Bordereau</th></tr>
      ${lignes}
      <tr class="rz-tot"><td>Total</td><td class="rz-num"></td><td class="rz-num">${kg(data.poids_total_kg)}</td><td class="rz-num">${data.taux_recyclage != null ? pct(data.taux_recyclage) : VIDE}</td><td class="rz-num">${data.co2_evite_kg != null ? tonnesCo2(data.co2_evite_kg) : VIDE}</td><td></td></tr>
    </table>
    <div class="rz-mention">Le bordereau de pesée de chaque collecte est annexé à son propre rapport de recyclage, téléchargeable depuis sa fiche.</div>
  </div>
</div>
`,
    },
  );
}
