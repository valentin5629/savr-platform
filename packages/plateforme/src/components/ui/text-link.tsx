import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// TextLink — lien texte de l'app (R-UI-3, B2). Une seule recette, celle des
// écrans d'authentification (arbitrage Val 2026-09-28, ex-`authLienClass`) et
// de `Button variant="link"` : navy `primary-700`, souligné au survol
// (`underline-offset-4`). La taille hérite du contexte (`text-xs`/`text-sm` par
// `className` si besoin). Trois rendus : `href` interne → `next/link`, `href`
// externe ou téléchargement → `<a>`, `onClick` seul → `<button type="button">`.
const CLASSES =
  'inline-flex items-center gap-1 text-savr-primary-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500';

type Base = {
  className?: string;
  children: React.ReactNode;
  /** Graisse semi-grasse (écrans d'authentification, liens d'action). */
  strong?: boolean;
  /** Zone tactile 44 px (DS §10) sans décaler la mise en page (`-my-3` compense `py-3`). */
  touch?: boolean;
};
type AsLink = Base &
  Omit<React.ComponentProps<typeof Link>, 'className' | 'children'> & {
    href: string;
    external?: false;
  };
type AsAnchor = Base &
  Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    'className' | 'children'
  > & {
    href: string;
    /** `<a>` natif (fichier, nouvel onglet, route API). */
    external: true;
  };
type AsButton = Base &
  Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'className' | 'children'
  > & {
    href?: undefined;
    external?: undefined;
  };
export type TextLinkProps = AsLink | AsAnchor | AsButton;

export function TextLink(props: TextLinkProps): React.ReactElement {
  const cls = cn(
    CLASSES,
    props.strong && 'font-semibold',
    props.touch && '-my-3 py-3',
    props.className,
  );
  if (props.external === true) {
    const { className, children, strong, touch, external, ...a } = props;
    void [className, strong, touch, external];
    // Nouvel onglet : jamais sans `rel` (revue sécurité R-UI-3).
    const rel =
      a.target === '_blank' ? (a.rel ?? 'noopener noreferrer') : a.rel;
    return (
      <a className={cls} {...a} rel={rel}>
        {children}
      </a>
    );
  }
  if (props.href !== undefined) {
    const { className, children, strong, touch, external, ...l } = props;
    void [className, strong, touch, external];
    return (
      <Link className={cls} {...l}>
        {children}
      </Link>
    );
  }
  const { className, children, strong, touch, href, external, type, ...b } =
    props;
  void [className, strong, touch, href, external];
  return (
    <button type={type ?? 'button'} className={cls} {...b}>
      {children}
    </button>
  );
}
