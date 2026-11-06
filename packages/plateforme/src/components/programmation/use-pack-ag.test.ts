import { describe, expect, it } from 'vitest';
import {
  factureeAlUnite,
  nombreAlUnite,
  packPourRang,
  type PackInfo,
} from './use-pack-ag';
import { texteCouverturePack } from './formulaire-programmation';

// Crédit décompté dès la programmation (décision Val 2026-11-02) : dans une
// programmation à plusieurs collectes Anti-Gaspi, chaque carte entame le pack.
const pack = (restants: number): PackInfo => ({
  pack_actif: true,
  credits_initiaux: 10,
  credits_consommes: 10 - restants,
  credits_restants: restants,
});

describe('pack AG à la programmation', () => {
  it('chaque carte AG voit les crédits restants après les cartes précédentes', () => {
    expect(packPourRang(pack(2), 0).credits_restants).toBe(2);
    expect(packPourRang(pack(2), 1).credits_restants).toBe(1);
    expect(packPourRang(pack(2), 2).credits_restants).toBe(0);
    expect(factureeAlUnite(packPourRang(pack(2), 1))).toBe(false);
    expect(factureeAlUnite(packPourRang(pack(2), 2))).toBe(true);
  });

  it('sans pack actif, chaque carte est facturée à l’unité', () => {
    const sans: PackInfo = { pack_actif: false };
    expect(packPourRang(sans, 3)).toEqual(sans);
    expect(factureeAlUnite(packPourRang(sans, 0))).toBe(true);
    expect(nombreAlUnite(sans, 3)).toBe(3);
  });

  it('compte les collectes que le pack ne couvre pas', () => {
    expect(nombreAlUnite(pack(5), 3)).toBe(0);
    expect(nombreAlUnite(pack(2), 3)).toBe(1);
    expect(nombreAlUnite(pack(0), 2)).toBe(2);
  });

  it('formule la couverture partielle du pack', () => {
    expect(texteCouverturePack(2, 1)).toBe(
      "Sur votre pack Anti-Gaspi, il reste 2 crédits : 1 collecte Anti-Gaspi sera facturée à l'unité.",
    );
    expect(texteCouverturePack(1, 3)).toBe(
      "Sur votre pack Anti-Gaspi, il reste 1 crédit : 3 collectes Anti-Gaspi seront facturées à l'unité.",
    );
  });
});
