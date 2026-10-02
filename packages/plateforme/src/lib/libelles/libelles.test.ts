/**
 * R-UI-0 (B2) — libellés FR des enums : valeur connue → libellé, inconnue →
 * valeur brute (jamais une chaîne vide), absente → « — ». L'exhaustivité
 * contre les enums DB est garantie au typecheck (`satisfies`).
 */
import { describe, expect, it } from 'vitest';
import { libelleStatutFacture } from './facture';
import {
  libelleVerificationSiret,
  variantVerificationSiret,
} from './organisation';
import { libelleStatutPack, libelleTypePack, variantStatutPack } from './pack';
import { libelleRole } from './role';
import { libelleStatutTournee } from './tournee';

describe('R-UI-0 — lib/libelles : enums DB → libellés FR', () => {
  it('valeur connue → libellé FR', () => {
    expect(libelleStatutFacture('payee')).toBe('Payée');
    expect(libelleStatutFacture('en_attente_pennylane')).toBe(
      'En attente Pennylane',
    );
    expect(libelleStatutPack('epuise')).toBe('Épuisé');
    expect(libelleTypePack('pack_30')).toBe('Pack 30');
    expect(libelleVerificationSiret('verifie')).toBe('Vérifié');
    expect(libelleRole('gestionnaire_lieux')).toBe('Gestionnaire de lieux');
    expect(libelleStatutTournee('planifiee')).toBe('Planifiée');
  });

  it('valeur absente → « — », valeur inconnue → valeur brute', () => {
    expect(libelleStatutFacture(null)).toBe('—');
    expect(libelleStatutFacture(undefined)).toBe('—');
    expect(libelleStatutPack('')).toBe('—');
    expect(libelleRole('role_inconnu')).toBe('role_inconnu');
    expect(libelleStatutTournee('statut_inconnu')).toBe('statut_inconnu');
  });

  it('variantes de badge : sémantique par valeur, neutral par défaut', () => {
    expect(variantStatutPack('actif')).toBe('success');
    expect(variantStatutPack('annule')).toBe('error');
    expect(variantStatutPack(null)).toBe('neutral');
    expect(variantVerificationSiret('en_attente')).toBe('warning');
    expect(variantVerificationSiret('echec')).toBe('error');
    expect(variantVerificationSiret('autre')).toBe('neutral');
  });
});
