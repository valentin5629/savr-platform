/**
 * M1.6 — Cascade de résolution du logo client dans les rapports PDF (§12 §1.2, BL-P2-19).
 * Priorité : agence programmatrice prime → client organisateur (compte Savr, sinon
 * upload) → traiteur opérationnel → Savr. Pas d'override branding pour gestionnaire.
 */
import { describe, it, expect } from 'vitest';

import { resolveRapportLogo } from '../../src/lib/pdf/logo-cascade.js';

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
