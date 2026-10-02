import * as React from 'react';
export default React.forwardRef<HTMLAnchorElement, any>(function Link(
  { href, children, ...rest },
  ref,
) {
  return (
    <a ref={ref} href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  );
});
