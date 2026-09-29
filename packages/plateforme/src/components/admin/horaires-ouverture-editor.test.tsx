/**
 * HorairesOuvertureEditor — présentation « heures hebdomadaires » (décision Val
 * 2026-09-29, CDC §06.06 Associations « Horaires d'ouverture »).
 * Épingle : jour fermé = « Indisponible » + « + » ; retirer le dernier créneau
 * ferme le jour ; « + » ajoute un créneau à la suite ; copie vers d'autres jours ;
 * aucun input time natif ; format JSON inchangé.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import {
  HorairesOuvertureEditor,
  creneauSuivant,
  horairesParDefaut,
  type JourHoraire,
} from '@/components/admin/horaires-ouverture-editor';

function Harness({ initial }: { initial: JourHoraire[] }) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <HorairesOuvertureEditor value={value} onChange={setValue} />
      <pre data-testid="json">{JSON.stringify(value)}</pre>
    </>
  );
}

const lire = (): JourHoraire[] =>
  JSON.parse(screen.getByTestId('json').textContent ?? '[]');

describe('HorairesOuvertureEditor', () => {
  it('horaires/jour_ferme_indisponible_sans_input_natif', () => {
    const { container } = render(<Harness initial={horairesParDefaut()} />);
    expect(screen.getAllByText('Indisponible')).toHaveLength(7);
    expect(container.querySelector('input[type="time"]')).toBeNull();
  });

  it('horaires/plus_ouvre_le_jour_avec_creneau_defaut', () => {
    render(<Harness initial={horairesParDefaut()} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Ajouter des horaires le lundi' }),
    );
    const lundi = lire()[0];
    expect(lundi).toEqual({
      jour: 'lundi',
      ouvert: true,
      creneaux: [{ debut: '09:00', fin: '18:00' }],
    });
    const ligne = screen.getByTestId('horaires-lundi');
    expect(within(ligne).queryByText('Indisponible')).toBeNull();
    expect(
      within(ligne).getByRole('button', {
        name: 'Lundi — début du créneau 1',
      }),
    ).toHaveTextContent('09:00');
  });

  it('horaires/retirer_dernier_creneau_ferme_le_jour', () => {
    const initial = horairesParDefaut().map((j) =>
      j.jour === 'mardi' ? { ...j, ouvert: true } : j,
    );
    render(<Harness initial={initial} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Retirer le créneau 1 du mardi' }),
    );
    expect(lire()[1]?.ouvert).toBe(false);
    expect(
      within(screen.getByTestId('horaires-mardi')).getByText('Indisponible'),
    ).toBeInTheDocument();
  });

  it('horaires/ajouter_creneau_a_la_suite', () => {
    const initial = horairesParDefaut().map((j) =>
      j.jour === 'lundi'
        ? { ...j, ouvert: true, creneaux: [{ debut: '08:30', fin: '12:00' }] }
        : j,
    );
    render(<Harness initial={initial} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Ajouter un créneau le lundi' }),
    );
    expect(lire()[0]?.creneaux).toEqual([
      { debut: '08:30', fin: '12:00' },
      { debut: '12:00', fin: '13:00' },
    ]);
    expect(creneauSuivant({ debut: '20:00', fin: '23:15' })).toEqual({
      debut: '09:00',
      fin: '18:00',
    });
  });

  it('horaires/copier_vers_autres_jours', () => {
    const initial = horairesParDefaut().map((j) =>
      j.jour === 'lundi'
        ? {
            ...j,
            ouvert: true,
            creneaux: [
              { debut: '08:30', fin: '12:00' },
              { debut: '14:00', fin: '16:30' },
            ],
          }
        : j,
    );
    render(<Harness initial={initial} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Copier les horaires du lundi' }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mardi' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vendredi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    const v = lire();
    expect(v[1]).toEqual({ ...v[0], jour: 'mardi' });
    expect(v[4]).toEqual({ ...v[0], jour: 'vendredi' });
    expect(v[2]?.ouvert).toBe(false);
  });
});
