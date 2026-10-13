/**
 * M1.6 — Cascade de résolution du logo client dans les rapports PDF (§12 §1.2, BL-P2-19).
 * Priorité : agence programmatrice prime → client organisateur (compte Savr, sinon
 * upload) → traiteur opérationnel → Savr. Pas d'override branding pour gestionnaire.
 */
import { describe, it, expect } from 'vitest';

import {
  resolveRapportLogo,
  resolveRapportLogos,
} from '../../src/lib/pdf/logo-cascade.js';
import {
  bornerLogosRapport,
  MAX_LOGOS_RAPPORT_CHARS,
} from '../../src/lib/pdf/logo-inline.js';

const AGENCE = { type: 'agence', logo_url: 'https://cdn/agence.png' };
const TRAITEUR = { type: 'traiteur', logo_url: 'https://cdn/traiteur.png' };
const GESTIONNAIRE = {
  type: 'gestionnaire_lieux',
  logo_url: 'https://cdn/gestionnaire.png',
};
const CLIENT_ORGA = { logo_url: 'https://cdn/client.png' };

describe('M1.6 / cascade logo rapport §1.2 (BL-P2-19)', () => {
  it('1. agence programmatrice → logo agence prime (même si client orga + traiteur présents)', () => {
    const r = resolveRapportLogo({
      programmateur: AGENCE,
      client_organisateur: CLIENT_ORGA,
      evenement_logo_client_url: 'https://cdn/upload.png',
      traiteur_operationnel: TRAITEUR,
    });
    expect(r.source).toBe('agence');
    expect(r.logo_url).toBe('https://cdn/agence.png');
  });

  it('2. pas d’agence + client organisateur (compte Savr) → logo du compte client', () => {
    const r = resolveRapportLogo({
      programmateur: TRAITEUR,
      client_organisateur: CLIENT_ORGA,
      evenement_logo_client_url: 'https://cdn/upload.png',
      traiteur_operationnel: TRAITEUR,
    });
    expect(r.source).toBe('client_organisateur_compte');
    expect(r.logo_url).toBe('https://cdn/client.png');
  });

  it('3. pas de compte client → logo uploadé par le traiteur (evenements.logo_client_organisateur_url)', () => {
    const r = resolveRapportLogo({
      programmateur: TRAITEUR,
      client_organisateur: null,
      evenement_logo_client_url: 'https://cdn/upload.png',
      traiteur_operationnel: TRAITEUR,
    });
    expect(r.source).toBe('client_organisateur_upload');
    expect(r.logo_url).toBe('https://cdn/upload.png');
  });

  it('4. pas de client organisateur → logo traiteur opérationnel', () => {
    const r = resolveRapportLogo({
      programmateur: TRAITEUR,
      client_organisateur: null,
      evenement_logo_client_url: null,
      traiteur_operationnel: TRAITEUR,
    });
    expect(r.source).toBe('traiteur_operationnel');
    expect(r.logo_url).toBe('https://cdn/traiteur.png');
  });

  it('5. aucun logo → source savr (en-tête Savr seul, logo_url undefined)', () => {
    const r = resolveRapportLogo({
      programmateur: { type: 'traiteur', logo_url: null },
      client_organisateur: null,
      evenement_logo_client_url: null,
      traiteur_operationnel: { type: 'traiteur', logo_url: null },
    });
    expect(r.source).toBe('savr');
    expect(r.logo_url).toBeUndefined();
  });

  it('exclusion gestionnaire de lieux (§1.2 l.90) : pas d’override branding, on retombe sur le standard', () => {
    // Programmateur gestionnaire (avec logo) → PAS de prime ; client orga l'emporte.
    const r = resolveRapportLogo({
      programmateur: GESTIONNAIRE,
      client_organisateur: CLIENT_ORGA,
      evenement_logo_client_url: null,
      traiteur_operationnel: TRAITEUR,
    });
    expect(r.source).toBe('client_organisateur_compte');
    expect(r.logo_url).toBe('https://cdn/client.png');

    // Gestionnaire seul (pas de client orga, pas de traiteur op logo) → Savr, jamais
    // le logo gestionnaire.
    const seul = resolveRapportLogo({
      programmateur: GESTIONNAIRE,
      client_organisateur: null,
      evenement_logo_client_url: null,
      traiteur_operationnel: { type: 'gestionnaire_lieux', logo_url: null },
    });
    expect(seul.source).toBe('savr');
    expect(seul.logo_url).toBeUndefined();
  });

  it('agence sans logo → retombe sur le standard (pas de prime vide)', () => {
    const r = resolveRapportLogo({
      programmateur: { type: 'agence', logo_url: null },
      client_organisateur: CLIENT_ORGA,
      evenement_logo_client_url: null,
      traiteur_operationnel: TRAITEUR,
    });
    expect(r.source).toBe('client_organisateur_compte');
    expect(r.logo_url).toBe('https://cdn/client.png');
  });
});

// Gabarit @3 du rapport de recyclage : deux emplacements dans le bandeau.
describe('M1.6 / logos du rapport de recyclage @3 — client et traiteur', () => {
  it('client organisateur et traiteur opérationnel occupent chacun leur emplacement', () => {
    expect(
      resolveRapportLogos({
        programmateur: TRAITEUR,
        client_organisateur: CLIENT_ORGA,
        traiteur_operationnel: TRAITEUR,
      }),
    ).toEqual({
      client: 'https://cdn/client.png',
      traiteur: 'https://cdn/traiteur.png',
    });
  });

  it('agence programmatrice : son logo prime dans l’emplacement client, le traiteur garde le sien', () => {
    expect(
      resolveRapportLogos({
        programmateur: AGENCE,
        client_organisateur: CLIENT_ORGA,
        evenement_logo_client_url: 'https://cdn/upload.png',
        traiteur_operationnel: TRAITEUR,
      }),
    ).toEqual({
      client: 'https://cdn/agence.png',
      traiteur: 'https://cdn/traiteur.png',
    });
  });

  it('sans compte client : logo déposé à la programmation ; sans aucun logo client, l’emplacement reste vide', () => {
    expect(
      resolveRapportLogos({
        programmateur: TRAITEUR,
        client_organisateur: null,
        evenement_logo_client_url: 'https://cdn/upload.png',
        traiteur_operationnel: TRAITEUR,
      }).client,
    ).toBe('https://cdn/upload.png');
    // Le logo du traiteur ne glisse jamais dans l'emplacement client.
    expect(
      resolveRapportLogos({
        programmateur: TRAITEUR,
        client_organisateur: null,
        traiteur_operationnel: TRAITEUR,
      }),
    ).toEqual({ client: undefined, traiteur: 'https://cdn/traiteur.png' });
  });

  it('gestionnaire programmateur : pas de logo de marque dans l’emplacement client ; traiteur sans logo → vide', () => {
    expect(
      resolveRapportLogos({
        programmateur: GESTIONNAIRE,
        client_organisateur: null,
        traiteur_operationnel: { type: 'traiteur', logo_url: '  ' },
      }),
    ).toEqual({ client: undefined, traiteur: undefined });
  });
});

describe('M1.6 / budget commun des deux logos du rapport @3', () => {
  const lourd = 'x'.repeat(MAX_LOGOS_RAPPORT_CHARS / 2 + 1);
  const leger = 'x'.repeat(1000);

  it('sous le budget : les deux logos sont gardés (au budget exactement aussi)', () => {
    expect(bornerLogosRapport({ client: leger, traiteur: leger })).toEqual({
      client: leger,
      traiteur: leger,
    });
    const moitie = 'x'.repeat(MAX_LOGOS_RAPPORT_CHARS / 2);
    expect(
      bornerLogosRapport({ client: moitie, traiteur: moitie }).traiteur,
    ).toBe(moitie);
  });

  it('au-delà du budget : le logo du client est gardé, celui du traiteur est retiré', () => {
    expect(bornerLogosRapport({ client: lourd, traiteur: lourd })).toEqual({
      client: lourd,
      traiteur: null,
    });
  });

  it('un seul logo, même au plafond unitaire, n’est jamais retiré', () => {
    const plafond = 'x'.repeat(1_333_400);
    expect(bornerLogosRapport({ client: null, traiteur: plafond })).toEqual({
      client: null,
      traiteur: plafond,
    });
    expect(bornerLogosRapport({ client: plafond, traiteur: null })).toEqual({
      client: plafond,
      traiteur: null,
    });
  });
});
