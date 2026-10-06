/**
 * R-UI-5 F10 — gabarits des messages de champ. Oracle = les chaînes écrites
 * en dur avant R-UI-5 dans les modales admin et le formulaire d'attribution AG :
 * chaque appel doit rendre EXACTEMENT le texte affiché auparavant.
 */
import { describe, expect, it } from 'vitest';
import {
  MESSAGE_FORMAT_SIREN,
  MESSAGE_FORMAT_SIRET,
  messageAuMoinsUn,
  messageLongueurMin,
  messageNbChiffres,
  messageObligatoire,
} from './validation';

describe('R-UI-5 — lib/libelles/validation : messages de champ', () => {
  it('« X obligatoire » : texte identique aux anciennes chaînes', () => {
    const cas: [string, string][] = [
      ['Nom', 'Nom obligatoire'],
      ['Adresse accès livraison', 'Adresse accès livraison obligatoire'],
      ['Code postal', 'Code postal obligatoire'],
      ['Ville', 'Ville obligatoire'],
      ['Type de véhicule max', 'Type de véhicule max obligatoire'],
      ['Nom du contact', 'Nom du contact obligatoire'],
      ['Téléphone', 'Téléphone obligatoire'],
      ['Numéro de contact', 'Numéro de contact obligatoire'],
      ['Email de contact', 'Email de contact obligatoire'],
      ['Adresse', 'Adresse obligatoire'],
      ['Type de TMS', 'Type de TMS obligatoire'],
      ['Région', 'Région obligatoire'],
      ['Capacité max', 'Capacité max obligatoire'],
      ['Raison sociale', 'Raison sociale obligatoire'],
      ['Type', 'Type obligatoire'],
      ['Email principal', 'Email principal obligatoire'],
    ];
    for (const [champ, avant] of cas)
      expect(messageObligatoire(champ)).toBe(avant);
  });

  // Le cas « Code transporteur MTS-1 … » est couvert par transporteur-modal.test
  // (seul fichier autorisé à nommer le provider, garde anti-couplage G3).
  it('« X obligatoire <précision> »', () => {
    expect(
      messageObligatoire('Prestataire logistique', 'pour ce type de TMS'),
    ).toBe('Prestataire logistique obligatoire pour ce type de TMS');
    expect(
      messageObligatoire('Motif override', '(min 10 car. si « Autre »)'),
    ).toBe('Motif override obligatoire (min 10 car. si « Autre »)');
  });

  it('formats : chiffres, longueur minimale, sélection multiple', () => {
    expect(MESSAGE_FORMAT_SIREN).toBe('SIREN : 9 chiffres');
    expect(MESSAGE_FORMAT_SIRET).toBe('SIRET : 14 chiffres');
    expect(messageNbChiffres('SIREN', 9)).toBe(MESSAGE_FORMAT_SIREN);
    expect(messageLongueurMin('Description du rapport d’impact', 30)).toBe(
      'Description du rapport d’impact : 30 caractères minimum',
    );
    expect(messageAuMoinsUn('type de véhicule')).toBe(
      'Au moins un type de véhicule',
    );
  });
});
