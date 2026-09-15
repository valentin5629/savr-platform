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

/**
 * Budget d'horloge d'un CAS de test (3e argument de `it`) qui contient au moins
 * une attente `ATTENTE_UI`.
 *
 * POURQUOI — `ATTENTE_UI` ne borne que le temps passé À ATTENDRE le DOM. Le
 * reste du cas (rendu initial, re-rendu après une interaction, montage des
 * sous-composants) est du travail synchrone que rien ne protège, et il compte
 * dans le `testTimeout` de Vitest — 5 000 ms par défaut. Un cas qui enchaîne
 * une attente et un clic coûteux voit donc son budget d'attente EXPLICITE
 * tronqué par le plafond : il meurt en « Test timed out in 5000ms » avant
 * d'avoir dépensé ses 4 000 ms (constaté le 2026-09-15 sur le cas « Escape NE
 * ferme PAS le panneau… » de collecte-detail-modal : ~470 ms à vide, rouge à
 * ~6,8 s quand la suite complète sature les 10 cœurs).
 *
 * Valeur : 3 × `ATTENTE_UI_MS`. Un cas ne chaîne jamais plus de deux attentes ;
 * le 3e budget couvre le travail synchrone entre elles. Relever le plafond du
 * CAS ne relâche rien sur la détection de régression : c'est toujours
 * `ATTENTE_UI` (4 000 ms) qui expire en premier sur une vraie régression, avec
 * le message utile de Testing Library.
 *
 * À passer en 3e argument de `it`, jamais en `testTimeout` global : la lenteur
 * doit rester visible cas par cas.
 */
export const ATTENTE_CAS_MS = 3 * ATTENTE_UI_MS;
