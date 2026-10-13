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
  'rapport-evenement-sans-excedent',
  'rapport-recyclage-zd',
  'synthese-dashboard',
];
const EXPECTED_VERSIONS: Record<string, string> = {
  'bordereau-zd': 'bordereau-zd@2',
  'rapport-recyclage-zd': 'rapport-recyclage-zd@3',
  'attestation-don': 'attestation-don@3',
  'synthese-dashboard': 'synthese-dashboard@1',
  'rapport-evenement-sans-excedent': 'rapport-evenement-sans-excedent@2',
  facture: 'facture@1',
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

function rapportData(
  overrides: Partial<RapportRecyclageZdData> = {},
): RapportRecyclageZdData {
  return {
    client_nom: 'Groupe Lumière',
    nom_evenement: 'Gala',
    traiteur_nom: 'Traiteur SA',
    date_evenement: '01/07/2026',
    lieu_nom: 'Pavillon',
    lieu_adresse: '1 rue X, Paris',
    nb_pax: 420,
    taux_recyclage: 72.5,
    flux: [
      { nom: 'Biodéchets', code: 'biodechet', poids_kg: 86.4 },
      { nom: 'Emballages', code: 'emballage', poids_kg: 23.1 },
      { nom: 'Cartons', code: 'carton', poids_kg: 31.7 },
      { nom: 'Verre', code: 'verre', poids_kg: 54.2 },
      { nom: 'Déchet résiduel', code: 'dechet_residuel', poids_kg: 38.6 },
    ],
    poids_total_kg: 234,
    co2_evite_kg: 312,
    co2_induit_kg: 41,
    co2_net_kg: -271,
    energie_primaire_evitee_kwh: 9000,
    equivalences: { km_voiture: 1431, foyer: 2 },
    caps_appliques: {
      verre: 0.95,
      carton: 0.85,
      biodechet: 0.9,
      emballage: 0.7,
      version_parametres_at: '2026-07-02 06:00:00+02',
    },
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
    benchmark_legende:
      "période 02/10/2024 → 02/10/2026 · lieux : tous · type d'événement : Gala · taille : M (500 à 749 convives)",
    bordereau: bordereauData(),
    ...overrides,
  };
}

/** Rapport demandé AVEC le radar (option cochée dans la modale de la collecte). */
function rapportAvecRadar(
  overrides: Partial<RapportRecyclageZdData> = {},
): string {
  return renderByType(
    'rapport-recyclage-zd',
    rapportData({ options: { benchmark: true }, ...overrides }),
  );
}

/** Page 1 seule (avant le bordereau intégré). */
function page1(html: string): string {
  return html.slice(0, html.indexOf('<!-- PAGE 2'));
}

const nbAxes = (html: string) =>
  (html.match(/<line class="rz-ax"/g) ?? []).length;

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

describe('M1.6 / rapport recyclage §1.2 — gabarit @3, deux versions de la page 1', () => {
  it('option cochée → version avec radar : radar base 100, liste par flux, badges d’écart, légende des filtres', () => {
    const html = rapportAvecRadar();
    expect(html).toContain('data-version="avec-radar"');
    expect(html).toContain(
      'Vos déchets par convive, comparés aux autres événements Savr',
    );
    // Radar : un axe par flux comparable, parc et « Vous » tracés.
    expect(nbAxes(html)).toBe(5);
    expect(html).toContain('class="rz-parc"');
    expect(html).toContain('class="rz-vous"');
    // Liste : kg/pax de la collecte, repère parc, écart signé et coloré.
    expect(html).toContain('0,21 kg/pax');
    expect(html).toContain('parc 0,24');
    expect(html).toContain('rz-bdg rz-ok">−13\u00a0%'); // 0,21 / 0,24 : sous le parc
    expect(html).toContain('rz-bdg rz-wn">+25\u00a0%'); // 0,075 / 0,060 : jusqu'à +30 %
    expect(html).toContain('rz-bdg rz-bd">+44\u00a0%'); // 0,13 / 0,09 : au-delà
    // Légende des filtres appliqués.
    expect(html).toContain(
      'Benchmark parc Savr calculé sur : période 02/10/2024',
    );
    expect(html).toContain("type d'événement : Gala");
    // L'effectif du segment n'est pas imprimé.
    expect(page1(html)).not.toMatch(/\d\s+collectes?\b/);
  });

  it('option absente ou décochée → version sans radar : aucun bloc de comparaison', () => {
    for (const options of [undefined, null, {}, { benchmark: false }]) {
      const html = renderByType(
        'rapport-recyclage-zd',
        rapportData({ options }),
      );
      expect(html).toContain('data-version="sans-radar"');
      // Les données du benchmark sont dans le payload mais rien n'en sort.
      expect(html).not.toContain('Vos déchets par convive');
      expect(html).not.toContain('kg/pax');
      expect(html).not.toContain('Benchmark parc Savr');
      expect(nbAxes(html)).toBe(0);
    }
  });

  it('BL-P1-RPT-01 : un flux au repère masqué sort du radar, la liste dit « n/d » sans annoncer de cause', () => {
    const html = rapportAvecRadar({
      benchmark_flux: rapportData().benchmark_flux!.map((g) =>
        g.flux_code === 'verre'
          ? // Masqué par le k-anonymat : le repère parc n'arrive pas.
            { ...g, benchmark_kg_pax: null }
          : g,
      ),
    });
    expect(nbAxes(html)).toBe(4);
    expect(html).not.toMatch(/class="rz-axl"[^>]*>Verre</);
    expect(html).toContain('parc n/d');
    expect(html).toContain('rz-bdg rz-nd">n/d');
    expect(html).toContain('données insuffisantes pour comparer ce flux');
    // Aucune cause annoncée : elle renseignerait sur la structure du segment.
    expect(html).not.toContain('moins de 5');
    expect(page1(html)).not.toMatch(/\d\s+collectes?\b/);
    expect(html).not.toContain('anonymat');
  });

  it('BL-P1-RPT-01 : moins de 3 flux comparables → liste seule, pas de radar', () => {
    const html = rapportAvecRadar({
      benchmark_flux: rapportData().benchmark_flux!.map((g, i) =>
        i > 1 ? { ...g, benchmark_kg_pax: null } : g,
      ),
    });
    expect(html).toContain('data-version="avec-radar"');
    expect(html).not.toContain('<svg class="rz-radar"');
    expect(html).toContain('rz-bench rz-bench-liste');
    expect(html).toContain('0,21 kg/pax');
  });

  it('option cochée sans aucune ligne de benchmark → version sans radar (pas de bloc vide)', () => {
    const html = rapportAvecRadar({ benchmark_flux: [] });
    expect(html).toContain('data-version="sans-radar"');
    expect(html).not.toContain('Vos déchets par convive');
  });

  it('BL-P2-18 : carbone — évité en chiffre principal, km voiture seul, induit et net sur des lignes à part', () => {
    for (const html of [
      rapportAvecRadar(),
      renderByType('rapport-recyclage-zd', rapportData()),
    ]) {
      expect(html).toContain('0,312\u00a0t\u00a0CO₂e');
      expect(html).toContain('<span class="rz-pill">évitées</span>');
      expect(html).toContain('1\u00a0431\u00a0km en voiture');
      expect(html).not.toContain('bœuf');
      expect(html).toContain('Émissions induites');
      expect(html).toContain('0,041\u00a0t\u00a0CO₂e');
      // Net stocké négatif (induit − évité) : affiché en valeur absolue, libellé explicite.
      expect(html).toContain('Émissions nettes évitées');
      expect(html).toContain('0,271\u00a0t\u00a0CO₂e');
      expect(html).not.toContain('-0,271');
      expect(html).toContain('9\u00a0000\u00a0kWh');
    }
    // Net positif : la collecte émet plus qu'elle n'évite, on ne dit pas « évitées ».
    const positif = page1(
      renderByType('rapport-recyclage-zd', rapportData({ co2_net_kg: 28 })),
    );
    expect(positif).toContain('>Émissions nettes</div>');
    expect(positif).not.toContain('Émissions nettes évitées');
    // Équivalence foyers : version sans radar seulement (maquette).
    expect(renderByType('rapport-recyclage-zd', rapportData())).toContain(
      '2 foyers / an',
    );
    expect(rapportAvecRadar()).not.toContain('foyers / an');
  });

  it('BL-P2-18 : tonnages — barre empilée (avec radar), tableau + anneau + part valorisée (sans radar)', () => {
    const avec = rapportAvecRadar();
    expect(avec).toContain('class="rz-barre"');
    expect((avec.match(/class="rz-seg"/g) ?? []).length).toBe(5);
    expect(avec).toContain('36,9\u00a0%'); // 86,4 / 234
    expect(avec).toContain('Total collecté <b>234,0\u00a0kg</b>');
    expect(avec).not.toContain('class="rz-donut"');

    const sans = renderByType('rapport-recyclage-zd', rapportData());
    expect(sans).toContain('<table class="rz-tbl">');
    expect(sans).toContain('<svg class="rz-donut"');
    expect((sans.match(/stroke-dasharray=/g) ?? []).length).toBe(5);
    expect(sans).toContain('5 FLUX');
    // Le total additionne les 5 flux, résiduel compris : c'est du collecté, pas du valorisé.
    expect(sans).toContain('Total collecté');
    expect(sans).not.toContain('Total valorisé');
    expect(sans).toContain('Valorisé <b>195,4\u00a0kg</b> (83,5\u00a0%)');
    expect(sans).toContain('Résiduel <b>38,6\u00a0kg</b> (16,5\u00a0%)');
    // Planche sans radar : valorisés du plus lourd au plus léger, résiduel en dernier
    // (38,6 kg : plus lourd que cartons et emballages, il ferme pourtant le tableau).
    const ordre = [
      'Biodéchets',
      'Verre',
      'Cartons',
      'Emballages',
      'Déchet résiduel',
    ].map((n) => sans.indexOf(`${n}</td>`));
    expect(ordre.every((v) => v > 0)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    // Planche avec radar : strictement par poids (le résiduel passe devant les cartons).
    const leg = (n: string) => avec.indexOf(`rz-leg-nom">${n}<`);
    expect(leg('Déchet résiduel')).toBeGreaterThan(0);
    expect(leg('Déchet résiduel')).toBeLessThan(leg('Cartons'));
  });

  it('BL-P2-20 : aucune mention de régénération sur le rapport, même régénéré', () => {
    const payload = {
      ...rapportData({ options: { benchmark: true } }),
      regenere_le: '07/07/2026',
    };
    const html = renderByType('rapport-recyclage-zd', payload);
    expect(html).not.toContain('Version mise à jour');
    expect(html).not.toContain('07/07/2026');
  });

  it('en-tête : client × traiteur, date de l’événement, lieu, convives, logos client et traiteur', () => {
    const complet = rapportAvecRadar({
      logo_client_url: 'data:image/png;base64,CLIENT',
      logo_traiteur_url: 'data:image/png;base64,TRAITEUR',
      // Intervention le lendemain de l'événement.
      bordereau: bordereauData({ date_collecte: '02/07/2026' }),
    });
    const html = page1(complet);
    expect(html).toContain('<span>Groupe Lumière</span>');
    expect(html).toContain('× Traiteur SA');
    expect(html).toContain("Date de l'événement");
    expect(html).toContain('01/07/2026');
    // La date d'intervention reste en page 2 (bordereau), jamais en page 1.
    expect(complet).toContain('Intervention le 02/07/2026');
    expect(html).not.toContain('02/07/2026');
    expect(html).toContain('1 rue X, Paris');
    expect(html).toContain('<div class="rz-v">420</div>');
    expect((html.match(/class="rz-logo"/g) ?? []).length).toBe(2);
    expect(html.indexOf('base64,CLIENT')).toBeLessThan(
      html.indexOf('base64,TRAITEUR'),
    );
    // Logo Savr officiel (masque de luminance), jamais le mot « Savr » en texte.
    expect(html).toContain('mask="url(#rz-logo-masque)"');
    expect(html).not.toContain('class="logo-savr"');
  });

  it('en-tête : sans nom de client, repli sur le nom de l’événement ; sans logo, aucun emplacement vide', () => {
    const html = page1(
      renderByType(
        'rapport-recyclage-zd',
        rapportData({ client_nom: null, nom_evenement: 'Gala <A&B>' }),
      ),
    );
    expect(html).toContain('<span>Gala &lt;A&amp;B&gt;</span>');
    expect(html).not.toContain('class="rz-logos"');
    // Client et traiteur identiques : le traiteur n'est pas répété.
    const meme = page1(
      renderByType(
        'rapport-recyclage-zd',
        rapportData({ client_nom: 'Traiteur SA' }),
      ),
    );
    expect(meme).not.toContain('× Traiteur SA');
  });

  it('méthodologie : taux de captation figés affichés ; phrase et ligne retirées si le payload ne les porte pas', () => {
    const html = rapportAvecRadar();
    expect(html).toContain(
      'méthode UE 2019/1004 avec les taux de captation ci-dessous',
    );
    expect(html).toContain('Captation verre <b>95\u00a0%</b>');
    expect(html).toContain('emballages <b>70\u00a0%</b>');
    // La formule fausse du gabarit @2 a disparu.
    expect(html).not.toContain('poids valorisé ÷ poids total');
    const sans = rapportAvecRadar({ caps_appliques: null });
    expect(sans).not.toContain('taux de captation ci-dessous');
    expect(sans).not.toContain('class="rz-caps"');
  });

  it('payload @2 rejoué (régénération d’un ancien rapport) : rendu sans radar, sans plantage', () => {
    const ancien = {
      nom_evenement: 'Gala',
      date_evenement: '01/07/2026',
      date_collecte: '01/07/2026',
      lieu_nom: 'Pavillon',
      lieu_adresse: '1 rue X, Paris',
      traiteur_nom: 'Traiteur SA',
      logo_url: 'data:image/png;base64,ANCIEN',
      taux_recyclage: null,
      flux: [
        { nom: 'Biodéchets', poids_kg: 12 },
        { nom: 'Cartons', poids_kg: 8 },
      ],
      poids_total_kg: 20,
      co2_evite_kg: null,
      comparaison_savr: { taux_moyen_pondere: 68.4, nb_organisations: 7 },
      benchmark_flux: [
        {
          flux_nom: 'Biodéchets',
          collecte_kg_pax: 0.12,
          benchmark_kg_pax: 0.1,
        },
      ],
      regenere_le: '03/07/2026',
      bordereau: bordereauData(),
    };
    const html = renderByType('rapport-recyclage-zd', ancien);
    expect(html).toContain('data-version="sans-radar"');
    expect(html).toContain('<span>Gala</span>');
    expect(html).toContain('base64,ANCIEN'); // logo unique @2 → emplacement client
    // Flux reconnus par leur nom (pas de code dans un payload @2) : couleurs du référentiel.
    expect(html).toContain('stroke="#16a34a"');
    expect(html).toContain('stroke="#6379b6"');
    // Les blocs retirés ne reviennent pas par un ancien payload.
    expect(html).not.toContain('7 organisations');
    expect(html).not.toContain('68,4');
  });

  it('page 2 : bordereau intégré, ses styles ne sortent pas de la page 2', () => {
    const html = rapportAvecRadar();
    const p2 = html.slice(html.indexOf('<!-- PAGE 2'));
    expect(p2).toContain('Annexe — Bordereau de pesée Savr (BSAV-2026-00001)');
    expect(p2).toContain('Bordereau de pesée');
    expect(p2).toContain('Signature chauffeur');
    // Chaque règle du bordereau est rattachée au conteneur de la page 2.
    expect(html).toContain('.bz table {');
    expect(html).toContain('.bz thead tr {');
    expect(html).not.toMatch(/^\s*table \{/m);
    expect(html).not.toMatch(/^\s*body \{/m);
    expect(html).not.toMatch(/^\s*\* \{/m);
  });

  it('badges d’écart : seuils de l’écran, comparés sur le ratio (≤ parc vert, jusqu’à 130 % orange, au-delà rouge)', () => {
    const badge = (collecte_kg_pax: number, benchmark_kg_pax: number) =>
      /rz-bdg (rz-\w+)">([^<]+)</
        .exec(
          rapportAvecRadar({
            benchmark_flux: [
              {
                flux_nom: 'Biodéchets',
                flux_code: 'biodechet',
                collecte_kg_pax,
                benchmark_kg_pax,
              },
            ],
          }),
        )!
        .slice(1);
    expect(badge(0.2, 0.2)).toEqual(['rz-ok', '+0\u00a0%']); // égal au parc : vert
    expect(badge(0.21, 0.2)).toEqual(['rz-wn', '+5\u00a0%']);
    expect(badge(0.26, 0.2)).toEqual(['rz-wn', '+30\u00a0%']); // 130 % exactement : orange
    // 133 % : l'écart arrondi dit encore « +33 », le ratio dit rouge.
    expect(badge(0.4, 0.3)).toEqual(['rz-bd', '+33\u00a0%']);
  });

  it('radar : un flux au-delà de 150 % du parc est borné à l’anneau extérieur ; kg/pax à 3 décimales sous 0,1', () => {
    const html = rapportAvecRadar({
      benchmark_flux: rapportData().benchmark_flux!.map((g) =>
        g.flux_code === 'biodechet'
          ? { ...g, collecte_kg_pax: 2.4, benchmark_kg_pax: 0.24 } // 1 000 % du parc
          : g,
      ),
    });
    // Biodéchets = axe du haut : borné à y = 100 − 84 = 16, jamais hors du radar.
    expect(html).toContain('<circle class="rz-vpt" cx="100.0" cy="16.0"');
    expect(html).toContain('2,40 kg/pax');
    expect(html).toContain('0,055 kg/pax'); // 3 décimales sous 0,1
    expect(html).toContain('parc 0,050');
  });

  it('toutes les valeurs du payload sont échappées (client, traiteur, lieu, adresse, logos, flux, légende)', () => {
    const html = rapportAvecRadar({
      client_nom: 'A<b>&"',
      traiteur_nom: 'T<i>',
      lieu_nom: 'L<script>',
      lieu_adresse: '1 rue <u>',
      date_evenement: '<01>',
      logo_client_url: 'x" onerror="alert(1)',
      logo_traiteur_url: 'y"><script>',
      benchmark_legende: 'période <x> · lieux : <y>',
      flux: [{ nom: 'F<em>', code: 'verre', poids_kg: 10 }],
      poids_total_kg: 10,
      benchmark_flux: [
        {
          flux_nom: 'G<em>',
          flux_code: 'verre',
          collecte_kg_pax: 0.1,
          benchmark_kg_pax: 0.1,
        },
      ],
    });
    const p1 = page1(html);
    for (const brut of [
      'A<b>',
      'T<i>',
      'L<script>',
      '<u>',
      '<01>',
      '" onerror="',
      '"><script>',
      '<x>',
      '<y>',
      'F<em>',
      'G<em>',
    ]) {
      expect([brut, p1.includes(brut)]).toEqual([brut, false]);
    }
    expect(p1).toContain('A&lt;b&gt;&amp;&quot;');
    expect(p1).toContain('période &lt;x&gt;<br>lieux : &lt;y&gt;');
  });

  it('méthodologie : une filière absente du snapshot n’est pas imprimée « 0 % », « Captation » ouvre toujours la ligne', () => {
    const html = rapportAvecRadar({
      caps_appliques: { verre: null, carton: 0.855, biodechet: 0.9 },
    });
    expect(html).not.toContain('verre <b>');
    expect(html).toContain('<span>Captation carton <b>85,5\u00a0%</b></span>');
    expect(html).toContain('<span>biodéchets <b>90\u00a0%</b></span>');
    expect(html).not.toContain('emballages <b>');
  });

  it('marque : le logo embarqué est celui de la Plateforme, la police Nunito est incluse', () => {
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
    expect(html).toContain("font-family: 'Nunito'");
    expect(html).toContain('url(data:font/woff2;base64,');
    // Aucune ressource distante : le rendu ne dépend d'aucun téléchargement.
    expect(html).not.toMatch(/(src|href)="https?:/);
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
