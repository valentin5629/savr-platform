import type { LucideIcon } from 'lucide-react';
import { TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';

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
        <Heading
          level={2}
          size="base"
          weight="extrabold"
          className="truncate tracking-[-0.01em]"
        >
          {title}
        </Heading>
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
        <TextLink
          href={`tel:${telephone.replace(/\s/g, '')}`}
          external
          className="block"
        >
          {telephone}
        </TextLink>
      )}
    </>
  );
}

// Téléphone seul, cliquable (appel direct depuis mobile) ; « — » si absent.
export function TelephoneLien({ telephone }: { telephone?: string | null }) {
  const tel = telephone?.trim();
  if (!tel) return <span className="text-savr-neutral-400">—</span>;
  return (
    <TextLink href={`tel:${tel.replace(/\s/g, '')}`} external>
      {tel}
    </TextLink>
  );
}

// En-tête des fiches Admin en pop-up (transporteur, lieu, association — décision
// Val 2026-09-30 « grand en-tête partout ») et fiches collecte (Admin et client,
// décision Val 2026-10-01) : sur-titre (puce + mention), nom en grand, ligne
// d'infos à pictos, statut à droite du sur-titre. Il décrit l'objet ENREGISTRÉ (stable
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
  /** Statut large (frise des fiches collecte) : à droite du sur-titre sur
   *  grand écran seulement, sous les infos en dessous. */
  statutLarge?: boolean;
}) {
  return (
    <header className="shrink-0 border-b border-savr-neutral-200 px-6 pb-5 pr-14 pt-6 md:px-8 md:pr-16">
      {/* Le statut occupe la droite de la première ligne (celle du sur-titre,
          ou du titre s'il n'y a pas de sur-titre) ; titre et infos gardent
          toute la largeur — une frise ne les écrase pas. Sous le point de
          bascule : une seule colonne, statut en dernier (ordre du DOM). */}
      <div
        className={cn(
          'grid items-center gap-x-6 gap-y-1.5',
          statutLarge
            ? 'lg:grid-cols-[minmax(0,1fr)_auto]'
            : 'sm:grid-cols-[minmax(0,1fr)_auto]',
        )}
      >
        {surtitre && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {surtitre}
          </div>
        )}
        <h3
          className={cn(
            'text-2xl font-extrabold leading-tight tracking-[-0.02em] text-savr-neutral-900',
            (surtitre || !statut) && 'col-span-full',
          )}
        >
          {titre}
        </h3>
        {description && (
          <p className="col-span-full text-[15px] text-savr-neutral-700">
            {description}
          </p>
        )}
        {infos.length > 0 && (
          <p
            data-testid={infosTestId}
            className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-savr-neutral-700"
          >
            {infos.map(({ icon: Icon, texte }, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {texte}
              </span>
            ))}
          </p>
        )}
        {statut && (
          <div
            className={cn(
              'mt-1.5 min-w-0',
              !surtitre && 'self-start',
              statutLarge
                ? 'lg:col-start-2 lg:row-start-1 lg:mt-0 lg:justify-self-end'
                : 'sm:col-start-2 sm:row-start-1 sm:mt-0 sm:justify-self-end',
            )}
          >
            {statut}
          </div>
        )}
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

// Libellé d'affichage du type de collecte (UX — la DB garde l'enum).
export function typeCollecteLabel(type: string): string {
  return type === 'zero_dechet' ? 'Zéro Déchet' : 'Anti-Gaspi';
}

// Date de collecte de l'en-tête des fiches : « Samedi 26 septembre 2026 ».
export function dateLongueCapitalisee(dateIso: string): string {
  const d = new Date(dateIso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });
  return d.charAt(0).toUpperCase() + d.slice(1);
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
  return (
    <Text as="span" size="xs-plus">
      {children}
    </Text>
  );
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
