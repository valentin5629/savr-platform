import { describe, it, expect } from 'vitest';
import {
  lieuToEdits,
  computeLieuOverrides,
  type LieuEdits,
} from './lieu-champs-editables';
import type { LieuOption } from './lieu-combobox';

const LIEU: LieuOption = {
  id: 'lieu-1',
  nom: 'Salle Pleyel',
  adresse_acces: '252 rue du Fbg St-Honoré',
  ville: 'Paris',
  code_postal: '75008',
  controle_acces_requis_default: false,
  stationnement: 'facile',
  type_vehicule_max: 'camionnette',
  acces_office: 'difficile',
  contraintes_horaires: null,
  acces_details: null,
};

describe('M1.2 / PROG-01 lieu override (front)', () => {
  it('M1.2 — computeLieuOverrides ne renvoie que les champs modifiés', () => {
    const base = lieuToEdits(LIEU);
    // Aucun changement → override vide.
    expect(computeLieuOverrides(base, base)).toEqual({});

    // Deux champs modifiés → seuls ceux-là remontent (le nom n'est pas éditable ici).
    const edits: LieuEdits = {
      ...base,
      ville: 'Boulogne',
      stationnement: 'tres_difficile',
    };
    expect(computeLieuOverrides(base, edits)).toEqual({
      ville: 'Boulogne',
      stationnement: 'tres_difficile',
    });
  });

  it('M1.2 — lieuToEdits pré-remplit tous les champs éditables (défaut chaîne vide)', () => {
    const edits = lieuToEdits(LIEU);
    expect(edits.adresse_acces).toBe('252 rue du Fbg St-Honoré');
    expect(edits.type_vehicule_max).toBe('camionnette');
    // Champs nuls du lieu → chaîne vide éditable, jamais undefined.
    expect(edits.contraintes_horaires).toBe('');
    expect(edits.acces_details).toBe('');
  });
});
