import { screen } from '@testing-library/react';
import { ATTENTE_UI } from '@/test-utils/attente-ui';

/**
 * Attend un message de retour (confirmation `role="status"`, erreur
 * `role="alert"`) SANS `findByRole`.
 *
 * POURQUOI — `findByRole` recalcule le rôle ARIA de chaque élément du document
 * à chaque tentative (toutes les 50 ms) : c'est la requête la plus coûteuse de
 * Testing Library dans jsdom. Sur la CI (4 cœurs partagés, tous les fichiers en
 * parallèle), une page un peu dense (formulaire + Data Tables) a dépassé le
 * budget ATTENTE_UI (4 s) alors que le message était bien rendu — échecs
 * intermittents de `mon-organisation-gestionnaire` et `infos-legales-organisation`,
 * y compris sur `main` (2026-09-28), jamais reproduits en local (~50 ms).
 *
 * On attend donc le TEXTE (requête bon marché), puis on vérifie qu'il est porté
 * par un élément du rôle attendu : l'oracle (bon message, bon rôle a11y) est
 * inchangé, seul le coût de l'attente baisse.
 */
export async function messageDeRole(
  role: 'status' | 'alert',
  texte: string | RegExp,
): Promise<HTMLElement> {
  const el = await screen.findByText(texte, undefined, ATTENTE_UI);
  const porteur = el.closest(`[role="${role}"]`);
  if (!porteur) {
    throw new Error(
      `« ${el.textContent ?? ''} » est affiché, mais pas dans un élément role="${role}".`,
    );
  }
  return porteur as HTMLElement;
}
