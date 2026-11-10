/**
 * Menu « Type de véhicule souhaité » (décision Val 2026-11-10) : Vélo cargo,
 * Camion frigo, Camion 16 m³, Camion 20 m³. Une collecte qui porte un ancien
 * type le garde lisible dans le menu.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChampsBesoinVehicule } from './champs-besoin-vehicule';

afterEach(cleanup);

function ouvrirMenu(typeVehicule: string) {
  render(
    <ChampsBesoinVehicule
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
  it('propose les quatre véhicules de Val, sans les anciens gabarits', () => {
    expect(ouvrirMenu('')).toEqual([
      'Non précisé',
      'Vélo cargo',
      'Camion frigo',
      'Camion 16 m³',
      'Camion 20 m³',
    ]);
  });

  it('garde visible l’ancien type déjà posé sur la collecte', () => {
    expect(ouvrirMenu('fourgon')).toContain('Fourgon');
    cleanup();
    expect(ouvrirMenu('camion_20m3')).not.toContain('Fourgon');
  });
});
