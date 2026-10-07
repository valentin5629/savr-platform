/* global window */
// Runtime JSX automatique rabattu sur React.createElement du React global.
// `jsxs` (enfants statiques) les passe en arguments : React ne réclame alors
// pas de `key`, comme avec le vrai runtime automatique.
const R = window.React;
export const Fragment = R.Fragment;
function props(p, key) {
  const { children, ...rest } = p;
  return [key === undefined ? rest : { ...rest, key }, children];
}
export function jsx(type, p, key) {
  const [rest, children] = props(p, key);
  return children === undefined
    ? R.createElement(type, rest)
    : R.createElement(type, rest, children);
}
export function jsxs(type, p, key) {
  const [rest, children] = props(p, key);
  return Array.isArray(children)
    ? R.createElement(type, rest, ...children)
    : R.createElement(type, rest, children);
}
export const jsxDEV = jsx;
