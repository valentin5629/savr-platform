// next/link hors Next.js : un <a> ordinaire (les aperçus ne naviguent pas).
import * as React from 'react';
const PROPS_NEXT = [
  'prefetch',
  'replace',
  'scroll',
  'shallow',
  'locale',
  'legacyBehavior',
];
const Link = React.forwardRef(function Link(props, ref) {
  const { href, children, ...rest } = props;
  for (const k of PROPS_NEXT) delete rest[k];
  const h = typeof href === 'string' ? href : (href && href.pathname) || '#';
  return React.createElement('a', { href: h, ref, ...rest }, children);
});
export default Link;
