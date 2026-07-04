/**
 * Briques UI du re-style collectes (PageHero, FilterChips, AlertBar, Modal,
 * Timeline). Extraites de la maquette Admin V1, stylées sur les tokens §10.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PageHero } from '@/components/ui/page-hero';
import { FilterChips } from '@/components/ui/filter-chips';
import { AlertBar } from '@/components/ui/alert-bar';
import { Modal } from '@/components/ui/modal';
import { Timeline, TimelineItem } from '@/components/ui/timeline';
import { Button } from '@/components/ui/button';

// ── PageHero ──────────────────────────────────────────────────────────────────

describe('PageHero', () => {
  it('rend un <h1> sur aplat primary-700 (levier #2) + sous-titre + actions', () => {
    const { container } = render(
      <PageHero
        title="Collectes"
        subtitle="12 collectes"
        actions={<Button>Programmer une collecte</Button>}
      />,
    );
    const hero = container.firstElementChild!;
    expect(hero.className).toContain('bg-savr-primary-700');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Collectes');
    expect(screen.getByText('12 collectes')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Programmer une collecte' }),
    ).toBeInTheDocument();
  });
});

// ── FilterChips ───────────────────────────────────────────────────────────────

describe('FilterChips', () => {
  const chips = [
    { key: '', label: 'Toutes' },
    { key: 'a', label: 'Non transmises', count: 3 },
    { key: 'b', label: 'ZD 48h' },
  ];

  it('marque le chip actif (aria-pressed) et affiche la pastille compteur', () => {
    render(<FilterChips chips={chips} activeKey="a" onSelect={() => {}} />);
    const actif = screen.getByRole('button', { name: /Non transmises/ });
    expect(actif).toHaveAttribute('aria-pressed', 'true');
    expect(actif).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Toutes' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('appelle onSelect avec la clé du chip cliqué', () => {
    const onSelect = vi.fn();
    render(<FilterChips chips={chips} activeKey="" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'ZD 48h' }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});

// ── AlertBar ──────────────────────────────────────────────────────────────────

describe('AlertBar', () => {
  it('variante warn applique fond warning-subtle + texte warning-strong', () => {
    const { container } = render(<AlertBar variant="warn">Attention</AlertBar>);
    const bar = container.firstElementChild!;
    expect(bar.className).toContain('bg-savr-warning-subtle');
    expect(bar.className).toContain('text-savr-warning-strong');
    expect(screen.getByText('Attention')).toBeInTheDocument();
  });

  it('variante err applique fond error-subtle + texte error-strong', () => {
    const { container } = render(<AlertBar variant="err">Erreur</AlertBar>);
    expect(container.firstElementChild!.className).toContain(
      'bg-savr-error-subtle',
    );
    expect(container.firstElementChild!.className).toContain(
      'text-savr-error-strong',
    );
  });
});

// ── Modal ─────────────────────────────────────────────────────────────────────

describe('Modal', () => {
  it('ne rend rien quand open=false', () => {
    render(
      <Modal open={false} title="Titre" onClose={() => {}}>
        Contenu
      </Modal>,
    );
    expect(screen.queryByText('Titre')).not.toBeInTheDocument();
  });

  it('rend un role="dialog" radius-lg + shadow-lg avec titre, corps, pied', () => {
    render(
      <Modal
        open
        title="Titre modale"
        onClose={() => {}}
        footer={<button>Confirmer</button>}
      >
        Corps
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('rounded-savr-lg');
    expect(dialog.className).toContain('shadow-savr-lg');
    expect(screen.getByText('Corps')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirmer' }),
    ).toBeInTheDocument();
  });

  // Contrat de compat avec la fiche collecte : `getByText(titre).closest('div')`
  // doit résoudre le panneau ENTIER (le pied + son bouton de confirmation inclus).
  it('le div ancêtre du titre contient le bouton de pied (compat closest("div"))', () => {
    render(
      <Modal
        open
        title="Forcer le statut de la collecte"
        onClose={() => {}}
        footer={<button>Confirmer le forçage</button>}
      >
        Corps
      </Modal>,
    );
    const panel = screen
      .getByText('Forcer le statut de la collecte')
      .closest('div') as HTMLElement;
    expect(
      within(panel).getByRole('button', { name: /Confirmer le forçage/ }),
    ).toBeInTheDocument();
  });

  it('Échap ferme + clic sur l’overlay ferme (pas le clic sur le panneau)', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="T" onClose={onClose}>
        <p>Corps</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Clic sur le panneau ne ferme pas
    fireEvent.mouseDown(screen.getByText('Corps'));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Clic sur l'overlay ferme
    const overlay = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

// ── Timeline ──────────────────────────────────────────────────────────────────

describe('Timeline', () => {
  it('rend une liste ordonnée à bordure gauche avec des items', () => {
    const { container } = render(
      <Timeline>
        <TimelineItem>
          <p>Événement A</p>
        </TimelineItem>
        <TimelineItem>
          <p>Événement B</p>
        </TimelineItem>
      </Timeline>,
    );
    const ol = container.querySelector('ol')!;
    expect(ol.className).toContain('border-l-2');
    expect(ol.querySelectorAll('li').length).toBe(2);
    expect(screen.getByText('Événement A')).toBeInTheDocument();
    expect(screen.getByText('Événement B')).toBeInTheDocument();
  });
});
