/**
 * Menu « Type de véhicule souhaité » selon le type de collecte (décision Val
 * 2026-11-10). AG : Vélo cargo, Camionnette frigo, Camion frigo. ZD : 16 m³
 * simple, 16 m³ double, 20 m³ simple, 20 m³ double. Une collecte qui porte un
 * autre type le garde lisible dans le menu.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChampsBesoinVehicule } from './champs-besoin-vehicule';

afterEach(cleanup);

function ouvrirMenu(
  typeCollecte: 'anti_gaspi' | 'zero_dechet',
  typeVehicule: string,
) {
  render(
    <ChampsBesoinVehicule
      typeCollecte={typeCollecte}
      typeVehicule={typeVehicule}
      onTypeVehicule={() => {}}
      nbVehicules="1"
      onNbVehicules={() => {}}
    />,
  );
  fireEvent.click(
    screen.getByRole('combobox', { name: 'Type de véhicule souhaité' }),
  );
  return screen.getAllByRole('option').map((o) => o.textContent?.trim());
}

describe('Type de véhicule souhaité — choix proposés', () => {
  it('AG : vélo cargo, camionnette frigo, camion frigo', () => {
    expect(ouvrirMenu('anti_gaspi', '')).toEqual([
      'Non précisé',
      'Vélo cargo',
      'Camionnette frigo',
      'Camion frigo',
    ]);
  });

  it('ZD : 16 m³ et 20 m³, simple ou double', () => {
    expect(ouvrirMenu('zero_dechet', '')).toEqual([
      'Non précisé',
      '16 m³ simple',
      '16 m³ double',
      '20 m³ simple',
      '20 m³ double',
    ]);
  });

  it('garde visible le type déjà posé sur la collecte, même hors de la liste', () => {
    expect(ouvrirMenu('zero_dechet', 'fourgon')).toContain('Fourgon');
    cleanup();
    expect(ouvrirMenu('zero_dechet', 'camion_frigo')).toContain('Camion frigo');
    cleanup();
    expect(ouvrirMenu('anti_gaspi', 'velo_cargo')).not.toContain('Fourgon');
  });
});
