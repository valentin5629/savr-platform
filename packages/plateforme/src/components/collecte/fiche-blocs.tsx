import type { LucideIcon } from 'lucide-react';

// Briques de mise en page des fiches collecte en pop-up (Admin + traiteur) :
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
