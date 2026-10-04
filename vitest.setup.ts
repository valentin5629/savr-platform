import '@testing-library/jest-dom';

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

// Node ≥ 25 expose un `localStorage` global qui, sans `--localstorage-file`
// valide, ne porte AUCUNE méthode — et masque celui de jsdom. Un test qui appelle
// `localStorage.clear()` passe alors en CI (Node 20) et casse en local, où il
// bloque le garde-fou pré-commit. Storage en mémoire, posé seulement dans ce cas.
if (
  typeof window !== 'undefined' &&
  typeof globalThis.localStorage?.clear !== 'function'
) {
  const donnees = new Map<string, string>();
  const memoire: Storage = {
    get length() {
      return donnees.size;
    },
    clear: () => donnees.clear(),
    getItem: (cle) => donnees.get(cle) ?? null,
    key: (i) => [...donnees.keys()][i] ?? null,
    removeItem: (cle) => void donnees.delete(cle),
    setItem: (cle, valeur) => void donnees.set(cle, String(valeur)),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoire,
    configurable: true,
    writable: true,
  });
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
