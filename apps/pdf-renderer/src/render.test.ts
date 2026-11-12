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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  'rapport-don-evenement',
  'rapport-evenement-sans-excedent',
  'rapport-recyclage-evenement',
  'rapport-recyclage-zd',
  'synthese-dashboard',
];
const EXPECTED_VERSIONS: Record<string, string> = {
  'bordereau-zd': 'bordereau-zd@2',
  'rapport-recyclage-zd': 'rapport-recyclage-zd@4',
  'attestation-don': 'attestation-don@4',
  'synthese-dashboard': 'synthese-dashboard@1',
  'rapport-evenement-sans-excedent': 'rapport-evenement-sans-excedent@2',
  facture: 'facture@1',
  'rapport-recyclage-evenement': 'rapport-recyclage-evenement@2',
  'rapport-don-evenement': 'rapport-don-evenement@1',
};
import type { AttestationDonData } from './templates/attestation-don.js';
import type { BordereauZdData } from './templates/bordereau-zd.js';
import type { RapportRecyclageZdData } from './templates/rapport-recyclage-zd.js';
import { SAVR_LOGO_MASK } from './templates/assets/marque.js';
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

const REFERENTIEL_FLUX = {
  emballage: {
    nom: 'Emballages',
    code_dechet_europeen: '15 01 06',
    exutoire: 'CENTRE DE TRI SELECTIF PAPREC TRIVALO 93',
    exutoire_commune: 'Le Blanc-Mesnil',
    code_traitement: 'R3/R5',
    filiere_valorisation: 'recyclage',
  },
  biodechet: {
    nom: 'Biodéchets',
    code_dechet_europeen: '20 01 08',
    exutoire: 'GENERIS VSG DCDT',
    exutoire_commune: 'Villeneuve-Saint-Georges',
    code_traitement: 'R3',
    filiere_valorisation: 'methanisation',
  },
  verre: {
    nom: 'Verre',
    code_dechet_europeen: '15 01 07',
    exutoire: 'REVIVAL GENNEVILLIERS TRSFT',
    exutoire_commune: 'Gennevilliers',
    code_traitement: 'R5',
    filiere_valorisation: 'recyclage',
  },
  carton: {
    nom: 'Cartons',
    code_dechet_europeen: '15 01 01',
    exutoire: 'TAIS VILLENEUVE LE ROI TDI',
    exutoire_commune: 'Villeneuve-le-Roi',
    code_traitement: 'R3',
    filiere_valorisation: 'recyclage',
  },
  dechet_residuel: {
    nom: 'Déchet résiduel',
    code_dechet_europeen: '20 03 01',
    exutoire: 'NOVAZUR ARGENTEUIL UVEND',
    exutoire_commune: 'Argenteuil',
    code_traitement: 'R1',
    filiere_valorisation: 'valorisation_energetique',
  },
} as const;

/** Rapport d'une collecte (gabarit @4), sans radar par défaut. */
function rapportData(
  overrides: Partial<RapportRecyclageZdData> = {},
): RapportRecyclageZdData {
  const poids = {
    emballage: 23.1,
    biodechet: 86.4,
    verre: 54.2,
    carton: 31.7,
    dechet_residuel: 38.6,
  } as const;
  return {
    nom_evenement: 'Gala',
    date_evenement: '01/07/2026',
    lieu_nom: 'Pavillon',
    nb_pax: 420,
    taux_recyclage: 72.5,
    flux: (Object.keys(poids) as (keyof typeof poids)[]).map((code) => ({
      code,
      poids_kg: poids[code],
      ...REFERENTIEL_FLUX[code],
    })),
    poids_total_kg: 234,
    co2_evite_kg: 312,
    co2_induit_kg: 341,
    energie_primaire_evitee_kwh: 9000,
    equivalences: { km_voiture: 1431 },
    forfait_transport: { km: 25, fe_camion_kg_km: 0.4 },
    caps_appliques: {
      verre: 0.95,
      carton: 0.85,
      biodechet: 0.9,
      emballage: 0.7,
      version_parametres_at: '2026-07-02 06:00:00+02',
    },
    bordereau_numero: 'BSAV-2026-00042',
    bordereau_date_emission: '02/07/2026',
    benchmark_flux: [
      {
        flux_nom: 'Biodéchets',
        flux_code: 'biodechet',
        collecte_kg_pax: 0.21,
        benchmark_kg_pax: 0.24,
      },
      {
        flux_nom: 'Emballages',
        flux_code: 'emballage',
        collecte_kg_pax: 0.055,
        benchmark_kg_pax: 0.05,
      },
      {
        flux_nom: 'Cartons',
        flux_code: 'carton',
        collecte_kg_pax: 0.075,
        benchmark_kg_pax: 0.06,
      },
      {
        flux_nom: 'Verre',
        flux_code: 'verre',
        collecte_kg_pax: 0.13,
        benchmark_kg_pax: 0.09,
      },
      {
        flux_nom: 'Déchet résiduel',
        flux_code: 'dechet_residuel',
        collecte_kg_pax: 0.092,
        benchmark_kg_pax: 0.11,
      },
    ],
    benchmark_effectif: 37,
    benchmark_criteres: 'taille M, gala',
    ...overrides,
  };
}

/** Rapport demandé AVEC le radar (option cochée dans la fiche collecte). */
function rapportAvecRadar(
  overrides: Partial<RapportRecyclageZdData> = {},
): string {
  return renderByType(
    'rapport-recyclage-zd',
    rapportData({ options: { benchmark: true }, ...overrides }),
  );
}

/** Page 1 seule, et page 2 seule (annexe technique). */
function page1(html: string): string {
  return html.slice(0, html.indexOf('<!-- PAGE 2'));
}
function page2(html: string): string {
  return html.slice(html.indexOf('<!-- PAGE 2'));
}

/** Sommets du polygone « Votre collecte » du radar. */
const sommetsRadar = (html: string) =>
  (html.match(/<circle cx="[^"]+" cy="[^"]+" r="2.4" fill="#ff9b00">/g) ?? [])
    .length;

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
  'rapport-recyclage-evenement': {
    ...rapportData(),
    couverture: 'Cumul de 1 collecte réalisée, sur 1 collecte de l’événement.',
    bordereaux: [],
  },
  'rapport-don-evenement': {
    nom_evenement: 'Gala',
    traiteur_nom: 'Traiteur',
    date_evenement: '01/07/2026',
    lieu_nom: 'Pavillon',
    lieu_adresse: '1 rue',
    couverture: 'Cumul de 1 collecte réalisée, sur 1 collecte de l’événement.',
    repas_donnes: 0,
    associations: [],
    collectes: [],
  },
};

/** Titre imprimé du document : le contenu de l'unique <h1>. */
function titreImprime(html: string): string {
  const titres = [...html.matchAll(/<h1>([^<]*)<\/h1>/g)].map((m) => m[1]);
  expect(titres).toHaveLength(1);
  return titres[0]!;
}

/** Sous-titre imprimé sous le titre (classe `sous-titre`), unique lui aussi. */
function sousTitreImprime(html: string): string {
  const sousTitres = [
    ...html.matchAll(/<div class="sous-titre">([^<]*)<\/div>/g),
  ].map((m) => m[1]);
  expect(sousTitres).toHaveLength(1);
  return sousTitres[0]!;
}

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

  // §04 associations.numero_rup + §06.06 §5 : la mention RUP n'apparaît QUE si le
  // n° est renseigné (instantané facultatif, arbitrage Val 2026-09-14).
  it('n° RUP renseigné → mention RUP dans l’identité asso ET dans le bloc fiscal', () => {
    const html = renderByType(
      'attestation-don',
      attestationData({
        association_numero_rup: 'W751234567',
        mention_fiscale_2041ge: true,
      }),
    );
    expect(html).toContain('RUP W751234567');
    expect(html).toContain("Association reconnue d'utilité publique");
  });

  it('n° RUP absent → aucune mention RUP (Cerfa émis sans)', () => {
    const html = renderByType(
      'attestation-don',
      attestationData({
        association_numero_rup: null,
        mention_fiscale_2041ge: true,
      }),
    );
    expect(html).not.toContain('RUP');
    expect(html).not.toContain("reconnue d'utilité publique");
    // Contrôle : le reste de la mention fiscale est bien là (pas d'effet de bord).
    expect(html).toContain('238 bis');
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

describe('attestation de don — logo du client dans l’en-tête (Val 2026-10-30)', () => {
  const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

  it('avec un logo client : image à côté de « Savr »', () => {
    const html = renderByType(
      'attestation-don',
      attestationData({ logo_client_url: LOGO }),
    );
    expect(html).toContain(`<img class="logo-client" src="${LOGO}"`);
    expect(html).toContain('<div class="logo-savr">Savr</div>');
  });

  it('sans logo client : « Savr » seul, aucune image', () => {
    const html = renderByType('attestation-don', attestationData());
    expect(html).not.toContain('logo-client"');
    expect(html).toContain('<div class="logo-savr">Savr</div>');
  });

  it('valeur du logo échappée (aucune sortie d’attribut)', () => {
    const html = renderByType(
      'attestation-don',
      attestationData({ logo_client_url: 'x" onerror="alert(1)' }),
    );
    expect(html).not.toContain('onerror="alert');
  });
});

describe('M2.4 / renderer — rapport « Événement sans excédent » §1.3-bis (BL-P1-RPT-02)', () => {
  it('rend un HTML complet avec en-tête événement + titre dédié', () => {
    const html = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData(),
    );
    expect(html).toContain('<!DOCTYPE html>');
    expect(titreImprime(html)).toBe('Rapport de don');
    expect(sousTitreImprime(html)).toBe('Événement sans excédent alimentaire');
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

  it('bloc Conséquences : mention fixe (pas de reçu fiscal, tarif normal) + réf facture', () => {
    const html = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData(),
    );
    expect(html).toContain("Aucun repas n'a été collecté");
    expect(html).toContain(
      "Aucun don n'ayant eu lieu, ce rapport ne vaut pas reçu fiscal.",
    );
    // Le document s'appelle « Rapport de don » : il ne dit plus qu'aucune
    // « attestation de don » n'est générée (décision Val 2026-10-13).
    expect(html).not.toContain('attestation de don');
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

// Gabarit @4 (maquettes v76 validées par Val, décisions C1–C6 du 2026-11-12).
// La fidélité visuelle est prouvée par rapport-recyclage-visuel.test.ts ; ici,
// les données et les règles.
describe('M1.6 / rapport recyclage §1.2 — gabarit @4, page 1 avec radar ou jauge, annexe technique', () => {
  const NBSP = ' ';

  it('option cochée → version avec radar : 5 axes en g/convive face à la moyenne, anneau du taux, ligne de comparaison dans l’annexe', () => {
    const html = rapportAvecRadar();
    const p1 = page1(html);
    expect(p1).toContain('data-version="avec-radar"');
    expect(p1).toContain('Vos résultats face aux événements comparables');
    // Biodéchets : 210 g pour une moyenne de 240 g.
    expect(p1).toContain(`210${NBSP}g</tspan> · moy. 240${NBSP}g`);
    for (const axe of [
      'Biodéchets',
      'Emballages',
      'Cartons',
      'Verre',
      'Déchet résiduel',
    ]) {
      expect(p1).toContain(`">${axe}</text>`);
    }
    expect(sommetsRadar(p1)).toBe(5);
    expect(p1).toContain('Moyenne des événements comparables');
    expect(p1).toContain('stroke-dasharray="72.5 27.5" stroke-dashoffset="25"');
    expect(p1).not.toContain('de vos déchets recyclés');
    expect(page2(html)).toContain(
      'Comparaison aux événements : moyenne Savr sur 24 mois, 37 collectes, critères taille M, gala',
    );
  });

  it('option absente ou décochée → version jauge : taux en kg et en %, ni radar ni ligne de comparaison', () => {
    for (const options of [undefined, { benchmark: false }]) {
      const html = renderByType(
        'rapport-recyclage-zd',
        rapportData({ options }),
      );
      const p1 = page1(html);
      expect(p1).toContain('data-version="sans-radar"');
      expect(p1).not.toContain('Vos résultats face aux événements comparables');
      // 234 kg × 72,5 % = 169,65 kg → 170 kg recyclés, 64 kg non recyclés.
      expect(p1).toContain(`de vos déchets recyclés, soit 170${NBSP}kg`);
      expect(p1).toContain(`170${NBSP}kg · 72,5${NBSP}%`);
      expect(p1).toContain(`64${NBSP}kg · 27,5${NBSP}%`);
      expect(p1).toContain('width: 72.5%; background: #12a459;');
      expect(page2(html)).not.toContain('Comparaison aux événements');
    }
  });

  it('BL-P1-RPT-01 : un flux sans repère (k-anonymat) n’a pas de sommet et affiche « moy. n/d », sans annoncer de cause', () => {
    const html = rapportAvecRadar({
      benchmark_flux: rapportData().benchmark_flux?.map((g) =>
        g.flux_code === 'verre' ? { ...g, benchmark_kg_pax: null } : g,
      ),
    });
    const p1 = page1(html);
    expect(sommetsRadar(p1)).toBe(4);
    expect(p1).toContain(`130${NBSP}g</tspan> · moy. n/d`);
    expect(p1).not.toMatch(/anonymat|seuil|insuffisant/i);
  });

  it('BL-P1-RPT-01 : aucun flux comparable, ou aucune ligne de benchmark → version jauge (jamais un radar vide)', () => {
    const sansRepere = rapportAvecRadar({
      benchmark_flux: rapportData().benchmark_flux?.map((g) => ({
        ...g,
        benchmark_kg_pax: null,
      })),
    });
    expect(sansRepere).toContain('data-version="sans-radar"');
    expect(rapportAvecRadar({ benchmark_flux: [] })).toContain(
      'data-version="sans-radar"',
    );
  });

  it('radar : base 100 = la moyenne (rayon 56) ; au-delà de 150 % de la moyenne, le sommet est borné à l’anneau extérieur', () => {
    const html = rapportAvecRadar({
      benchmark_flux: rapportData().benchmark_flux?.map((g) =>
        g.flux_code === 'verre' ? { ...g, collecte_kg_pax: 0.3 } : g,
      ),
    });
    // Axe Verre (4e, 126°) à 84 : (50.6, 168).
    expect(page1(html)).toContain('<circle cx="50.6" cy="168" r="2.4"');
    // Moyenne = pentagone régulier de rayon 56.
    expect(page1(html)).toContain(
      'points="100,44 153.3,82.7 132.9,145.3 67.1,145.3 46.7,82.7" fill="none" stroke="#223870"',
    );
  });

  it('C5 : les 5 flux toujours imprimés, dans l’ordre de la maquette ; un flux non pesé vaut 0 kg', () => {
    const html = renderByType(
      'rapport-recyclage-zd',
      rapportData({
        flux: rapportData().flux.map((f) =>
          f.code === 'verre' ? { ...f, poids_kg: 0 } : f,
        ),
        poids_total_kg: 179.8,
      }),
    );
    const p1 = page1(html);
    const ordre = [
      'Emballages',
      'Biodéchets',
      'Verre',
      'Cartons',
      'Déchet résiduel',
    ].map((l) => p1.indexOf(`margin-top: 2px;">${l}</span>`));
    expect(ordre.every((i) => i > 0)).toBe(true);
    expect([...ordre].sort((x, y) => x - y)).toEqual(ordre);
    expect(p1).toContain('line-height: 1;">0<span');
    expect(p1).toContain(`0${NBSP}% du total`);
    expect(page2(html)).toMatch(
      /Verre<\/b><\/span><\/td><td class="mono">15 01 07<\/td><td class="num">0\u00a0kg/,
    );
  });

  it('C1 + C4 : l’annexe remplace le bordereau de pesée — codes déchet, exutoire habituel et commune, code R/D du référentiel', () => {
    const p2 = page2(renderByType('rapport-recyclage-zd', rapportData()));
    expect(p2).toContain('Annexe technique – Traçabilité et méthodologie');
    expect(p2).toContain('<th>Exutoire habituel</th>');
    expect(p2).toContain('GENERIS VSG DCDT, Villeneuve-Saint-Georges');
    expect(p2).toContain('<td>R3/R5 recyclage</td>');
    expect(p2).toContain('<td>R3 méthanisation, digestat retourné au sol</td>');
    expect(p2).toContain(
      "<td>R1 incinération avec récupération d'énergie</td>",
    );
    expect(p2).toContain('<td class="mono">20 03 01</td>');
    expect(p2).toContain(`<td class="num">86,4${NBSP}kg</td>`);
    expect(p2).toContain(
      `<td class="num" style="color:#223870">234${NBSP}kg</td>`,
    );
    expect(p2).toContain(
      "Bordereau n° BSAV-2026-00042 · Date d'émission : 02/07/2026",
    );
    // Plus de bordereau de pesée intégré : ni producteur, ni transporteur, ni SIRET.
    expect(p2).not.toMatch(/Bordereau de pesée|Producteur|SIRET/);
    expect(p2).toContain(
      'Émetteur et transporteur : Savr, 50 rue des Moines, 75017 Paris · RCS Paris 879 642 890',
    );
    expect(p2).toContain(
      'Récépissé de déclaration de transport de déchets n° T 26-011, Préfecture de police, 27/04/2026',
    );
    expect(p2).toContain('Page 2/2');
    // La page 1 porte aussi son numéro, avec ou sans radar.
    expect(
      page1(renderByType('rapport-recyclage-zd', rapportData())),
    ).toContain('Page 1/2');
  });

  it('C1 : un nom d’exutoire court reste sur une ligne, un nom long passe à la ligne (l’annexe tient sur l’A4)', () => {
    const p2 = page2(renderByType('rapport-recyclage-zd', rapportData()));
    expect(p2).toContain(
      '<td>CENTRE DE TRI SELECTIF PAPREC TRIVALO 93, Le Blanc-Mesnil</td>',
    );
    const court = page2(
      renderByType(
        'rapport-recyclage-zd',
        rapportData({
          flux: rapportData().flux.map((f) => ({
            ...f,
            exutoire: 'SITE',
            exutoire_commune: 'Paris',
          })),
        }),
      ),
    );
    expect(court).toContain('<td style="white-space:nowrap">SITE, Paris</td>');
  });

  it('BL-P2-18 : CO₂ induit et évité séparés, jamais soustraits ; majoration transport et km voiture ; énergie primaire gardée (C3)', () => {
    const html = renderByType('rapport-recyclage-zd', rapportData());
    expect(page2(html)).toContain(`341${NBSP}kg CO₂e`);
    expect(page2(html)).toContain(`312${NBSP}kg CO₂e`);
    expect(page2(html)).toContain(
      `Dont 10${NBSP}kg de majoration prudente pour le transport.`,
    );
    expect(page2(html)).toContain("non déductibles de l'inventaire");
    expect(html).not.toMatch(/Émissions nettes|CO₂ net|net évité/);
    expect(page1(html)).toContain(
      `CO₂e évités · ≈${NBSP}1${NBSP}431${NBSP}km en voiture`,
    );
    expect(page1(html)).toContain(`9${NBSP}000${NBSP}kWh`);
    expect(page1(html)).toContain("d'énergie primaire économisée");
    // Sans forfait figé : ni majoration chiffrée, ni km × facteur inventés.
    const sans = page2(
      renderByType(
        'rapport-recyclage-zd',
        rapportData({ forfait_transport: null }),
      ),
    );
    expect(sans).not.toContain('majoration');
    expect(sans).not.toContain('aller-retour');
    expect(sans).toContain('Savr ajoute par prudence un forfait de transport');
  });

  it('méthodologie : taux de captation figés ; filière absente non imprimée « 0 % » ; sans snapshot, pas de captation', () => {
    const p2 = page2(renderByType('rapport-recyclage-zd', rapportData()));
    expect(p2).toContain(
      `captation 95${NBSP}% verre, 85${NBSP}% carton, 90${NBSP}% biodéchets, 70${NBSP}% emballages`,
    );
    expect(p2).toContain(
      `forfait de 25${NBSP}km aller-retour × 0,4${NBSP}kg CO₂e/km`,
    );
    const partiel = page2(
      renderByType(
        'rapport-recyclage-zd',
        rapportData({ caps_appliques: { verre: 0.95, carton: null } }),
      ),
    );
    expect(partiel).toContain(`captation 95${NBSP}% verre</li>`);
    expect(partiel).not.toContain(`0${NBSP}% carton`);
    expect(
      page2(
        renderByType(
          'rapport-recyclage-zd',
          rapportData({ caps_appliques: null }),
        ),
      ),
    ).not.toContain('captation ');
  });

  it('bandeau : nom de l’événement, lieu, date en toutes lettres ; logos client et traiteur, aucun emplacement vide sans logo', () => {
    const html = renderByType(
      'rapport-recyclage-zd',
      rapportData({
        logo_client_url: 'data:image/png;base64,CLIENT',
        logo_traiteur_url: 'data:image/png;base64,TRAITEUR',
      }),
    );
    const p1 = page1(html);
    expect(p1).toMatch(/line-clamp: 2; overflow: hidden;">Gala<\/h1>/);
    expect(p1).toContain('text-overflow: ellipsis;">Pavillon</p>');
    expect(p1).toContain('1 juillet 2026</span>');
    expect(p1).toContain('src="data:image/png;base64,CLIENT"');
    expect(p1).toContain('src="data:image/png;base64,TRAITEUR"');
    const sans = page1(renderByType('rapport-recyclage-zd', rapportData()));
    expect(sans).not.toContain(
      'position: absolute; right: 0; top: 0; display: flex; gap: 10px;',
    );
  });

  it('tuiles : chiffre réduit au-delà de 3 chiffres (gros tonnages), 34px sinon', () => {
    const p1 = page1(
      renderByType(
        'rapport-recyclage-zd',
        rapportData({
          flux: rapportData().flux.map((f) =>
            f.code === 'biodechet'
              ? { ...f, poids_kg: 11_862 }
              : f.code === 'verre'
                ? { ...f, poids_kg: 1_234 }
                : f,
          ),
        }),
      ),
    );
    expect(p1).toContain(`font-size: 21px;">11${NBSP}862<span`);
    expect(p1).toContain(`font-size: 28px;">1${NBSP}234<span`);
    expect(p1).toContain('line-height: 1;">23<span');
  });

  it('C3 : encart Savr et tuile énergie gardés tels que validés par Val, sur les deux pages', () => {
    const html = renderByType('rapport-recyclage-zd', rapportData());
    for (const page of [page1(html), page2(html)]) {
      expect(page).toContain(
        'Vos déchets triés, pesés et envoyés en filières de valorisation agréées.',
      );
      expect(page).toContain(
        'Savr, deux services distincts pour vos événements, clé en main.',
      );
    }
  });

  it('BL-P2-20 : aucune mention de régénération sur le rapport', () => {
    const html = renderByType('rapport-recyclage-zd', {
      ...rapportData(),
      regenere_le: '07/07/2026',
    });
    expect(html).not.toContain('Version mise à jour');
  });

  it('toutes les valeurs du payload sont échappées (événement, lieu, logos, exutoire, codes, bordereau, critères)', () => {
    const x = '<script>x</script>';
    const html = rapportAvecRadar({
      nom_evenement: x,
      lieu_nom: x,
      logo_client_url: '" onerror="alert(1)',
      bordereau_numero: x,
      bordereau_date_emission: x,
      benchmark_criteres: x,
      flux: rapportData().flux.map((f) => ({
        ...f,
        exutoire: x,
        exutoire_commune: x,
        code_dechet_europeen: x,
        code_traitement: x,
        filiere_valorisation: x,
      })),
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('" onerror="');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('marque et polices (C6) : logo de la Plateforme, Inter et Archivo embarquées, aucune ressource distante, pas de Nunito', () => {
    const composant = readFileSync(
      fileURLToPath(
        new URL(
          '../../../packages/plateforme/src/components/layout/savr-logo.tsx',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(composant).toContain(`'${SAVR_LOGO_MASK}'`);
    const html = rapportAvecRadar();
    expect(html).toContain(SAVR_LOGO_MASK);
    expect(html).toContain("font-family: 'Inter'");
    expect(html).toContain("font-family: 'Archivo'");
    expect(html).toContain('url(data:font/woff2;base64,');
    expect(html).not.toContain('Nunito');
    // Aucune ressource distante : le rendu ne dépend d'aucun téléchargement
    // (les liens de la méthodologie sont des liens, pas des ressources).
    expect(html).not.toMatch(/(src)="https?:/);
    expect(html).not.toContain('fonts.googleapis.com');
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

// Lot C2 (décision Val Q5 du 2026-10-24) : le bordereau imprime les convives de
// LA collecte ; inconnus (null, collecte à 0 convive), la mention est omise.
describe('M1.6 / bordereau ZD §1.1 — convives de la collecte', () => {
  it('300 convives imprimés ; null → aucune mention « convives »', () => {
    expect(
      renderByType('bordereau-zd', bordereauData({ nb_pax: 300 })),
    ).toContain('300 convives');
    expect(
      renderByType('bordereau-zd', bordereauData({ nb_pax: null })),
    ).not.toContain('convives');
  });
});

describe('M1.6 / rapport recyclage §1.2 — convives de la collecte', () => {
  it('420 convives dans le bandeau et l’annexe, g par convive ; null → ni pastille ni g par convive', () => {
    const html = renderByType(
      'rapport-recyclage-zd',
      rapportData({ nb_pax: 420 }),
    );
    expect(page1(html)).toContain('420 convives</span>');
    expect(page1(html)).toMatch(/557\u00a0g<\/b> par convive/);
    expect(page2(html)).toContain('Pavillon · 1 juillet 2026 · 420 convives');
    const sans = renderByType(
      'rapport-recyclage-zd',
      rapportData({ nb_pax: null }),
    );
    expect(sans).not.toContain('convives');
    expect(sans).not.toContain('par convive');
  });
});

describe('M2.4 / renderer — rapport sans excédent : convives de la collecte', () => {
  it('200 convives imprimés ; null → mention « convives » omise', () => {
    expect(
      renderByType(
        'rapport-evenement-sans-excedent',
        sansExcedentData({ nb_pax: 200 }),
      ),
    ).toContain('200 convives');
    expect(
      renderByType(
        'rapport-evenement-sans-excedent',
        sansExcedentData({ nb_pax: null }),
      ),
    ).not.toContain('convives');
  });
});

// §12 §1.3-bis, décision Val 2026-10-13 : le document d'une collecte AG s'appelle
// « Rapport de don » jusque dans le titre imprimé de ses deux PDF.
describe('M2.4 / renderer — titre imprimé « Rapport de don » des deux PDF AG', () => {
  it('attestation : titre « Rapport de don », « Attestation de don » en sous-titre', () => {
    const html = renderByType('attestation-don', attestationData());
    expect(titreImprime(html)).toBe('Rapport de don');
    expect(sousTitreImprime(html)).toBe('Attestation de don');
  });

  it('attestation : la pièce fiscale garde son numéro et ses mentions légales', () => {
    const numero = attestationData().numero;
    const habilitee = renderByType(
      'attestation-don',
      attestationData({ mention_fiscale_2041ge: true }),
    );
    expect(habilitee).toContain(numero);
    expect(habilitee).toContain(
      'Reçu fiscal — article 238 bis du Code général des impôts',
    );
    expect(habilitee).toContain('Cerfa n° 2041-GE');
    const nonHabilitee = renderByType(
      'attestation-don',
      attestationData({ mention_fiscale_2041ge: false }),
    );
    expect(nonHabilitee).toContain(numero);
    expect(nonHabilitee).toContain('La présente attestation certifie');
  });

  it('rapport sans excédent : même titre, ancien titre en sous-titre', () => {
    const html = renderByType(
      'rapport-evenement-sans-excedent',
      sansExcedentData(),
    );
    expect(titreImprime(html)).toBe('Rapport de don');
    expect(sousTitreImprime(html)).toBe('Événement sans excédent alimentaire');
  });

  it('les deux PDF portent le même titre imprimé', () => {
    expect(
      titreImprime(renderByType('attestation-don', attestationData())),
    ).toBe(
      titreImprime(
        renderByType('rapport-evenement-sans-excedent', sansExcedentData()),
      ),
    );
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
    // Donut des flux : couleur figée par flux (Val 2026-10-30), pas par rang.
    expect(html).toContain('fill="#12a459"'); // Biodéchets
    expect(html).toContain('fill="#ffbd59"'); // Emballages
    expect(html).toContain('fill="#87684d"'); // Carton
    expect(html).toContain('fill="#09337a"'); // Verre
    expect(html).not.toContain('#65a30d');
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
