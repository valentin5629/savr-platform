/**
 * Choix de l'adresse de livraison à la programmation (Val 2026-11-19) : le
 * sélecteur n'apparaît que pour un lieu à 2 adresses ou plus, l'adresse n° 1
 * est présélectionnée, et l'adresse n° 2 ou n° 3 choisie est recopiée en entier
 * dans `lieu_overrides`.
 */
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  computeLieuOverrides,
  LieuChampsEditables,
  lieuToEdits,
  type LieuEdits,
} from './lieu-champs-editables';
import type { LieuOption } from './lieu-combobox';
import { adressesLivraisonDuLieu } from '@/lib/lieux/adresses-livraison';

const BNF: LieuOption = {
  id: 'lieu-bnf',
  nom: 'BNF',
  adresse_acces: 'Quai François Mauriac',
  code_postal: '75013',
  ville: 'Paris',
  controle_acces_requis_default: false,
  acces_details: null,
  libelle_adresse_2: 'Accès technique',
  adresse_acces_2: 'Rue Émile Durkheim',
  code_postal_2: '75013',
  ville_2: 'Paris',
};

function Harnais({ lieu }: { lieu: LieuOption }) {
  const [edits, setEdits] = React.useState<LieuEdits>(lieuToEdits(lieu));
  return (
    <>
      <LieuChampsEditables
        edits={edits}
        onChange={setEdits}
        adresses={adressesLivraisonDuLieu(lieu)}
      />
      <output data-testid="overrides">
        {JSON.stringify(
          computeLieuOverrides(
            lieuToEdits(lieu),
            edits,
            adressesLivraisonDuLieu(lieu),
          ),
        )}
      </output>
    </>
  );
}

describe('Sélecteur d’adresse de livraison (formulaire de programmation)', () => {
  it('absent pour un lieu à une seule adresse', () => {
    render(
      <Harnais
        lieu={{
          ...BNF,
          adresse_acces_2: null,
          code_postal_2: null,
          ville_2: null,
        }}
      />,
    );
    expect(screen.queryByTestId('choix-adresse-livraison')).toBeNull();
  });

  it('adresse n° 1 présélectionnée, aucune surcharge', () => {
    render(<Harnais lieu={BNF} />);
    expect(
      (screen.getByLabelText(/Adresse n° 1/) as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByTestId('overrides').textContent).toBe('{}');
  });

  it('l’adresse n° 2 choisie remplit les champs et part en entier dans lieu_overrides', () => {
    render(<Harnais lieu={BNF} />);
    fireEvent.click(screen.getByLabelText(/Adresse n° 2 · Accès technique/));
    expect(
      (screen.getByLabelText(/Adresse d'accès/) as HTMLInputElement).value,
    ).toBe('Rue Émile Durkheim');
    expect(JSON.parse(screen.getByTestId('overrides').textContent!)).toEqual({
      adresse_acces: 'Rue Émile Durkheim',
      code_postal: '75013',
      ville: 'Paris',
    });
  });

  it('revenir à l’adresse n° 1 retire la surcharge', () => {
    render(<Harnais lieu={BNF} />);
    fireEvent.click(screen.getByLabelText(/Adresse n° 2/));
    fireEvent.click(screen.getByLabelText(/Adresse n° 1/));
    expect(screen.getByTestId('overrides').textContent).toBe('{}');
  });

  it('une saisie libre ne coche aucune adresse et reste une surcharge champ par champ', () => {
    render(<Harnais lieu={BNF} />);
    fireEvent.change(screen.getByLabelText(/Adresse d'accès/), {
      target: { value: '3 rue ailleurs' },
    });
    expect(
      screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked),
    ).toBe(false);
    expect(JSON.parse(screen.getByTestId('overrides').textContent!)).toEqual({
      adresse_acces: '3 rue ailleurs',
    });
  });
});
