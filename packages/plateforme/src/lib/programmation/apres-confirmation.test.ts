/**
 * M1.2 / email récapitulatif — lien « Voir mes collectes » (décision Val
 * 2026-10-24, B2-Q3) : la liste Collectes de l'espace du programmeur.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { lienCollectesProgrammeur } from './apres-confirmation.js';

const req = new NextRequest(
  'https://apercu.example.test/api/v1/programmation/evenements',
  {
    method: 'POST',
  },
);

describe('M1.2/email_recap_lien_collectes — lienCollectesProgrammeur', () => {
  const avant = process.env['NEXT_PUBLIC_APP_URL'];
  beforeEach(() => {
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://app.example.test';
  });
  afterEach(() => {
    if (avant === undefined) delete process.env['NEXT_PUBLIC_APP_URL'];
    else process.env['NEXT_PUBLIC_APP_URL'] = avant;
  });

  it.each([
    ['traiteur_manager', 'https://app.example.test/traiteur/collectes'],
    ['traiteur_commercial', 'https://app.example.test/traiteur/collectes'],
    ['agence', 'https://app.example.test/agence/collectes'],
    ['gestionnaire_lieux', 'https://app.example.test/gestionnaire/collectes'],
    ['admin_savr', 'https://app.example.test/admin/collectes'],
    ['ops_savr', 'https://app.example.test/admin/collectes'],
  ])('%s : liste Collectes de son espace', (role, attendu) => {
    expect(lienCollectesProgrammeur(req, role)).toBe(attendu);
  });

  it('rôle absent ou inconnu : aucun lien (l’email part sans bouton)', () => {
    expect(lienCollectesProgrammeur(req, undefined)).toBeNull();
    expect(lienCollectesProgrammeur(req, 'inconnu')).toBeNull();
  });
});
