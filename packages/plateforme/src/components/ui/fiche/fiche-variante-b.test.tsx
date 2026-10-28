import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MapPinIcon } from '@/components/ui/icones';
import { Tabs } from '@/components/ui/tabs';
import { FicheCorps, FicheModal, FichePied } from './fiche-modal';
import {
  FicheGrandEnTete,
  FicheOnglet,
  FicheOnglets,
  FicheRepere,
} from './fiche-grand-en-tete';
import { FicheSection } from './fiche-section';
import { FichePastille, FichePastilleActif } from './fiche-pastille';

// Briques communes de la variante B (décision Val 2026-10-27) : fiches
// collecte, fiches Admin transporteur, lieu, association.

describe('Briques variante B des fiches', () => {
  it('FicheGrandEnTete : titre, sous-titre, statut, repères et onglets', () => {
    render(
      <Tabs value="a">
        <FicheGrandEnTete
          surtitre={<span>IDF</span>}
          titre="Pavillon Royal"
          sousTitre="Lieu · Client"
          statut={<FichePastille ton="vert">Actif</FichePastille>}
          reperesTestId="reperes"
          reperes={<FicheRepere icon={MapPinIcon}>Paris 75016</FicheRepere>}
          onglets={
            <FicheOnglets aria-label="Sections">
              <FicheOnglet value="a">Informations</FicheOnglet>
            </FicheOnglets>
          }
        />
      </Tabs>,
    );
    expect(screen.getByRole('heading', { name: 'Pavillon Royal' })).toHaveClass(
      'font-display',
    );
    expect(screen.getByText('Lieu · Client')).toBeInTheDocument();
    expect(screen.getByText('Actif')).toBeInTheDocument();
    expect(screen.getByTestId('reperes')).toHaveTextContent('Paris 75016');
    expect(
      within(screen.getByRole('banner')).getByRole('tablist', {
        name: 'Sections',
      }),
    ).toBeInTheDocument();
  });

  it('FicheGrandEnTete : sans sur-titre, la ligne du titre réserve la croix', () => {
    render(<FicheGrandEnTete titre="Nouveau lieu" description="Consigne" />);
    const titre = screen.getByRole('heading', { name: 'Nouveau lieu' });
    expect(titre.parentElement?.parentElement).toHaveClass('pr-12');
    expect(screen.getByText('Consigne')).toBeInTheDocument();
  });

  it('FicheOnglet : pastille et nom accessible « (N champs à corriger) »', () => {
    render(
      <Tabs value="a">
        <FicheOnglets>
          <FicheOnglet value="a" nbErreurs={2}>
            Informations
          </FicheOnglet>
          <FicheOnglet value="b" nbErreurs={1}>
            Accès
          </FicheOnglet>
          <FicheOnglet value="c">Activité</FicheOnglet>
        </FicheOnglets>
      </Tabs>,
    );
    expect(
      screen.getByRole('tab', { name: 'Informations (2 champs à corriger)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Accès (1 champ à corriger)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Activité' })).toBeInTheDocument();
  });

  it('FicheOnglets mobile="pastilles" : onglets en pastilles sous 640 px', () => {
    render(
      <Tabs value="a">
        <FicheOnglets mobile="pastilles">
          <FicheOnglet value="a">Infos</FicheOnglet>
        </FicheOnglets>
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toHaveClass('grid-cols-3');
    expect(screen.getByRole('tab', { name: 'Infos' })).toHaveClass(
      'max-sm:rounded-savr-full',
    );
  });

  it('FicheSection : libellé à gauche, contenu à droite, filet sable', () => {
    render(
      <FicheSection titre="Identité" data-testid="section">
        <p>Contenu</p>
      </FicheSection>,
    );
    const section = screen.getByTestId('section');
    expect(section).toHaveClass('border-savr-sable-200');
    expect(
      within(section).getByRole('heading', { name: 'Identité' }),
    ).toBeInTheDocument();
    expect(within(section).getByText('Contenu')).toBeInTheDocument();
  });

  it('FichePastilleActif : Actif en vert, Inactif en sable', () => {
    const { rerender } = render(<FichePastilleActif actif />);
    expect(screen.getByText('Actif')).toHaveClass('bg-savr-success-subtle');
    rerender(<FichePastilleActif actif={false} />);
    expect(screen.getByText('Inactif')).toHaveClass('bg-savr-sable-100');
  });

  it('FicheModal taille="grand" : pied sous le corps, marges du grand format', () => {
    render(
      <FicheModal
        open
        title="Fiche"
        onClose={vi.fn()}
        taille="grand"
        footer={<button type="button">Enregistrer</button>}
      >
        <FicheCorps>corps</FicheCorps>
      </FicheModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-w-[75rem]');
    expect(screen.getByText('corps')).toHaveClass('md:px-12');
    const pied = screen.getByRole('button', { name: 'Enregistrer' })
      .parentElement as HTMLElement;
    expect(pied.tagName).toBe('FOOTER');
    expect(pied).toHaveClass('border-savr-sable-200');
  });

  it('FicheModal standard : corps et pied gardent les marges d’origine', () => {
    render(
      <FicheModal open title="Fiche" onClose={vi.fn()}>
        <FicheCorps>corps</FicheCorps>
        <FichePied>pied</FichePied>
      </FicheModal>,
    );
    expect(screen.getByText('corps')).toHaveClass('md:px-8');
    expect(screen.getByText('pied')).toHaveClass('border-savr-neutral-200');
  });
});
