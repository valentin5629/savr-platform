/**
 * M3.2 — Gabarits des rapports CUMULÉS sur un événement (décision Val
 * 2026-10-26) : recyclage ZD (gabarit du rapport @4 d'une collecte, décisions
 * Val 2026-11-12) et rapport de don AG (récapitulatif sans valeur fiscale).
 *
 * Exécuté par le vitest racine seulement (exclu du build Docker du renderer).
 */
import { describe, expect, it } from 'vitest';

import { renderByType } from './render.js';
import type { RapportDonEvenementData } from './templates/rapport-don-evenement.js';
import type { RapportRecyclageEvenementData } from './templates/rapport-recyclage-evenement.js';

const enTete = {
  client_nom: 'Maison Lumière',
  nom_evenement: 'Gala annuel',
  traiteur_nom: 'Traiteur Dupont',
  date_evenement: '14/10/2026',
  lieu_nom: 'Pavillon Gabriel',
  lieu_adresse: '5 avenue Gabriel 75008 Paris',
  nb_pax: 800,
};

function zd(
  overrides: Partial<RapportRecyclageEvenementData> = {},
): RapportRecyclageEvenementData {
  return {
    ...enTete,
    taux_recyclage: 68.3,
    flux: [
      {
        nom: 'Biodéchets',
        code: 'biodechet',
        poids_kg: 300,
        code_dechet_europeen: '20 01 08',
        exutoire: 'Bionerval',
        exutoire_commune: 'Étampes',
        code_traitement: 'R3',
        filiere_valorisation: 'methanisation',
      },
      { nom: 'Verre', code: 'verre', poids_kg: 151.1 },
    ],
    poids_total_kg: 451.1,
    co2_evite_kg: 412,
    co2_induit_kg: 58,
    energie_primaire_evitee_kwh: 2800,
    forfait_transport: { km: 20, fe_camion_kg_km: 0.9 },
    majoration_transport_kg: 36,
    couverture:
      'Cumul des 2 collectes réalisées, sur 3 collectes de l’événement.',
    bordereaux: [
      { numero: 'BSAV-2026-00041', date_emission: '15/10/2026' },
      { numero: 'BSAV-2026-00042', date_emission: '16/10/2026' },
    ],
    benchmark_flux: [
      {
        flux_nom: 'Biodéchets',
        flux_code: 'biodechet',
        collecte_kg_pax: 0.375,
        benchmark_kg_pax: 0.3,
      },
      {
        flux_nom: 'Verre',
        flux_code: 'verre',
        collecte_kg_pax: 0.19,
        benchmark_kg_pax: 0.2,
      },
    ],
    benchmark_effectif: 42,
    benchmark_criteres: 'taille M',
    ...overrides,
  };
}

function ag(
  overrides: Partial<RapportDonEvenementData> = {},
): RapportDonEvenementData {
  return {
    ...enTete,
    couverture:
      'Cumul des 3 collectes réalisées, sur 3 collectes de l’événement.',
    repas_donnes: 420,
    co2_evite_kg: 1050,
    associations: [
      { nom: 'Les Restos du Cœur', ville: 'Paris', repas: 300 },
      { nom: 'Linkee', ville: null, repas: 120 },
    ],
    collectes: [
      {
        date_collecte: '14/10/2026',
        sans_excedent: false,
        association_nom: 'Les Restos du Cœur',
        repas: 300,
        attestation_numero: 'ATT-DON-2026-00012',
      },
      {
        date_collecte: '15/10/2026',
        sans_excedent: false,
        association_nom: 'Linkee',
        repas: 120,
        attestation_numero: null,
      },
      { date_collecte: '16/10/2026', sans_excedent: true, repas: 0 },
    ],
    ...overrides,
  };
}

describe('M3.2 — rapport de recyclage cumulé sur un événement (@2, gabarit du rapport @4)', () => {
  it('même gabarit que le rapport d’une collecte : page 1, puis l’annexe technique, sur-titre « Bilan de l’événement »', () => {
    const html = renderByType('rapport-recyclage-evenement', zd());
    expect(html).toContain('RAPPORT DE RECYCLAGE · BILAN DE L’ÉVÉNEMENT');
    expect(html).toContain('Page 1/2');
    expect(html).toContain('Annexe technique – Traçabilité et méthodologie');
    expect(html).toContain('Page 2/2');
    // Plus de page de synthèse @3, de CO₂ net ni de tableau des collectes.
    expect(html).not.toContain('rz-page');
    expect(html).not.toContain('Émissions nettes');
    expect(html).not.toContain('Détail des collectes');
  });

  it('annexe : couverture puis TOUS les bordereaux des collectes cumulées (Val 2026-11-12)', () => {
    const html = renderByType('rapport-recyclage-evenement', zd());
    expect(html).toContain(
      'Cumul des 2 collectes réalisées, sur 3 collectes de l’événement.<br>Bordereaux n° <span style="white-space:nowrap">BSAV-2026-00041 du 15/10/2026</span> · <span style="white-space:nowrap">BSAV-2026-00042 du 16/10/2026</span>',
    );
    const un = renderByType(
      'rapport-recyclage-evenement',
      zd({
        bordereaux: [{ numero: 'BSAV-1', date_emission: '15/10/2026' }],
      }),
    );
    expect(un).toContain("Bordereau n° BSAV-1 · Date d'émission : 15/10/2026");
    const aucun = renderByType(
      'rapport-recyclage-evenement',
      zd({ bordereaux: [] }),
    );
    expect(aucun).not.toContain('Bordereau');
  });

  it('annexe : exutoire du référentiel, flux non pesé à 0 kg (C5)', () => {
    const html = renderByType('rapport-recyclage-evenement', zd());
    expect(html).toContain('Bionerval, Étampes');
    expect(html).toContain('R3 méthanisation, digestat retourné au sol');
    // Les 5 flux sont imprimés, cartons non pesés à 0 kg.
    expect(html).toContain(
      'Cartons</b></span></td><td class="mono">—</td><td class="num">0\u00a0kg',
    );
  });

  it('transport : forfait « par collecte » et majoration sommée sur les collectes cumulées', () => {
    const html = renderByType('rapport-recyclage-evenement', zd());
    expect(html).toContain('CO₂e/km par collecte (camion 20 m³, diesel)');
    expect(html).toContain('Dont 36\u00a0kg de majoration prudente');
  });

  it('les taux de captation, propres à chaque collecte, ne sont jamais imprimés', () => {
    const html = renderByType(
      'rapport-recyclage-evenement',
      zd({ caps_appliques: { verre: 0.9 } } as never),
    );
    expect(html).not.toContain('captation 90');
  });

  it('radar de l’événement entier, seulement si demandé', () => {
    const sans = renderByType('rapport-recyclage-evenement', zd());
    expect(sans).toContain('data-version="sans-radar"');
    expect(sans).not.toContain('Comparaison aux événements');
    const avec = renderByType(
      'rapport-recyclage-evenement',
      zd({ options: { benchmark: true } }),
    );
    expect(avec).toContain('data-version="avec-radar"');
    expect(avec).toContain('Votre événement</span>');
    expect(avec).not.toContain('Votre collecte');
    expect(avec).toContain(
      'Comparaison aux événements : moyenne Savr sur 24 mois, 42 collectes, critères taille M',
    );
  });

  it('échappe les textes saisis', () => {
    const html = renderByType(
      'rapport-recyclage-evenement',
      zd({
        nom_evenement: '<script>x</script>',
        couverture: '<b>c</b>',
        bordereaux: [{ numero: '<i>n</i>', date_emission: '01/01/2026' }],
      }),
    );
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('<b>c</b>');
    expect(html).not.toContain('<i>n</i>');
  });
});

describe('M3.2 — rapport de don cumulé sur un événement', () => {
  it('titre « Rapport de don », sous-titre « Récapitulatif », mention sans valeur fiscale', () => {
    const html = renderByType('rapport-don-evenement', ag());
    expect(html).toContain('<div class="rz-ttl">Rapport de don</div>');
    expect(html).toContain('Récapitulatif de l’événement');
    expect(html).toContain('Ce récapitulatif ne vaut pas reçu fiscal.');
    // Jamais présenté comme une pièce fiscale.
    expect(html).not.toMatch(/238 bis|2041-GE|Cerfa/);
  });

  it('renvoie aux attestations : numéro émis, « à venir », ou « sans excédent » à 0 repas', () => {
    const html = renderByType('rapport-don-evenement', ag());
    expect(html).toContain('Attestation ATT-DON-2026-00012');
    expect(html).toContain('Attestation à venir');
    expect(html).toContain('Événement sans excédent');
    expect(html).toContain('Soit 0,53 repas par convive.');
    expect(html).toContain('Associations bénéficiaires');
  });

  it('sans convives : repas par convive « — » ; une seule association : titre au singulier', () => {
    const html = renderByType(
      'rapport-don-evenement',
      ag({
        nb_pax: null,
        associations: [{ nom: 'Linkee', repas: 120 }],
      }),
    );
    expect(html).toContain('Soit — repas par convive.');
    expect(html).toContain('Association bénéficiaire<');
  });

  it('chaque association : logo et description du rapport d’impact ; sans logo, son initiale', () => {
    const html = renderByType(
      'rapport-don-evenement',
      ag({
        associations: [
          {
            nom: 'Les Restos du Cœur',
            ville: 'Paris',
            repas: 300,
            description:
              'Aide alimentaire <b>gratuite</b> aux personnes démunies.',
            logo_url: 'data:image/png;base64,AAAA',
          },
          { nom: 'linkee', ville: null, repas: 120, description: null },
        ],
      }),
    );
    expect(html).toContain(
      '<img class="rz-asso-logo" src="data:image/png;base64,AAAA" alt=""/>',
    );
    expect(html).toContain(
      'Aide alimentaire &lt;b&gt;gratuite&lt;/b&gt; aux personnes démunies.',
    );
    expect(html).toContain('rz-asso-initiale">L</div>');
    expect(html.match(/class="rz-asso-desc"/g)).toHaveLength(1);
    expect(html).toContain('300 repas');
  });

  it('seulement des collectes sans excédent : pas de bloc associations', () => {
    const html = renderByType(
      'rapport-don-evenement',
      ag({
        repas_donnes: 0,
        associations: [],
        collectes: [
          { date_collecte: '16/10/2026', sans_excedent: true, repas: 0 },
        ],
      }),
    );
    expect(html).not.toContain('Association bénéficiaire');
    expect(html).toContain('Événement sans excédent');
  });
});
