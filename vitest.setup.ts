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
