/**
 * Bloc « Déclaration du coursier » de la fiche collecte Admin (décision Val
 * 2026-11-17) : champs saisis à « Colis récupéré », relus à l'ouverture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { DeclarationCoursierSection } from './declaration-coursier-section';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function repondre(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('DeclarationCoursierSection', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it(
    'affiche chaque champ déclaré, sous son libellé, et l’heure de la déclaration',
    async () => {
      const fetchMock = repondre(200, {
        courses: [
          {
            course: 1,
            declare_le: '2026-11-17T09:30:00.000Z',
            poids_kg: 12.5,
            champs: [
              { nom: 'Poids en Kg obligatoire', valeur: '12,5' },
              { nom: '30 et 59,99 kg ( oui ou non )', valeur: 'Oui' },
              {
                nom: "Minutes d'attentes ( nombre ) colis récupéré",
                valeur: '',
              },
            ],
          },
        ],
        courses_sans_declaration: 0,
      });
      render(<DeclarationCoursierSection collecteId="col 1" />);

      const bloc = await screen.findByTestId(
        'bloc-declaration-coursier',
        undefined,
        ATTENTE_UI,
      );
      expect(
        await within(bloc).findByText('12,5', undefined, ATTENTE_UI),
      ).toBeTruthy();
      const poids = within(bloc).getByText('Poids en Kg obligatoire');
      expect(poids.parentElement?.textContent).toContain('12,5');
      const tranche = within(bloc).getByText('30 et 59,99 kg ( oui ou non )');
      expect(tranche.parentElement?.textContent).toContain('Oui');
      const attente = within(bloc).getByText(
        "Minutes d'attentes ( nombre ) colis récupéré",
      );
      expect(attente.parentElement?.textContent).toContain('—');
      expect(within(bloc).getByText('Déclaré le 17/11 10:30')).toBeTruthy();
      expect(within(bloc).queryByText(/Vélo/)).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/collectes/col%201/declaration-coursier',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'plusieurs vélos : chaque déclaration porte son vélo, les manquants sont comptés',
    async () => {
      repondre(200, {
        courses: [
          {
            course: 2,
            declare_le: null,
            poids_kg: 8,
            champs: [{ nom: 'Poids en Kg obligatoire', valeur: '8' }],
          },
        ],
        courses_sans_declaration: 1,
      });
      render(<DeclarationCoursierSection collecteId="col-1" />);
      expect(
        await screen.findByText('Vélo 2 · Déclaré', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(
        screen.getByText('Un vélo n’a pas encore déclaré l’enlèvement.'),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'aucune déclaration encore',
    async () => {
      repondre(200, { courses: [], courses_sans_declaration: 1 });
      render(<DeclarationCoursierSection collecteId="col-1" />);
      expect(
        await screen.findByText(
          'Le coursier n’a pas encore déclaré l’enlèvement.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'relecture en échec : message d’erreur',
    async () => {
      repondre(500, { error: 'Erreur interne' });
      render(<DeclarationCoursierSection collecteId="col-1" />);
      expect(
        await screen.findByText('Erreur interne', undefined, ATTENTE_UI),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );
});
