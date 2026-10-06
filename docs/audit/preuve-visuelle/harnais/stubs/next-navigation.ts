export const useRouter = () => ({
  push() {},
  replace() {},
  back() {},
  refresh() {},
  prefetch() {},
});
// Une entrée peut fixer le chemin courant (ex. item actif de la Sidebar).
export const usePathname = (): string =>
  (globalThis as { __PV_PATHNAME?: string }).__PV_PATHNAME ?? '/';
export const useSearchParams = () => new URLSearchParams();
export const redirect = () => {};
