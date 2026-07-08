/**
 * M1.6 / M2.4 — Renderer PDF : dispatch type_document → HTML + attestation 2041-GE.
 *
 * Couvre BL-P0-03 : le renderer ne renvoie plus 400 sur 'attestation-don' (les 3
 * type_document du contrat partagé rendent), un type inconnu lève (→ 400), et la
 * mention fiscale 2041-GE est conditionnée par habilitee_attestation_fiscale.
 *
 * Exécuté UNIQUEMENT par le vitest racine (workspace complet). Exclu du build
 * Docker du renderer (cf. tsconfig.json exclude) car il importe vitest + @savr/shared.
 */
import { describe, it, expect } from 'vitest';

import {
  renderByType,
  UnknownDocumentTypeError,
  RENDERER_DOCUMENT_TYPES,
  RENDERER_TEMPLATE_VERSIONS,
} from './render.js';

// Le renderer est auto-suffisant (pas de dépendance @savr/shared, cf. Dockerfile) :
// le test ne peut donc PAS importer le contrat partagé. L'égalité renderer ↔ contrat
// @savr/shared (types + versions) est garantie par le gate CI `check:pdf-contract`.
// Ici on vérifie la cohérence INTERNE du renderer contre les valeurs attendues.
const EXPECTED_TYPES = [
  'attestation-don',
  'bordereau-zd',
  'facture',
  'rapport-evenement-sans-excedent',
  'rapport-recyclage-zd',
  'synthese-dashboard',
];
const EXPECTED_VERSIONS: Record<string, string> = {
  'bordereau-zd': 'bordereau-zd@2',
  'rapport-recyclage-zd': 'rapport-recyclage-zd@2',
  'attestation-don': 'attestation-don@2',
  'synthese-dashboard': 'synthese-dashboard@1',
  'rapport-evenement-sans-excedent': 'rapport-evenement-sans-excedent@1',
  facture: 'facture@1',
};
import type { AttestationDonData } from './templates/attestation-don.js';
import type { BordereauZdData } from './templates/bordereau-zd.js';
import type { RapportRecyclageZdData } from './templates/rapport-recyclage-zd.js';
import type { SyntheseDashboardData } from './templates/synthese-dashboard.js';
import type { RapportEvenementSansExcedentData } from './templates/rapport-evenement-sans-excedent.js';
import type { FactureData } from './templates/facture.js';

function bordereauData(
  overrides: Partial<BordereauZdData> = {},
): BordereauZdData {
  return {
    numero: 'BSAV-2026-00001',
    date_emission: '02/07/2026',
    date_collecte: '01/07/2026',
    date_evenement: '01/07/2026',
    nom_evenement: 'Gala',
    lieu_nom: 'Pavillon',
    lieu_adresse: '1 rue X, Paris',
    producteur_raison_sociale: 'Traiteur SA',
    producteur_adresse: '2 rue Y, Paris',
    transporteur_nom: 'Strike',
    exutoire_nom: 'Veolia',
    flux: [
      { nom: 'Biodéchets', poids_kg: 12, nb_bacs: 3 },
      { nom: 'Cartons', poids_kg: 8, equivalent_roll: 2 },
    ],
    poids_total_kg: 20,
    ...overrides,
  };
}

function rapportData(
  overrides: Partial<RapportRecyclageZdData> = {},
): RapportRecyclageZdData {
  return {
    nom_evenement: 'Gala',
    date_evenement: '01/07/2026',
    date_collecte: '01/07/2026',
    lieu_nom: 'Pavillon',
    lieu_adresse: '1 rue X, Paris',
    traiteur_nom: 'Traiteur SA',
    taux_recyclage: 72.5,
    flux: [
      { nom: 'Biodéchets', poids_kg: 12 },
      { nom: 'Cartons', poids_kg: 8 },
    ],
    poids_total_kg: 20,
    co2_evite_kg: 300,
    co2_induit_kg: 40,
    co2_net_kg: -260,
    energie_primaire_evitee_kwh: 9000,
    co2_facteurs_version: 'ADEME 2024',
    equivalences: { km_voiture: 1376, repas_boeuf: 43, foyer: 2 },
    comparaison_savr: { taux_moyen_pondere: 68.4, nb_organisations: 7 },
    benchmark_flux: [
      {
        flux_nom: 'Biodéchets',
        collecte_kg_pax: 0.12,
        benchmark_kg_pax: 0.1,
        nb_collectes_segment: 42,
      },
      {
        flux_nom: 'Cartons',
        collecte_kg_pax: 0.05,
        benchmark_kg_pax: null,
        nb_collectes_segment: 3,
      },
    ],
    benchmark_legende:
      "période : toutes · lieux : tous · type d'événement : Gala · taille : XS",
    bordereau: bordereauData(),
    ...overrides,
  };
}

function attestationData(
  overrides: Partial<AttestationDonData> = {},
): AttestationDonData {
  return {
    numero: 'ATT-DON-2026-00001',
    date_emission: '02/07/2026',
    date_collecte: '01/07/2026',
    nom_evenement: 'Gala',
    date_evenement: '01/07/2026',
    donateur_raison_sociale: 'Traiteur SA',
    donateur_siret: '12345678900012',
    association_nom: 'Restos du Cœur',
    association_adresse: '12 rue de la Solidarité, 75011 Paris',
    association_numero_rup: 'RUP-001',
    mention_fiscale_2041ge: true,
    volume_repas: 120,
    poids_kg: 48,
    co2_evite_kg: 300,
    co2_km_voiture: 1376,
    co2_facteurs_version: 'FAO-2.5',
    ...overrides,
  };
}

function syntheseData(
  overrides: Partial<SyntheseDashboardData> = {},
): SyntheseDashboardData {
  return {
    organisation_nom: 'Traiteur SA',
    perimetre_label: 'traiteur',
    periode_label: '01/01/2026 → 30/06/2026',
    filtres_label: 'Types : Zéro-Déchet',
    date_generation: '07/07/2026 09:12',
    nb_collectes: 3,
    inclut_zd: true,
    inclut_ag: false,
    tonnage_zd_kg: 540,
    tonnage_ag_kg: 0,
    taux_recyclage_moyen_pondere: 82.4,
    nb_repas_donnes: 0,
    co2: {
      evite_kg: 420,
      induit_kg: 90,
      net_kg: 330,
      energie_primaire_evitee_kwh: 1200,
      equiv_km_voiture: 2100,
      facteurs_version: 'ADEME-2025',
    },
    flux_zd: [
      { nom: 'Biodéchets', poids_kg: 300 },
      { nom: 'Emballages', poids_kg: 120 },
      { nom: 'Carton', poids_kg: 80 },
      { nom: 'Verre', poids_kg: 40 },
    ],
    associations_ag: null,
    lieux: [
      { lieu_nom: 'Pavillon', nb_collectes: 2, tonnage_kg: 360 },
      { lieu_nom: 'Carrousel', nb_collectes: 1, tonnage_kg: 180 },
    ],
    traiteurs: null,
    evolution: [
      { mois: '01/26', tonnage_kg: 180, taux_recyclage: 80 },
      { mois: '02/26', tonnage_kg: 360, taux_recyclage: 84 },
    ],
    detail: [
      {
        date_evenement: '15/02/2026',
        evenement: 'Gala',
        lieu: 'Pavillon',
        type: 'ZD',
        tonnage_kg: 360,
        taux_recyclage: 84,
        repas_donnes: null,
      },
    ],
    co2_facteurs_snapshot: {
      biodechet_kgco2_par_kg: 0.12,
      mix_emballages: 'v1',
    },
    ...overrides,
  };
}

function sansExcedentData(
  overrides: Partial<RapportEvenementSansExcedentData> = {},
): RapportEvenementSansExcedentData {
  return {
    nom_evenement: 'Cocktail Élysée',
    date_evenement: '01/07/2026',
    lieu_nom: 'Palais',
    lieu_adresse: '55 rue du Faubourg, 75008 Paris',
    traiteur_nom: 'Traiteur SA',
    nb_pax: 200,
    client_organisateur_nom: 'Mairie de Paris',
    logo_url: null,
    presentation_datetime: '01/07/2026 20:30',
    chauffeur_nom: 'Jean Vélo',
    plaque_immatriculation: 'AB-123-CD',
    motif: 'Client absent / Marchandise refusée',
    reference_facture: 'FAC-2026-00042',
    ...overrides,
  };
}

function factureData(overrides: Partial<FactureData> = {}): FactureData {
  return {
    numero: 'FZD-2026-00124',
    date_emission: '08/07/2026',
    date_echeance: '07/08/2026',
    entite_raison_sociale: 'Kaspia SAS',
    entite_siret: '12345678900001',
    entite_tva_intracom: 'FR12345678900',
    entite_adresse: '12 rue de la Paix',
    entite_code_postal: '75001',
    entite_ville: 'Paris',
    entite_pays: 'FR',
    reference_affaire: 'REF-2026-001',
    conditions_paiement: 'Paiement à 30 jours par virement.',
    devise: 'EUR',
    lignes: [
      {
        designation: 'Collecte Zéro Déchet — Soirée de gala',
        quantite: 1,
        pu_ht: 430,
        taux_tva: 20,
        montant_ht: 430,
      },
      {
        designation: 'Collecte Zéro Déchet — Cocktail',
        quantite: 1,
        pu_ht: 200,
        taux_tva: 10,
        montant_ht: 200,
      },
    ],
    total_ht: 630,
    total_tva: 106,
    total_ttc: 736,
    ...overrides,
  };
}

const DATA_BY_TYPE: Record<string, unknown> = {
  'bordereau-zd': bordereauData(),
  'rapport-recyclage-zd': rapportData(),
  'attestation-don': attestationData(),
  'synthese-dashboard': syntheseData(),
  'rapport-evenement-sans-excedent': sansExcedentData(),
  facture: factureData(),
};

describe('M1.6 / renderer PDF — dispatch type_document', () => {
  it('les 3 type_document du contrat rendent un HTML non vide (plus de 400)', () => {
    expect([...RENDERER_DOCUMENT_TYPES].sort()).toEqual(EXPECTED_TYPES);
    for (const type of RENDERER_DOCUMENT_TYPES) {
      const html = renderByType(type, DATA_BY_TYPE[type]);
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain('<!DOCTYPE html>');
    }
    // Garantit spécifiquement que 'attestation-don' (ex-400) rend désormais.
    expect(renderByType('attestation-don', attestationData())).toContain(
      'Attestation de don',
    );
  });

  it('type inconnu → UnknownDocumentTypeError mappé en 400', () => {
    expect(() => renderByType('facture-pdf', {})).toThrow(
      UnknownDocumentTypeError,
    );
  });

  it('versions de gabarit alignées sur le contrat partagé @savr/shared', () => {
    // Cohérence interne ; l'égalité avec @savr/shared est vérifiée par check:pdf-contract.
    expect(RENDERER_TEMPLATE_VERSIONS).toEqual(EXPECTED_VERSIONS);
  });
});

describe('M2.4 / attestation de don 2041-GE — mention fiscale conditionnelle', () => {
  it('association habilitée → mention fiscale article 238 bis CGI présente', () => {
    const html = renderByType(
      'attestation-don',
      attestationData({ mention_fiscale_2041ge: true }),
    );
    expect(html).toContain('238 bis');
    expect(html).toContain('2041-GE');
    expect(html).toContain('60 %');
  });

  it('association non habilitée → mention neutre, aucune mention 238 bis', () => {
    const html = renderByType(
      'attestation-don',
      attestationData({ mention_fiscale_2041ge: false }),
    );
    expect(html).not.toContain('238 bis');
    expect(html).toContain('aucun avantage fiscal');
  });

  it('contenu §12 §1.3 : adresse association + équivalence km voiture + méthodo FAO', () => {
    const html = renderByType('attestation-don', attestationData());
    // Nom ET adresse de l'association bénéficiaire (CDC §12 l.154).
    expect(html).toContain('12 rue de la Solidarité, 75011 Paris');
    // CO₂e évité + équivalence km voiture + mention méthodo FAO (CDC §12 l.156).
    expect(html).toContain('1376 km en voiture');
    expect(html).toContain(
      'Estimation FAO — 2,5 kgCO₂e par repas sauvé du gaspillage',
    );
  });
});

describe('M2.4 / renderer — rapport « Événement sans excédent » §1.3-bis (BL-P1-RPT-02)', () => {
  it('rend un HTML complet avec en-tête événement + titre dédié', () => {
    const html = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData(),
    );
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Événement sans excédent alimentaire');
    expect(html).toContain('Cocktail Élysée');
    expect(html).toContain('200 convives');
    expect(html).toContain('Mairie de Paris');
    expect(html).toContain('Traiteur SA');
  });

  it('bloc Constat : présentation chauffeur + nom + motif', () => {
    const html = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData(),
    );
    expect(html).toContain('01/07/2026 20:30');
    expect(html).toContain('Jean Vélo');
    expect(html).toContain('Client absent / Marchandise refusée');
  });

  it('bloc Conséquences : mention fixe (aucune attestation 2041-GE, tarif normal) + réf facture', () => {
    const html = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData(),
    );
    expect(html).toContain("Aucun repas n'a été collecté");
    expect(html).toContain('Aucune attestation de don');
    expect(html).toContain('facturée au tarif normal au titre du déplacement');
    expect(html).toContain('FAC-2026-00042');
  });

  it('plaque affichée seulement si fournie (masquée par le batch si !controle_acces_requis)', () => {
    const avec = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData({ plaque_immatriculation: 'AB-123-CD' }),
    );
    expect(avec).toContain('AB-123-CD');
    const sans = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData({ plaque_immatriculation: null }),
    );
    expect(sans).not.toContain('AB-123-CD');
    expect(sans).not.toContain('Véhicule');
  });

  it('texte seul : aucune photo, aucun watermark (V1.1)', () => {
    // logo_url null → aucun <img> du tout (pas de photos §1.3-bis, pas de logo).
    const html = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData({ logo_url: null }),
    );
    expect(html).not.toContain('<img');
    expect(html.toLowerCase()).not.toContain('watermark');
  });

  it('logo cascade §1.2 : logo client rendu en en-tête si fourni, sinon « Savr »', () => {
    const avecLogo = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData({ logo_url: 'https://cdn/agence-logo.png' }),
    );
    expect(avecLogo).toContain('https://cdn/agence-logo.png');
    const sansLogo = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData({ logo_url: null }),
    );
    expect(sansLogo).toContain('logo-savr');
  });

  it('mention de régénération présente uniquement si régénéré (§1.4)', () => {
    const base = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData(),
    );
    expect(base).not.toContain('Version mise à jour');
    const regen = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData({ regenere_le: '07/07/2026' }),
    );
    expect(regen).toContain('Version mise à jour — générée le 07/07/2026');
  });
});

describe('M1.6 / rapport recyclage §1.2 — benchmark + contenu (R21a)', () => {
  it('BL-P1-RPT-01 : 5 jauges benchmark — point rouge parc si segment ≥5, sinon « Données insuffisantes »', () => {
    const html = renderByType('rapport-recyclage-zd', rapportData());
    expect(html).toContain('Benchmark kg/convive par flux');
    // Point rouge parc (segment ≥5) : valeur du parc affichée.
    expect(html).toContain('0,10 kg/convive');
    expect(html).toContain('42 collectes');
    // Segment < 5 (Cartons, nb=3) → pas de point rouge, mention explicite.
    expect(html).toContain('Données insuffisantes pour benchmark');
    // Légende des filtres appliqués (§1.2 l.69) + garde k-anonymat.
    expect(html).toContain("type d'événement : Gala");
    expect(html).toContain('K-anonymat ≥ 5');
  });

  it('BL-P2-18 (1) : équivalences pédagogiques du CO₂ évité (km voiture, repas bœuf, foyers)', () => {
    const html = renderByType('rapport-recyclage-zd', rapportData());
    expect(html).toContain('1 376 km en voiture');
    expect(html).toContain('43 repas avec bœuf');
    expect(html).toContain('2 foyers');
  });

  it('BL-P2-18 (2) : comparaison vs moyenne Savr anonymisée (≥3 acteurs)', () => {
    const html = renderByType('rapport-recyclage-zd', rapportData());
    expect(html).toContain('Comparaison au parc Savr');
    expect(html).toContain('68,4 %'); // moyenne parc
    expect(html).toContain('7 organisations');
  });

  it('BL-P2-18 : camembert par flux (§1.2 l.68) rendu en SVG', () => {
    const html = renderByType('rapport-recyclage-zd', rapportData());
    expect(html).toContain('<svg');
    expect(html).toContain('donut-seg');
  });

  it('BL-P2-20 : mention pied de page uniquement sur un rapport régénéré', () => {
    const base = renderByType('rapport-recyclage-zd', rapportData());
    expect(base).not.toContain('Version mise à jour');
    const regen = renderByType(
      'rapport-recyclage-zd',
      rapportData({ regenere_le: '07/07/2026' }),
    );
    expect(regen).toContain('Version mise à jour — générée le 07/07/2026');
  });

  it('bloc benchmark absent si aucune jauge (collecte sans pesée) — pas de plantage', () => {
    const html = renderByType(
      'rapport-recyclage-zd',
      rapportData({ benchmark_flux: [] }),
    );
    expect(html).not.toContain('Benchmark kg/convive par flux');
    expect(html).toContain('<!DOCTYPE html>');
  });
});

describe('M1.6 / bordereau ZD §1.1 — équivalent bacs/rolls (BL-P2-16)', () => {
  it('colonne « Bacs / Rolls » : bacs si renseigné, sinon rolls', () => {
    const html = renderByType('bordereau-zd', bordereauData());
    expect(html).toContain('3 bacs'); // Biodéchets → nb_bacs
    expect(html).toContain('2 rolls'); // Cartons → equivalent_roll
  });

  it('BL-P2-20 : mention de régénération sur bordereau régénéré', () => {
    const html = renderByType(
      'bordereau-zd',
      bordereauData({ regenere_le: '07/07/2026' }),
    );
    expect(html).toContain('Version mise à jour — générée le 07/07/2026');
  });
});

describe('M2.4 / attestation de don — mention de régénération (BL-P2-20)', () => {
  it('mention pied de page présente uniquement si régénérée', () => {
    const base = renderByType('attestation-don', attestationData());
    expect(base).not.toContain('Version mise à jour');
    const regen = renderByType(
      'attestation-don',
      attestationData({ regenere_le: '07/07/2026' }),
    );
    expect(regen).toContain('Version mise à jour — générée le 07/07/2026');
  });
});

describe('M3.5 / renderer synthèse §12 §1.6 — template agrégé', () => {
  it('export ZD : page de garde + chiffres clés ZD + flux + CO₂ + évolution + détail, PAS de section Anti-Gaspi', () => {
    const html = renderByType('synthese-dashboard', syntheseData());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Rapport de synthèse');
    expect(html).toContain('Traiteur SA');
    // Section 1 chiffres clés + taux pondéré
    expect(html).toContain('1 · Chiffres clés');
    expect(html).toContain('82,4 %');
    // Section 2 flux ZD + Section 5 évolution + CO₂ agrégé
    expect(html).toContain('Ventilation par flux');
    expect(html).toContain('Impact carbone agrégé');
    expect(html).toContain('Évolution mensuelle');
    expect(html).toContain('Biodéchets');
    // Q2 : type figé ZD → PAS de section Anti-Gaspi
    expect(html).not.toContain('Ventilation Anti-Gaspi');
  });

  it('export AG : sections Anti-Gaspi + repas, PAS de flux/évolution/CO₂ ZD (Q2)', () => {
    const html = renderByType(
      'synthese-dashboard',
      syntheseData({
        perimetre_label: 'traiteur',
        inclut_zd: false,
        inclut_ag: true,
        tonnage_zd_kg: 0,
        tonnage_ag_kg: 210,
        taux_recyclage_moyen_pondere: null,
        nb_repas_donnes: 480,
        co2: null,
        flux_zd: null,
        evolution: null,
        associations_ag: [
          {
            association_nom: 'Restos du Cœur',
            nb_collectes: 2,
            repas_donnes: 300,
            poids_kg: 130,
          },
          {
            association_nom: 'Banque Alimentaire',
            nb_collectes: 1,
            repas_donnes: 180,
            poids_kg: 80,
          },
        ],
        detail: [
          {
            date_evenement: '15/02/2026',
            evenement: 'Gala',
            lieu: 'Pavillon',
            type: 'AG',
            tonnage_kg: 130,
            taux_recyclage: null,
            repas_donnes: 300,
          },
        ],
      }),
    );
    expect(html).toContain('Ventilation Anti-Gaspi');
    expect(html).toContain('Restos du Cœur');
    expect(html).toContain('480'); // repas donnés (chiffres clés)
    // Q2 : type figé AG → pas de sections ZD
    expect(html).not.toContain('Ventilation par flux');
    expect(html).not.toContain('Évolution mensuelle');
    expect(html).not.toContain('Impact carbone agrégé');
  });

  it('agrégat vide : PDF valide avec mention « Aucune collecte » (pas de blocage)', () => {
    const html = renderByType(
      'synthese-dashboard',
      syntheseData({
        nb_collectes: 0,
        tonnage_zd_kg: 0,
        taux_recyclage_moyen_pondere: null,
        co2: null,
        flux_zd: [],
        lieux: [],
        evolution: [],
        detail: [],
      }),
    );
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Aucune collecte');
  });

  it('section géographique affichée si ≥2 lieux + ventilation par traiteur si fournie (gestionnaire)', () => {
    const html = renderByType(
      'synthese-dashboard',
      syntheseData({
        perimetre_label: 'gestionnaire de lieux',
        traiteurs: [
          { traiteur_nom: 'Traiteur A', nb_collectes: 2, tonnage_kg: 300 },
          { traiteur_nom: 'Traiteur B', nb_collectes: 1, tonnage_kg: 240 },
        ],
      }),
    );
    expect(html).toContain('Ventilation géographique');
    expect(html).toContain('Ventilation par traiteur');
    expect(html).toContain('Traiteur A');
  });
});

describe('M1.7 / R22b — Facture (copie de travail §06.08 §1) [BL-P2-01/02]', () => {
  it('rend un HTML complet : numéro, client, lignes, totaux HT/TVA/TTC', () => {
    const html = renderByType('facture', factureData());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('FZD-2026-00124');
    expect(html).toContain('Kaspia SAS');
    expect(html).toContain('12345678900001'); // SIRET client
    expect(html).toContain('Collecte Zéro Déchet — Soirée de gala');
    expect(html).toContain('Total HT');
    expect(html).toContain('Total TTC');
    expect(html).toContain('736,00'); // TTC
  });

  it('copie de travail explicite : NON la facture légale (celle-ci = Pennylane)', () => {
    const html = renderByType('facture', factureData());
    expect(html).toContain('Copie de travail');
    expect(html).toContain('Pennylane');
  });

  it('TVA par taux (Bloc 4) : une ligne de total TVA par taux distinct', () => {
    const html = renderByType('facture', factureData());
    // 2 taux distincts (20 % et 10 %) → 2 sous-totaux TVA.
    expect(html).toContain('TVA 20 %');
    expect(html).toContain('TVA 10 %');
  });

  it('fact-mention-tva-293b : AUCUNE mention 293 B (Savr assujettie, N/A V1)', () => {
    // Arbitrage Val 2026-07-08 (_Divergences/M1.7_20260708.md) : Savr est assujettie
    // à la TVA, la franchise en base ne s'applique pas → la mention n'est jamais rendue.
    const html = renderByType('facture', factureData());
    expect(html).not.toContain('293 B');
    expect(html).not.toContain('293B');
    expect(html.toLowerCase()).not.toContain('franchise');
    // Même une facture 100 % à taux 0 ne fait pas apparaître la mention en V1.
    const html0 = renderByType(
      'facture',
      factureData({
        lignes: [
          {
            designation: 'Prestation exonérée',
            quantite: 1,
            pu_ht: 100,
            taux_tva: 0,
            montant_ht: 100,
          },
        ],
        total_ht: 100,
        total_tva: 0,
        total_ttc: 100,
      }),
    );
    expect(html0).not.toContain('293 B');
  });

  it('reference client + conditions de paiement affichées si fournies', () => {
    const html = renderByType('facture', factureData());
    expect(html).toContain('REF-2026-001');
    expect(html).toContain('Paiement à 30 jours par virement.');
  });

  it('pas de watermark (V2) — texte seul', () => {
    const html = renderByType('facture', factureData());
    expect(html.toLowerCase()).not.toContain('watermark');
  });
});
