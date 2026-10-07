/**
 * R-UI-5 (F4, F5, G3) — en-tête de section, paires libellé / valeur et shell
 * des fiches en pop-up. Chaque test fige la RECETTE (classes, structure) que la
 * primitive centralise : l'iso-rendu de la migration se vérifie ici, pas site
 * par site (jsdom ne calcule aucune mise en page).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Building2 } from 'lucide-react';
import { SectionCard, SectionHeader } from '@/components/ui/section-header';
import { InfoItem } from '@/components/ui/info-item';
import {
  FicheCorps,
  FicheModal,
  FichePied,
} from '@/components/ui/fiche/fiche-modal';
import { FicheEnTete } from '@/components/ui/fiche/fiche-en-tete';
import { OngletAvecErreurs } from '@/components/ui/fiche/onglet-avec-erreurs';
import { Tabs, TabsList } from '@/components/ui/tabs';

describe('R-UI-5 F4 — SectionHeader / SectionCard', () => {
  it('h2 par défaut : pastille primary-50 + titre extrabold tronqué', () => {
    const { container } = render(
      <SectionHeader icon={Building2} title="Informations légales" />,
    );
    const titre = screen.getByRole('heading', {
      level: 2,
      name: 'Informations légales',
    });
    expect(titre.className).toMatch(/\btext-base\b/);
    expect(titre.className).toMatch(/\bfont-extrabold\b/);
    expect(titre.className).toMatch(/\btruncate\b/);
    expect(titre.className).toMatch(/tracking-\[-0\.01em\]/);
    const pastille = container.querySelector('span')!;
    expect(pastille.className).toMatch(/\bbg-savr-primary-50\b/);
    expect(pastille.className).toMatch(/\bh-8\b/);
    expect(pastille.querySelector('svg')).not.toBeNull();
    // Racine : rangée titre / action.
    expect((container.firstChild as HTMLElement).className).toBe(
      'flex items-center justify-between gap-3',
    );
  });

  it('action : placée à droite, hors du titre, non rétrécissable', () => {
    const onClick = vi.fn();
    render(
      <SectionHeader
        icon={Building2}
        title="Utilisateurs"
        action={<button onClick={onClick}>Ajouter un utilisateur</button>}
      />,
    );
    const bouton = screen.getByRole('button', {
      name: 'Ajouter un utilisateur',
    });
    expect(bouton.parentElement!.className).toBe('shrink-0');
    expect(
      screen.getByRole('heading', { name: 'Utilisateurs' }).contains(bouton),
    ).toBe(false);
    fireEvent.click(bouton);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('SectionCard : carte bordée p-4 sm:p-5, titre h3 non tronqué, champs espacés', () => {
    const { container } = render(
      <SectionCard icon={Building2} title="Identité">
        <p>champ</p>
      </SectionCard>,
    );
    const section = container.querySelector('section')!;
    expect(section.className).toBe(
      'rounded-savr-md border border-savr-neutral-200 bg-savr-white p-4 sm:p-5',
    );
    const titre = screen.getByRole('heading', { level: 3, name: 'Identité' });
    expect(titre.className).toMatch(/\bfont-extrabold\b/);
    expect(titre.className).not.toMatch(/\btruncate\b/);
    expect(section.firstElementChild!.className).toMatch(/\bmb-4\b/);
    expect(screen.getByText('champ').parentElement!.className).toBe(
      'space-y-4',
    );
  });
});

describe('R-UI-5 F5 — InfoItem', () => {
  it('rendu <div><dt/><dd/></div> dans un <dl> : libellé gris, valeur medium', () => {
    render(
      <dl>
        <InfoItem label="SIREN">123 456 789</InfoItem>
      </dl>,
    );
    const dt = screen.getByText('SIREN');
    const dd = screen.getByText('123 456 789');
    expect(dt.tagName).toBe('DT');
    expect(dd.tagName).toBe('DD');
    expect(dt.className).toBe('text-savr-neutral-500');
    expect(dd.className).toBe('font-medium');
    // Pas de classe vide sur le groupe.
    expect(dt.parentElement!.hasAttribute('class')).toBe(false);
  });

  it('pleineLargeur → sm:col-span-2 ; className / valueClassName / attributs', () => {
    render(
      <dl>
        <InfoItem
          label="Traiteur"
          pleineLargeur
          data-testid="groupe"
          valueClassName="flex items-center gap-2"
        >
          Kaspia
        </InfoItem>
        <InfoItem label="Motif" className="col-span-2">
          x
        </InfoItem>
      </dl>,
    );
    expect(screen.getByTestId('groupe').className).toBe('sm:col-span-2');
    expect(screen.getByText('Kaspia').className).toBe(
      'font-medium flex items-center gap-2',
    );
    expect(screen.getByText('Motif').parentElement!.className).toBe(
      'col-span-2',
    );
  });

  it.each([
    ['texte', 'text-savr-neutral-500', 'leading-relaxed text-savr-neutral-700'],
    ['hint', 'text-xs text-savr-neutral-500', null],
    [
      'overline',
      'text-xs text-savr-neutral-500 font-semibold uppercase tracking-wide',
      'mt-0.5 flex flex-wrap items-center gap-1 text-savr-neutral-900',
    ],
    ['caps', 'text-xs uppercase text-savr-neutral-500', 'text-sm'],
  ] as const)(
    'variante %s : recette du libellé et de la valeur',
    (variant, libelle, valeur) => {
      render(
        <dl>
          <InfoItem variant={variant} label="Libellé">
            Valeur
          </InfoItem>
        </dl>,
      );
      expect(screen.getByText('Libellé').className).toBe(libelle);
      const dd = screen.getByText('Valeur');
      if (valeur === null) expect(dd.hasAttribute('class')).toBe(false);
      else expect(dd.className).toBe(valeur);
    },
  );
});

describe('R-UI-5 G3 — shell des fiches en pop-up', () => {
  it('FicheModal : titre réservé aux lecteurs d’écran, cadre large à hauteur fixe', () => {
    render(
      <FicheModal open title="Fiche lieu — Pavillon" onClose={() => {}}>
        <FicheEnTete titre="Pavillon" />
        <FicheCorps>corps</FicheCorps>
        <FichePied>pied</FichePied>
      </FicheModal>,
    );
    const dialogue = screen.getByRole('dialog', {
      name: 'Fiche lieu — Pavillon',
    });
    expect(dialogue.className).toMatch(/\bmax-w-5xl\b/);
    expect(dialogue.className).toMatch(/md:h-\[min\(90vh,48rem\)\]/);
    const titreModal = dialogue.querySelector('h2')!;
    expect(titreModal.className).toBe('sr-only');
    // Corps de la Modal sans marge ni défilement propre : c'est FicheCorps
    // qui défile, l'en-tête et le pied restent fixes.
    const corpsModal = screen.getByText('corps').parentElement!;
    expect(corpsModal.className).toMatch(/\boverflow-hidden\b/);
    expect(corpsModal.className).toMatch(/\bp-0\b/);
    expect(screen.getByText('corps').className).toBe(
      'min-h-0 flex-1 overflow-y-auto px-6 py-4 md:px-8',
    );
    const pied = screen.getByText('pied');
    expect(pied.tagName).toBe('FOOTER');
    expect(pied.className).toMatch(/\bshrink-0\b/);
    expect(pied.className).toMatch(/\bborder-t\b/);
    expect(pied.className).toMatch(/\bmd:px-8\b/);
  });

  it('FicheModal : prop footer = pied de la Modal ; fermée → rien', () => {
    const { rerender } = render(
      <FicheModal
        open
        title="Fiche"
        onClose={() => {}}
        footer={<button>Enregistrer</button>}
      >
        <FicheCorps>corps</FicheCorps>
      </FicheModal>,
    );
    expect(
      screen.getByRole('button', { name: 'Enregistrer' }),
    ).toBeInTheDocument();
    rerender(
      <FicheModal open={false} title="Fiche" onClose={() => {}}>
        <FicheCorps>corps</FicheCorps>
      </FicheModal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('FicheCorps : className surcharge le padding vertical (py-6)', () => {
    render(<FicheCorps className="py-6">édition</FicheCorps>);
    const corps = screen.getByText('édition');
    expect(corps.className).toMatch(/\bpy-6\b/);
    expect(corps.className).not.toMatch(/\bpy-4\b/);
  });

  it('OngletAvecErreurs : pastille + nom accessible « (N champs à corriger) »', () => {
    render(
      <Tabs value="a">
        <TabsList>
          <OngletAvecErreurs value="a" nbErreurs={2}>
            Informations
          </OngletAvecErreurs>
          <OngletAvecErreurs value="b" nbErreurs={0}>
            Logistique
          </OngletAvecErreurs>
        </TabsList>
      </Tabs>,
    );
    expect(
      screen.getByRole('tab', { name: 'Informations (2 champs à corriger)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Logistique' })).toBeInTheDocument();
  });
});
