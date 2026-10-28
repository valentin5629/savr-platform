import * as React from 'react';

// Section en ligne des fiches variante B (décision Val 2026-10-27) : libellé à
// gauche, contenu à droite, filets sable entre les sections. `action` : badge
// ou bouton posé sous le libellé (ex. « Modifié pour cette collecte »).
// Ex-`SectionInfos` de la fiche collecte client, reprise par toutes les fiches.
export function FicheSection({
  titre,
  action,
  children,
  ...props
}: {
  titre: string;
  action?: React.ReactNode;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  const libelle = (
    <h4 className="font-display text-md font-semibold tracking-[-0.01em] text-savr-neutral-900">
      {titre}
    </h4>
  );
  return (
    <section
      className="grid gap-x-10 gap-y-4 border-t border-savr-sable-200 py-6 first:border-t-0 first:pt-0 sm:py-7 md:grid-cols-[13rem_minmax(0,1fr)]"
      {...props}
    >
      {action ? (
        <div className="flex flex-wrap items-start gap-3 md:flex-col">
          {libelle}
          {action}
        </div>
      ) : (
        libelle
      )}
      {children}
    </section>
  );
}
