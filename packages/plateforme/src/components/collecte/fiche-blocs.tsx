import type { LucideIcon } from 'lucide-react';

// Briques de mise en page des fiches en pop-up (collecte Admin + clients, transporteur) :
// même en-tête de bloc, même colonne résumé, mêmes champs label/valeur.

// En-tête de bloc — DS §10 leviers #2 (pastille primary pleine) + #7 (titre
// extrabold tracking serré) : pastille icône `primary-50`, titre `neutral-900`,
// slot d'action optionnel à droite.
export function BlocHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-savr-md bg-savr-primary-50 text-savr-primary-700">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <h2 className="truncate text-base font-extrabold tracking-[-0.01em] text-savr-neutral-900">
          {title}
        </h2>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// Colonne résumé (gauche) — libellé discret + valeur.
export function ResumeItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-savr-neutral-500">{label}</dt>
      <dd className="font-medium text-savr-neutral-900">{children}</dd>
    </div>
  );
}

// Champ d'un bloc (grille label/valeur).
export function InfoItem({
  label,
  pleineLargeur = false,
  children,
}: {
  label: string;
  pleineLargeur?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={pleineLargeur ? 'sm:col-span-2' : undefined}>
      <dt className="text-savr-neutral-500">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

// Contact nom + téléphone cliquable (appel direct depuis mobile).
export function ContactLigne({
  nom,
  telephone,
}: {
  nom?: string | null;
  telephone?: string | null;
}) {
  if (!nom && !telephone) {
    return <span className="text-savr-neutral-400">Non renseigné</span>;
  }
  return (
    <>
      {nom ?? '—'}
      {telephone && (
        <a
          href={`tel:${telephone.replace(/\s/g, '')}`}
          className="block text-savr-primary-600 hover:underline"
        >
          {telephone}
        </a>
      )}
    </>
  );
}

// Téléphone seul, cliquable (appel direct depuis mobile) ; « — » si absent.
export function TelephoneLien({ telephone }: { telephone?: string | null }) {
  const tel = telephone?.trim();
  if (!tel) return <span className="text-savr-neutral-400">—</span>;
  return (
    <a
      href={`tel:${tel.replace(/\s/g, '')}`}
      className="text-savr-primary-600 hover:underline"
    >
      {tel}
    </a>
  );
}

// Onglets en colonne des fiches en pop-up (fiche collecte client, fiche
// transporteur Admin) : colonne à gauche sur fond neutral-50, barre horizontale
// défilante sous md. Onglet actif = fond blanc + contour (pas d'aplat navy) —
// maquette validée.
export const ONGLETS_COLONNE_LISTE =
  'flex shrink-0 gap-1 overflow-x-auto border-b border-savr-neutral-200 bg-savr-neutral-50 px-4 py-2 md:w-56 md:flex-col md:items-stretch md:overflow-visible md:border-b-0 md:border-r md:px-4 md:py-5';

export const ONGLETS_COLONNE_DECLENCHEUR =
  'h-11 shrink-0 justify-start rounded-savr-md border-b-0 px-3 text-[15px] font-normal text-savr-neutral-700 hover:bg-savr-white hover:text-savr-neutral-900 data-[state=active]:bg-savr-white data-[state=active]:font-bold data-[state=active]:text-savr-primary-700 data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-savr-neutral-200 md:w-full';
