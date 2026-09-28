/**
 * Page /cgu — publication du texte accepté à l'inscription.
 *
 * Pourquoi cette page existe : l'inscription fait cocher « j'accepte les CGU » et
 * horodate cette acceptation comme preuve opposable (`users.cgu_accepte_le` /
 * `cgu_version`). Tant que le texte n'était publié nulle part, on demandait
 * d'accepter un document que personne ne pouvait lire.
 *
 * Ce que ces tests garantissent : le texte publié est bien CELUI du CDC (aucun
 * article ne manque, aucune dérive silencieuse si le CDC est re-synchronisé),
 * la section de travail « Notes pour révision juridique » n'est PAS publiée au
 * Client, et la version affichée est exactement celle écrite en base.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import CguPage from '@/app/cgu/page.js';
import { CGU_TEXTE_VERSION } from '@/content/cgu-v1';
import { CGU_VERSION_COURANTE } from '@/lib/cgu';

const SOURCE_CDC = join(
  process.cwd(),
  'specs/cdc/01 - Cahier des charges App/CGU Savr V1 - Draft.md',
);

/** Titres de section du CDC, moins la section de travail interne. */
function titresDuCdc(): string[] {
  const lignes = readFileSync(SOURCE_CDC, 'utf8').split('\n');
  return lignes
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).trim())
    .filter((t) => !t.toLowerCase().startsWith('notes pour révision'));
}

afterEach(cleanup);

describe('M0.4 — /cgu : le texte publié est celui du CDC', () => {
  it('rend les 27 articles, le préambule et les annexes', () => {
    const { container } = render(<CguPage />);
    const titres = titresDuCdc();

    // Garde de non-vacuité : si l'extraction ne trouvait rien, la boucle
    // ci-dessous n'assertrait rien du tout.
    expect(titres.length).toBe(29);
    expect(titres.filter((t) => t.startsWith('ARTICLE ')).length).toBe(27);

    for (const titre of titres) {
      expect(container.textContent, titre).toContain(titre);
    }
  });

  it('ne publie PAS la section « Notes pour révision juridique »', () => {
    const { container } = render(<CguPage />);
    expect(container.textContent).not.toContain('Notes pour révision');
    // Une phrase caractéristique de cette section, adressée au juriste :
    expect(container.textContent).not.toContain(
      'à valider impérativement avec un juriste',
    );
  });

  it('affiche exactement la version qui sera écrite dans users.cgu_version', () => {
    const { container } = render(<CguPage />);
    expect(CGU_TEXTE_VERSION).toBe(CGU_VERSION_COURANTE);
    expect(container.textContent).toContain(`Version ${CGU_VERSION_COURANTE}`);
  });

  it("reprend le texte de l'article qui fonde la preuve d'acceptation (Art. 22)", () => {
    const { container } = render(<CguPage />);
    const source = readFileSync(SOURCE_CDC, 'utf8');
    const apres22 = source.split('## ARTICLE 22')[1];
    expect(apres22).toBeDefined();
    const art22 = apres22!
      .split('## ARTICLE 23')[0]!
      .split('\n')
      .slice(1) // reste de la ligne de titre (« — CONVENTION SUR LA PREUVE »)
      .map((l) => l.trim())
      .filter((l) => l !== '' && l !== '---');

    expect(art22.length).toBeGreaterThan(0);
    for (const ligne of art22) {
      // Le gras markdown est rendu en <strong> : on compare le texte nu.
      expect(container.textContent).toContain(ligne.replaceAll('**', ''));
    }
  });
});
