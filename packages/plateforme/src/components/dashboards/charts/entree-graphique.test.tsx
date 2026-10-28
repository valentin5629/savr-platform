/**
 * Entrée des graphiques des dashboards (Val 2026-10-28) : un graphique se
 * construit une seule fois par ouverture de page, quand il apparaît à l'écran ;
 * un rechargement des données ne rejoue rien ; hors dashboard, rien ne bouge.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EntreeGraphiques,
  delaiEntree,
  useCompteur,
  useEntreeGraphique,
} from './entree-graphique';

let rappels: Array<(e: Array<{ isIntersecting: boolean }>) => void> = [];

class FauxObservateur {
  constructor(rappel: (e: Array<{ isIntersecting: boolean }>) => void) {
    rappels.push(rappel);
  }
  observe() {}
  disconnect() {}
}

function Graphique({ cle = 'g' }: { cle?: string }) {
  const entree = useEntreeGraphique<HTMLDivElement>(cle);
  return (
    <div data-testid="graphique" ref={entree.ref} className={entree.classe} />
  );
}

const classe = (c: HTMLElement) =>
  c.querySelector('[data-testid="graphique"]')!.getAttribute('class');

function rendreVisible() {
  act(() => rappels.forEach((r) => r([{ isIntersecting: true }])));
}

describe('useEntreeGraphique', () => {
  beforeEach(() => {
    rappels = [];
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', FauxObservateur);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hors dashboard (sans EntreeGraphiques) : aucune animation', () => {
    const { container } = render(<Graphique />);
    expect(classe(container)).toBeNull();
    expect(rappels).toHaveLength(0);
  });

  it('figé tant que le graphique n’est pas à l’écran, joué quand il apparaît, puis retiré', () => {
    const { container } = render(
      <EntreeGraphiques>
        <Graphique />
      </EntreeGraphiques>,
    );
    expect(classe(container)).toBe('savr-entree savr-entree--attente');
    rendreVisible();
    expect(classe(container)).toBe('savr-entree');
    act(() => vi.advanceTimersByTime(1000));
    expect(classe(container)).toBeNull();
  });

  it('remonté après un rechargement des données : pas rejoué', () => {
    function Page({ charge }: { charge: boolean }) {
      return (
        <EntreeGraphiques>{charge ? null : <Graphique />}</EntreeGraphiques>
      );
    }
    const { container, rerender } = render(<Page charge={false} />);
    rendreVisible();
    rerender(<Page charge={true} />);
    rerender(<Page charge={false} />);
    expect(classe(container)).toBeNull();
  });

  it('nouvelle ouverture de la page : rejoué', () => {
    const page = (
      <EntreeGraphiques>
        <Graphique />
      </EntreeGraphiques>
    );
    const premiere = render(page);
    rendreVisible();
    premiere.unmount();
    const { container } = render(page);
    expect(classe(container)).toBe('savr-entree savr-entree--attente');
  });

  it('sans IntersectionObserver : affiché directement', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(
      <EntreeGraphiques>
        <Graphique />
      </EntreeGraphiques>,
    );
    expect(classe(container)).toBeNull();
  });
});

describe('delaiEntree', () => {
  it('étale une série sur 240 ms', () => {
    expect(delaiEntree(0, 5)).toEqual({ '--entree-delai': '0ms' });
    expect(delaiEntree(4, 5)).toEqual({ '--entree-delai': '240ms' });
    expect(delaiEntree(0, 1)).toEqual({ '--entree-delai': '0ms' });
  });
});

describe('useCompteur', () => {
  function Compteur({ cible }: { cible: number }) {
    const entree = useEntreeGraphique<HTMLDivElement>('compteur');
    const v = useCompteur(cible, entree.phase);
    return (
      <div data-testid="compteur" ref={entree.ref}>
        {Math.round(v)}
      </div>
    );
  }
  const lire = (c: HTMLElement) =>
    Number(c.querySelector('[data-testid="compteur"]')!.textContent);

  beforeEach(() => {
    rappels = [];
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
    vi.stubGlobal('IntersectionObserver', FauxObservateur);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hors dashboard : la valeur finale tout de suite', () => {
    const { container } = render(<Compteur cible={1300} />);
    expect(lire(container)).toBe(1300);
  });

  it('dashboard : 0 hors écran, monte quand il apparaît, finit sur la valeur', () => {
    const { container } = render(
      <EntreeGraphiques>
        <Compteur cible={1300} />
      </EntreeGraphiques>,
    );
    expect(lire(container)).toBe(0);
    rendreVisible();
    act(() => vi.advanceTimersByTime(200));
    const milieu = lire(container);
    expect(milieu).toBeGreaterThan(0);
    expect(milieu).toBeLessThan(1300);
    act(() => vi.advanceTimersByTime(1000));
    expect(lire(container)).toBe(1300);
  });

  it('moins d’animations demandé : la valeur finale, même à l’entrée', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { container } = render(
      <EntreeGraphiques>
        <Compteur cible={1300} />
      </EntreeGraphiques>,
    );
    expect(lire(container)).toBe(1300);
    rendreVisible();
    expect(lire(container)).toBe(1300);
  });
});
