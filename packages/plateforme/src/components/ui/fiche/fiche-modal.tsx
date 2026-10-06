'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';

// Shell des fiches en pop-up (R-UI-5, G3) — cadre commun des fiches collecte
// (Admin et clientes, via FicheCollecteModalCadre) et des fiches Admin
// transporteur, lieu et association (décisions Val 2026-09-30 / 2026-10-01).
//
//   <FicheModal>                 cadre : modale large, hauteur fixe dès md (la
//     <FicheEnTete … />          modale ne bouge pas d'un onglet à l'autre),
//     <FicheCorps>               titre réservé aux lecteurs d'écran (le grand
//       <Tabs>…</Tabs>           en-tête visuel est dans le corps) ;
//     </FicheCorps>              corps : seule zone qui défile ;
//     <FichePied>…</FichePied>   pied fixe ;
//   </FicheModal>                blocs : SectionHeader / InfoItem.
//
// Le pied est soit la prop `footer` de la Modal (lieu, association), soit un
// FichePied placé après le corps quand la fiche le porte elle-même (dans son
// <form> : transporteur ; dans son panneau : fiches collecte).
export function FicheModal({
  open,
  title,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  /** Titre accessible du dialogue (masqué à l'écran). */
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={footer}
      hideTitle
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
      className="max-w-5xl md:h-[min(90vh,48rem)]"
    >
      {children}
    </Modal>
  );
}

// Corps défilant d'une fiche, sous le grand en-tête fixe. `className` surcharge
// le padding (ex. `py-6` d'un état chargement / erreur).
export function FicheCorps({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto px-6 py-4 md:px-8',
        className,
      )}
      {...props}
    />
  );
}

// Pied d'actions d'une fiche qui le porte elle-même (dans son <form> ou son
// panneau) plutôt que via `footer` : fixe sous le corps, actions à droite,
// mêmes marges horizontales que l'en-tête et le corps.
export function FichePied({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <footer
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-savr-neutral-200 px-6 py-4 md:px-8',
        className,
      )}
      {...props}
    />
  );
}
