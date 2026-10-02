/**
 * R-UI-3 — boutons et confirmations : Button `loading` + variants destructifs,
 * IconButton `loading`, TextLink, FormActions, ConfirmDialog / useConfirm,
 * AnnulationCollecteDialog. Chaque test fige la RECETTE ou le CONTRAT que la
 * primitive centralise (ex-ternaires `{x ? 'Enregistrement…' : …}`,
 * ex-`authLienClass`, ex-`ACTION_DESTRUCTIVE_CONTOUR`, ex-`window.confirm`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { Button, buttonVariants } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { TextLink } from '@/components/ui/text-link';
import { FormActions } from '@/components/ui/form-actions';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import { AnnulationCollecteDialog } from '@/components/collecte/annulation-collecte-dialog';

describe('Button loading — spinner, aria-busy, libellé « en cours »', () => {
  it('loading : désactivé + aria-busy + Loader2 + loadingText à la place des enfants', () => {
    render(
      <Button loading loadingText="Enregistrement…">
        Enregistrer
      </Button>,
    );
    const b = screen.getByRole('button');
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b.querySelector('svg.animate-spin')).not.toBeNull();
    expect(b.textContent).toBe('Enregistrement…');
  });

  it('sans loadingText : les enfants restent (icône + texte) ; hors loading ni spinner ni aria-busy', () => {
    const { rerender } = render(<Button loading>Renvoyer</Button>);
    expect(screen.getByRole('button').textContent).toBe('Renvoyer');
    rerender(<Button>Renvoyer</Button>);
    const b = screen.getByRole('button');
    expect(b).not.toHaveAttribute('aria-busy');
    expect(b.querySelector('svg')).toBeNull();
    expect(b).not.toBeDisabled();
  });

  it('la base dimensionne les icônes ([&>svg]:h-4 w-4) : plus de h-4 w-4 / mr-* site par site', () => {
    expect(buttonVariants({})).toContain('[&>svg]:h-4');
    expect(buttonVariants({})).toContain('[&>svg]:w-4');
    expect(buttonVariants({})).toContain('gap-2');
  });

  it('variants destructifs secondaires : ghost-destructive / outline-destructive / outline-warning (ex-ACTION_DESTRUCTIVE_CONTOUR)', () => {
    const outline = buttonVariants({ variant: 'outline-destructive' });
    for (const c of [
      'bg-savr-white',
      'border-savr-error',
      'text-savr-error-strong',
      'hover:bg-savr-error-subtle',
    ]) {
      expect(outline).toContain(c);
    }
    expect(outline).not.toContain('bg-savr-error ');
    expect(buttonVariants({ variant: 'ghost-destructive' })).toContain(
      'text-savr-error',
    );
    expect(buttonVariants({ variant: 'outline-warning' })).toContain(
      'border-savr-warning-strong',
    );
  });

  it('size="icon" n’existe plus sur Button (doublon d’IconButton)', () => {
    // @ts-expect-error — size icon retiré (R-UI-3, B4)
    expect(buttonVariants({ size: 'icon' })).not.toContain('h-11 w-11');
  });
});

describe('IconButton loading', () => {
  it('loading : spinner à la place de l’icône, désactivé, aria-busy ; aria-label conservé', () => {
    render(
      <IconButton aria-label="Enregistrer la ligne" loading>
        <span data-testid="icone" />
      </IconButton>,
    );
    const b = screen.getByRole('button', { name: 'Enregistrer la ligne' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('icone')).toBeNull();
    expect(b.querySelector('svg.animate-spin')).not.toBeNull();
  });
});

describe('TextLink — recette unique des liens texte', () => {
  const RECETTE = [
    'inline-flex',
    'items-center',
    'gap-1',
    'text-savr-primary-700',
    'underline-offset-4',
    'hover:underline',
  ];

  it('href interne → <a> (next/link) avec la recette ; strong = font-semibold ; touch = -my-3 py-3 (ex-authLienClass)', () => {
    render(
      <TextLink href="/login" strong touch className="text-sm">
        Se connecter
      </TextLink>,
    );
    const a = screen.getByRole('link', { name: 'Se connecter' });
    expect(a).toHaveAttribute('href', '/login');
    for (const c of [...RECETTE, 'font-semibold', '-my-3', 'py-3', 'text-sm']) {
      expect(a).toHaveClass(c);
    }
  });

  it('external → <a> natif (href tel:/mailto:/fichier, target) ; onClick seul → <button type="button">', () => {
    const onClick = vi.fn();
    render(
      <>
        <TextLink href="tel:0600000000" external>
          06 00 00 00 00
        </TextLink>
        <TextLink onClick={onClick}>Télécharger le PDF</TextLink>
      </>,
    );
    expect(
      screen.getByRole('link', { name: '06 00 00 00 00' }),
    ).toHaveAttribute('href', 'tel:0600000000');
    const b = screen.getByRole('button', { name: 'Télécharger le PDF' });
    expect(b).toHaveAttribute('type', 'button');
    for (const c of RECETTE) expect(b).toHaveClass(c);
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('FormActions — secondaire puis primaire, à droite (§5.5 (8))', () => {
  it('ordre DOM : annuler (secondary, type=button) avant l’action (type=submit) ; rangée justify-end ; bordered = filet', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <FormActions
        bordered
        cancel={{ label: 'Annuler', onClick: onCancel }}
        submit={{ label: 'Enregistrer', form: 'f1' }}
      />,
    );
    const boutons = screen.getAllByRole('button');
    expect(boutons.map((b) => b.textContent)).toEqual([
      'Annuler',
      'Enregistrer',
    ]);
    const annuler = screen.getByRole('button', { name: 'Annuler' });
    const enregistrer = screen.getByRole('button', { name: 'Enregistrer' });
    expect(annuler).toHaveAttribute('type', 'button');
    expect(annuler).toHaveClass('border-savr-neutral-300');
    expect(enregistrer).toHaveAttribute('type', 'submit');
    expect(enregistrer).toHaveAttribute('form', 'f1');
    const row = container.firstElementChild as HTMLElement;
    for (const c of [
      'flex',
      'justify-end',
      'gap-2',
      'border-t',
      'border-savr-neutral-100',
      'pt-4',
    ]) {
      expect(row).toHaveClass(c);
    }
    fireEvent.click(annuler);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('loading : l’action passe en « en cours » (loadingText) et annuler est désactivé', () => {
    render(
      <FormActions
        loading
        loadingText="Création…"
        cancel={{ label: 'Annuler' }}
        submit={{ label: 'Créer', variant: 'destructive' }}
      />,
    );
    const annuler = screen.getByRole('button', { name: 'Annuler' });
    const creer = screen.getByRole('button', { name: 'Création…' });
    expect(annuler).toBeDisabled();
    expect(creer).toBeDisabled();
    expect(creer).toHaveAttribute('aria-busy', 'true');
    expect(creer.textContent).toBe('Création…');
    expect(creer).toHaveClass('bg-savr-error');
  });
});

describe('ConfirmDialog — confirmation destructive avec motif', () => {
  it(
    'motif ≥ 10 : confirmation bloquée tant que le motif est court, puis onConfirm(motif) ; Retour = onCancel',
    async () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      render(
        <ConfirmDialog
          open
          title="Annuler le pack"
          confirmLabel="Confirmer l’annulation"
          cancelLabel="Retour"
          variant="destructive"
          motif={{ label: 'Motif', minLength: 10 }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          Les crédits non consommés seront perdus.
        </ConfirmDialog>,
      );
      expect(
        screen.getByRole('dialog', { name: 'Annuler le pack' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Les crédits non consommés seront perdus.'),
      ).toBeInTheDocument();
      const confirmer = screen.getByRole('button', {
        name: 'Confirmer l’annulation',
      });
      expect(confirmer).toBeDisabled();
      expect(confirmer).toHaveClass('bg-savr-error');
      fireEvent.change(screen.getByLabelText(/Motif/), {
        target: { value: 'court' },
      });
      expect(confirmer).toBeDisabled();
      fireEvent.change(screen.getByLabelText(/Motif/), {
        target: { value: 'Erreur de saisie du pack' },
      });
      await waitFor(() => expect(confirmer).not.toBeDisabled(), ATTENTE_UI);
      fireEvent.click(confirmer);
      expect(onConfirm).toHaveBeenCalledWith('Erreur de saisie du pack');
      fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    },
    ATTENTE_CAS_MS,
  );

  it('error affiché en AlertBar ; loading passe l’action en cours', () => {
    render(
      <ConfirmDialog
        open
        title="Supprimer ?"
        confirmLabel="Supprimer"
        loading
        loadingText="Suppression…"
        error="Suppression refusée."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Suppression refusée.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Suppression…' }),
    ).toHaveAttribute('aria-busy', 'true');
  });

  it(
    'useConfirm : confirmer() résout true à la confirmation, false à l’annulation (remplace window.confirm)',
    async () => {
      const resultats: boolean[] = [];
      function Composant() {
        const { confirmer, dialogue } = useConfirm();
        return (
          <>
            <button
              type="button"
              onClick={() =>
                void confirmer({
                  title: 'Supprimer ce brouillon ?',
                  confirmLabel: 'Supprimer',
                  variant: 'destructive',
                }).then((ok) => resultats.push(ok))
              }
            >
              Ouvrir
            </button>
            {dialogue}
          </>
        );
      }
      render(<Composant />);
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Supprimer' }, ATTENTE_UI),
      );
      await waitFor(() => expect(resultats).toEqual([true]), ATTENTE_UI);
      await waitFor(
        () => expect(screen.queryByRole('dialog')).toBeNull(),
        ATTENTE_UI,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Retour' }, ATTENTE_UI),
      );
      await waitFor(() => expect(resultats).toEqual([true, false]), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );
});

describe('AnnulationCollecteDialog — une seule modale liste + fiche', () => {
  it('demande (validee) : titre « Demander l’annulation » ; AG : mention crédit préservé ; motif facultatif transmis', () => {
    const onConfirm = vi.fn();
    render(
      <AnnulationCollecteDialog
        open
        demande
        antiGaspi
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Demander l’annulation' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('mention-credit-ag')).toBeInTheDocument();
    const confirmer = screen.getByRole('button', {
      name: 'Confirmer la demande',
    });
    expect(confirmer).not.toBeDisabled();
    fireEvent.click(confirmer);
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('annulation directe ZD : « Annuler la collecte » / « Confirmer l’annulation », sans mention AG', () => {
    render(
      <AnnulationCollecteDialog
        open
        demande={false}
        antiGaspi={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Annuler la collecte' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mention-credit-ag')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Confirmer l’annulation' }),
    ).toBeInTheDocument();
  });
});
