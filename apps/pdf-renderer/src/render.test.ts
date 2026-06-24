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
  'rapport-recyclage-zd',
];
const EXPECTED_VERSIONS: Record<string, string> = {
  'bordereau-zd': 'bordereau-zd@1',
  'rapport-recyclage-zd': 'rapport-recyclage-zd@1',
  'attestation-don': 'attestation-don@1',
};
import type { AttestationDonData } from './templates/attestation-don.js';
import type { BordereauZdData } from './templates/bordereau-zd.js';
import type { RapportRecyclageZdData } from './templates/rapport-recyclage-zd.js';

function bordereauData(): BordereauZdData {
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
    flux: [{ nom: 'Biodéchets', poids_kg: 12 }],
    poids_total_kg: 12,
  };
}

function rapportData(): RapportRecyclageZdData {
  return {
    nom_evenement: 'Gala',
    date_evenement: '01/07/2026',
    date_collecte: '01/07/2026',
    lieu_nom: 'Pavillon',
    lieu_adresse: '1 rue X, Paris',
    traiteur_nom: 'Traiteur SA',
    flux: [{ nom: 'Biodéchets', poids_kg: 12 }],
    poids_total_kg: 12,
    bordereau: bordereauData(),
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
    association_numero_rup: 'RUP-001',
    mention_fiscale_2041ge: true,
    volume_repas: 120,
    poids_kg: 48,
    co2_evite_kg: 300,
    co2_facteurs_version: 'FAO-2.5',
    ...overrides,
  };
}

const DATA_BY_TYPE: Record<string, unknown> = {
  'bordereau-zd': bordereauData(),
  'rapport-recyclage-zd': rapportData(),
  'attestation-don': attestationData(),
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
});
