import type { LucideIcon } from 'lucide-react';
import { TabsTrigger } from '@/components/ui/tabs';
import { typeCollecteLabel } from '@/components/collecte/fiche-collecte-modal-cadre';
import { cn } from '@/lib/utils';

// Briques de mise en page des fiches en pop-up : en-tête de bloc et champs
// label/valeur, grand en-tête (fiches collecte Admin et client, fiches Admin
// transporteur, lieu, association), badge de type de collecte et onglets à
// compteur d'erreurs.

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

// En-tête des fiches Admin en pop-up (transporteur, lieu, association — décision
// Val 2026-09-30 « grand en-tête partout ») et fiches collecte (Admin et client,
// décision Val 2026-10-01) : sur-titre (puce + mention), nom en grand, ligne
// d'infos à pictos, statut à droite. Il décrit l'objet ENREGISTRÉ (stable
// pendant la saisie). À placer dans une modale `hideTitle` : le titre
// accessible reste celui de la modale. pr-14 réserve la croix de fermeture.
export function FicheEnTete({
  surtitre,
  titre,
  description,
  infos = [],
  infosTestId,
  statut,
  statutLarge = false,
}: {
  surtitre?: React.ReactNode;
  titre: string;
  /** Consigne courte (création). */
  description?: string;
  infos?: { icon: LucideIcon; texte: React.ReactNode }[];
  infosTestId?: string;
  statut?: React.ReactNode;
  /** Statut large (frise des fiches collecte) : à droite sur grand écran
   *  seulement, sous le titre en dessous — sinon il écraserait le titre. */
  statutLarge?: boolean;
}) {
  return (
    <header className="shrink-0 border-b border-savr-neutral-200 px-6 pb-5 pr-14 pt-6 md:px-8 md:pr-16">
      <div
        className={
          statutLarge
            ? 'flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'
            : 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'
        }
      >
        <div className="min-w-0 space-y-1.5">
          {surtitre && (
            <div className="flex flex-wrap items-center gap-2">{surtitre}</div>
          )}
          <h3 className="text-2xl font-extrabold leading-tight tracking-[-0.02em] text-savr-neutral-900">
            {titre}
          </h3>
          {description && (
            <p className="text-[15px] text-savr-neutral-700">{description}</p>
          )}
          {infos.length > 0 && (
            <p
              data-testid={infosTestId}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-savr-neutral-700"
            >
              {infos.map(({ icon: Icon, texte }, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {texte}
                </span>
              ))}
            </p>
          )}
        </div>
        {statut && <div className="self-start">{statut}</div>}
      </div>
    </header>
  );
}

// Puce du sur-titre (type de TMS, région…).
export function EnTetePuce({
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className="rounded-savr-sm bg-savr-primary-50 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.04em] text-savr-primary-700"
    >
      {children}
    </span>
  );
}

// Badge de type du sur-titre des fiches collecte (§06.04 Q2, remplace le cadre
// orange/vert) : ZD navy primary-700 texte blanc / AG orange accent-500 texte
// primary-950 — aligné DS dataviz-1/2.
export function BadgeTypeCollecte({ type }: { type: string }) {
  const ag = type === 'anti_gaspi';
  return (
    <span
      data-testid="badge-type-collecte"
      className={cn(
        'rounded-savr-sm px-2 py-0.5 text-xs font-bold uppercase tracking-[0.04em]',
        ag
          ? 'bg-savr-accent-500 text-savr-primary-950'
          : 'bg-savr-primary-700 text-savr-white',
      )}
    >
      {typeCollecteLabel(type)}
    </span>
  );
}

// Mention discrète du sur-titre (SIREN, gestionnaire…).
export function EnTeteMention({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] text-savr-neutral-500">{children}</span>;
}

// Onglet horizontal des fiches Admin (transporteur, lieu, association) portant le nombre de
// ses champs qui bloquent l'enregistrement : pastille rouge + nom accessible
// « … (N champs à corriger) ». `ref` sert à y poser le focus à l'échec.
export function OngletAvecErreurs({
  value,
  nbErreurs,
  children,
  ref,
}: {
  value: string;
  nbErreurs: number;
  children: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <TabsTrigger ref={ref} value={value} className="gap-2 px-3 sm:px-4">
      {children}
      {nbErreurs > 0 && (
        <>
          <span
            aria-hidden="true"
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-savr-error-strong px-1.5 text-xs font-bold text-savr-white"
          >
            {nbErreurs}
          </span>
          <span className="sr-only">
            {nbErreurs > 1
              ? ` (${nbErreurs} champs à corriger)`
              : ' (1 champ à corriger)'}
          </span>
        </>
      )}
    </TabsTrigger>
  );
}

// Action destructive en contour rouge sur un bouton `secondary` : « Annuler la
// collecte » (pop-up collecte client), « Désactiver » des fiches Admin
// (transporteur, association) — même rendu partout (décision Val 2026-09-30).
export const ACTION_DESTRUCTIVE_CONTOUR =
  'border-savr-error text-savr-error-strong hover:bg-savr-error-subtle active:bg-savr-error-subtle';
