import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from '@/components/layout/app-shell';
import { ImpersonationBanner } from '@/components/ui/impersonation-banner';

vi.mock('next/navigation', () => ({
  usePathname: () => '/traiteur',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Bug E2E 2026-11-02 : le bandeau d'impersonation, au-dessus du cadre
// `h-screen`, faisait dépasser la page de sa hauteur (bande vide en bas).
// La règle de globals.css s'appuie sur deux repères : ils doivent exister.
// jsdom ne calcule pas la mise en page : l'effet a été mesuré dans le navigateur.
describe("Bandeau d'impersonation au-dessus du cadre", () => {
  it('le bandeau porte son repère', () => {
    render(<ImpersonationBanner userName="a@b.fr" onExit={() => {}} />);
    expect(screen.getByRole('alert')).toHaveAttribute(
      'data-bandeau-impersonation',
    );
  });

  it('le cadre de l’app porte son repère', () => {
    const { container } = render(
      <AppShell role="traiteur_manager">
        <p>contenu</p>
      </AppShell>,
    );
    expect(container.firstElementChild).toHaveAttribute('data-cadre-app');
  });

  it('globals.css ajuste le cadre quand les deux repères sont présents', () => {
    const css = readFileSync(
      resolve(__dirname, '../../app/globals.css'),
      'utf8',
    );
    const bloc = (selecteur: string): string => {
      const debut = css.indexOf(`${selecteur} {`);
      expect(debut, `règle absente : ${selecteur}`).toBeGreaterThan(-1);
      return css.slice(debut, css.indexOf('}', debut));
    };
    const page = bloc(
      'body:has(> [data-bandeau-impersonation]):has(> [data-cadre-app])',
    );
    for (const d of [
      'display: flex;',
      'flex-direction: column;',
      'height: 100vh;',
      'height: 100dvh;',
    ]) {
      expect(page).toContain(d);
    }
    const cadre = bloc(
      'body:has(> [data-bandeau-impersonation]) > [data-cadre-app]',
    );
    for (const d of ['flex: 1 1 0%;', 'min-height: 0;', 'height: auto;']) {
      expect(cadre).toContain(d);
    }
  });
});
