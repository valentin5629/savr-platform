/* global URLSearchParams */
// next/navigation hors Next.js : routeur inerte pour les aperçus.
export const usePathname = () => '/';
export const useRouter = () => ({
  push() {},
  replace() {},
  back() {},
  refresh() {},
  prefetch() {},
});
export const useSearchParams = () => new URLSearchParams();
export const redirect = () => {};
export const notFound = () => {};
