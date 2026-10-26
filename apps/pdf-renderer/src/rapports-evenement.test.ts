/**
 * M3.2 — Gabarits des rapports CUMULÉS sur un événement (décision Val
 * 2026-10-26) : recyclage ZD (page de synthèse @3 + détail des collectes) et
 * rapport de don AG (récapitulatif sans valeur fiscale).
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
      { nom: 'Biodéchets', code: 'biodechet', poids_kg: 300 },
      { nom: 'Verre', code: 'verre', poids_kg: 151.1 },
    ],
    poids_total_kg: 451.1,
    co2_evite_kg: 412,
    co2_induit_kg: 58,
    co2_net_kg: -354,
    energie_primaire_evitee_kwh: 2800,
    couverture:
      'Cumul des 2 collectes réalisées, sur 3 collectes de l’événement.',
    collectes: [
      {
        date_collecte: '14/10/2026',
        nb_pax: 800,
        poids_kg: 300.1,
        taux_recyclage: 70.2,
        co2_evite_kg: 280,
        bordereau_numero: 'BSAV-2026-00041',
      },
      {
        date_collecte: '15/10/2026',
        nb_pax: null,
        poids_kg: 151,
        taux_recyclage: null,
        co2_evite_kg: null,
        bordereau_numero: null,
      },
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
    benchmark_legende: 'période 26/10/2024 → 26/10/2026 · lieux : tous',
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

describe('M3.2 — rapport de recyclage cumulé sur un événement', () => {
  it('page de synthèse du rapport @3, sous-titre « Bilan cumulé », puis le détail des collectes', () => {
    const html = renderByType('rapport-recyclage-evenement', zd());
    expect(html).toContain('<div class="rz-ttl">Rapport de recyclage</div>');
    expect(html).toContain('Bilan cumulé de l’événement');
    expect(html).toContain('moyenne des taux figés à la clôture de chaque');
    // Pas de bordereau intégré : il reste dans le rapport de chaque collecte.
    expect(html).not.toContain('bz-annexe');
    expect(html).toContain('<!-- PAGE 2 — Détail des collectes -->');
    expect(html).toContain(
      'Cumul des 2 collectes réalisées, sur 3 collectes de l’événement.',
    );
    expect(html).toContain('BSAV-2026-00041');
    expect(html).toContain('300,1 kg');
    // Valeurs absentes : un tiret, jamais 0.
    const ligne2 = html.slice(html.indexOf('15/10/2026'));
    expect(ligne2.slice(0, ligne2.indexOf('</tr>'))).not.toMatch(/>0[,<]/);
  });

  it('les taux de captation, propres à chaque collecte, ne sont jamais imprimés', () => {
    const html = renderByType(
      'rapport-recyclage-evenement',
      zd({ caps_appliques: { verre: 0.9 } } as never),
    );
    expect(html).not.toContain('class="rz-caps"');
    expect(html).not.toContain('Captation');
  });

  it('radar seulement si demandé', () => {
    expect(renderByType('rapport-recyclage-evenement', zd())).toContain(
      'data-version="sans-radar"',
    );
    const avec = renderByType(
      'rapport-recyclage-evenement',
      zd({ options: { benchmark: true } }),
    );
    expect(avec).toContain('data-version="avec-radar"');
    expect(avec).toContain('Benchmark parc Savr calculé sur');
  });

  it('échappe les textes saisis', () => {
    const html = renderByType(
      'rapport-recyclage-evenement',
      zd({ client_nom: '<script>x</script>' }),
    );
    expect(html).not.toContain('<script>x');
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
