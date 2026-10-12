import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ── `after()` de next/server ─────────────────────────────────────────────────
// `after()` lève hors d'une requête Next (« called outside a request scope »),
// or les tests appellent les handlers de route directement. On la remplace par un
// espion qui N'EXÉCUTE PAS la tâche : un test de route ne déclenche donc jamais
// l'envoi d'un ordre au prestataire (lib/envoi-immediat.ts). Le test qui veut la
// tâche la prend dans `vi.mocked(after).mock.calls` et l'appelle lui-même.
//
// Le chemin passe par le paquet plateforme : `next` n'est pas une dépendance de
// la racine, donc `vi.mock('next/server')` écrit ici viserait un module
// introuvable et ne remplacerait rien (mesuré : la vraie `after()` répondait).
vi.mock(
  './packages/plateforme/node_modules/next/server.js',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    after: vi.fn(),
  }),
);

// ── Polyfills jsdom pour les primitives Radix (R23a Design System) ───────────
// jsdom n'implémente ni ResizeObserver, ni matchMedia, ni l'API PointerCapture,
// ni scrollIntoView — dont dépendent les composants Radix Popper (Tooltip,
// Dropdown) et les menus. On les stubbe (no-op) uniquement en test.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  const proto = window.HTMLElement.prototype;
  if (typeof proto.hasPointerCapture !== 'function')
    proto.hasPointerCapture = () => false;
  if (typeof proto.setPointerCapture !== 'function')
    proto.setPointerCapture = () => {};
  if (typeof proto.releasePointerCapture !== 'function')
    proto.releasePointerCapture = () => {};
  if (typeof proto.scrollIntoView !== 'function')
    proto.scrollIntoView = () => {};
}
