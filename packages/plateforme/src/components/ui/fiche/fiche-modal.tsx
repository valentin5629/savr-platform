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
  taille = 'standard',
  children,
}: {
  open: boolean;
  /** Titre accessible du dialogue (masqué à l'écran). */
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  /** `grand` : fiche collecte client (variante B, décision Val 2026-10-27) —
   *  1 200 px de large, angles de 20 px, croix ronde sur fond sable. */
  taille?: 'standard' | 'grand';
  children: React.ReactNode;
}) {
  const grand = taille === 'grand';
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={footer}
      hideTitle
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
      className={
        grand
          ? // Téléphone (B4) : feuille montée du bas, angles hauts seuls.
            'max-h-[94vh] max-w-[75rem] rounded-savr-2xl shadow-savr-xl max-sm:h-full max-sm:max-h-none max-sm:rounded-b-none md:h-[min(94vh,57.5rem)]'
          : 'max-w-5xl md:h-[min(90vh,48rem)]'
      }
      overlayClassName={
        grand ? 'max-sm:items-end max-sm:p-0 max-sm:pt-10' : undefined
      }
      fermetureClassName={
        grand
          ? 'right-5 top-5 h-11 w-11 rounded-savr-full bg-savr-sable-100 text-savr-neutral-700 hover:bg-savr-sable-200 hover:text-savr-neutral-900 md:right-8 md:top-6'
          : undefined
      }
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
