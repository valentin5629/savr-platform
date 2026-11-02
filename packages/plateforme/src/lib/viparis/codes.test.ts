import { describe, it, expect } from 'vitest';
import {
  CODES_SITE_VIPARIS,
  estCodeSiteViparis,
  normaliserCodeAffaireViparis,
} from './codes';

describe('Codes VIPARIS (Val 2026-11-02)', () => {
  it('VIPARIS/codes_site_liste_fermee — les 8 sites demandés, rien d’autre', () => {
    expect([...CODES_SITE_VIPARIS]).toEqual([
      'PCP',
      'PCC',
      'CNIT2',
      'CDL',
      'CHAMP',
      'PDV',
      'PNV',
      'PLB',
    ]);
    expect(estCodeSiteViparis('CNIT2')).toBe(true);
    expect(estCodeSiteViparis('pcp')).toBe(false);
    expect(estCodeSiteViparis('XYZ')).toBe(false);
    expect(estCodeSiteViparis(null)).toBe(false);
  });

  it('VIPARIS/code_affaire_format — 7 lettres ou chiffres, normalisé ; vide = null', () => {
    expect(normaliserCodeAffaireViparis('26SIAL1')).toBe('26SIAL1');
    expect(normaliserCodeAffaireViparis(' 26sial1 ')).toBe('26SIAL1');
    expect(normaliserCodeAffaireViparis('')).toBeNull();
    expect(normaliserCodeAffaireViparis('   ')).toBeNull();
    expect(normaliserCodeAffaireViparis(null)).toBeNull();
    expect(normaliserCodeAffaireViparis(undefined)).toBeNull();
    for (const invalide of [
      '26SIAL',
      '26SIAL12',
      '26 SIAL1',
      '26-SIA1',
      'É6SIAL1',
      7,
    ])
      expect(normaliserCodeAffaireViparis(invalide)).toBeUndefined();
  });
});
