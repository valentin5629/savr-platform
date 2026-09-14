/**
 * Budget d'attente explicite des utilitaires asynchrones @testing-library
 * (`findBy*`, `findAllBy*`, `waitFor`) dans les tests de rendu.
 *
 * POURQUOI — le défaut `asyncUtilTimeout` de Testing Library est de 1 000 ms.
 * C'est un budget en temps d'HORLOGE, alors que ce qu'on attend (effets React +
 * résolution des mocks + re-rendus) est du travail CPU. `vitest run` exécute les
 * fichiers en parallèle sur tous les cœurs : quand la machine est chargée (CI
 * partagée, agents concurrents), un cas qui prend ~300 ms à vide dépasse la
 * seconde et l'attente expire AVANT que le DOM ne se stabilise — échec
 * intermittent, sans aucune régression de code (constaté le 2026-09-14 :
 * `test:unit` à 114 s au lieu de ~31 s, cas « Bloc 5 top 3 » de
 * collecte-detail-panel tombé à 1 695 ms).
 *
 * Passer ce budget EXPLICITEMENT à chaque attente, plutôt que relever le
 * `testTimeout` global de Vitest : la lenteur reste visible (les cas restent
 * plafonnés par le détecteur de blocage à 5 000 ms de Vitest) et c'est bien
 * l'attente du DOM — pas le test — qui reçoit de la marge.
 *
 * Valeur choisie : 4 000 ms. Assez pour absorber une machine 4× surchargée,
 * assez court pour qu'une VRAIE régression échoue à l'intérieur du plafond
 * Vitest (5 000 ms) et rende le message utile de Testing Library (« Unable to
 * find an element… » + dump du DOM) plutôt qu'un « Test timed out ».
 *
 * L'oubli est bloqué mécaniquement : règle ESLint `no-restricted-syntax` sur
 * les `findBy*` / `waitFor` sans options d'attente (voir eslint.config.js).
 */
export const ATTENTE_UI_MS = 4_000;

export const ATTENTE_UI = { timeout: ATTENTE_UI_MS } as const;
