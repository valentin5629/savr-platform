'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { AlertBar } from '@/components/ui/alert-bar';
import {
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  CalendarPlusIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  IdentificationCardIcon,
  MapPinIcon,
  PencilSimpleIcon,
  PhoneIcon,
  PlusCircleIcon,
  WarningIcon,
  XIcon,
} from '@/components/ui/icones';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { Heading } from '@/components/ui/heading';
import { Text, textClasses } from '@/components/ui/text';
import { InfoItem } from '@/components/ui/info-item';
import { TelephoneLien } from '@/components/collecte/fiche-blocs';
import { TELEPHONE_SAVR } from '@/components/programmation/carte-collecte';
import { AnnulationCollecteDialog } from '@/components/collecte/annulation-collecte-dialog';
import { ESPACES, ESPACE_PAR_ROLE, ROUTES } from '@/lib/routes';
import { isStaff, type Role } from '@/lib/roles';
import { useUserRole } from '@/lib/use-user-role';
import { normaliserTypeCollecte } from '@/lib/libelles/type-collecte';
import {
  estZeroDechet,
  numeroterCollectes,
} from '@/lib/programmation/numerotation';
import { STATUTS_ANNULES } from '@/lib/collectes/fiche-client-types';
import { cn } from '@/lib/utils';
import type { EtatRecapEmail } from '@/lib/programmation/suivi-recap-email';

// Page de confirmation de la programmation (§06.01, actions post-confirmation,
// point 13 ; refonte du formulaire, lot B2, décisions Val 2026-10-22) :
// en-tête, récapitulatif de l'événement, une carte par collecte avec
// « Modifier » et « Annuler la collecte », puis les actions du bas de page et
// le rappel de l'email récapitulatif. Mise en page en deux colonnes et textes
// de la maquette v2 validée par Val le 2026-10-26 (fiche de divergence M1.2).

// Valeur du récapitulatif : texte courant neutral-900.
const VALEUR_RECAP = textClasses({ tone: 'ink' });

type ContactsCollecte = {
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
};

type CollecteRecap = {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  heure_collecte: string | null;
  // Pax de la collecte (décision Val 2026-10-20).
  pax: number | null;
  // Type d'événement (libellé) et contacts de CETTE collecte (lot B2).
  type_evenement?: string | null;
  contacts?: ContactsCollecte | null;
  informations_supplementaires?: string | null;
  created_at?: string | null;
};

type LieuRecap = {
  nom: string | null;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
};

type EvenementRecap = {
  id: string;
  nom_evenement: string;
  nom_client_organisateur: string | null;
  // « Référence interne » à l'écran (§06.01 étape 1).
  reference_affaire?: string | null;
  // Traiteur opérant et organisation programmatrice (nom d'affichage seul).
  traiteur_operationnel?: { id: string; nom: string } | null;
  organisation?: { id: string; nom: string } | null;
  // Requis dès qu'une collecte de l'événement l'exige (calculé par la route).
  controle_acces_requis?: boolean;
  // Relation to-one : PostgREST renvoie un objet, on tolère le tableau par sûreté.
  lieux: LieuRecap | LieuRecap[] | null;
  collectes: CollecteRecap[];
  // État réel de l'email récapitulatif, lu dans l'historique des envois. Absent
  // ou `null` = inconnu : l'écran n'affirme alors rien.
  email_recap?: EtatRecapEmail | null;
};

// Rappel de l'email récapitulatif (§06.01 étape 13) : on ne dit « envoyé » que
// si l'email est réellement parti (décision Val 2026-10-08).
const MESSAGES_EMAIL_RECAP: Record<EtatRecapEmail, string> = {
  envoye: 'Un email récapitulatif vient de vous être envoyé.',
  en_reprise:
    'L’email récapitulatif n’a pas pu partir pour l’instant. Nous le renvoyons automatiquement.',
  non_envoye:
    'L’email récapitulatif n’a pas pu vous être envoyé. Votre programmation est bien enregistrée : vous la retrouvez dans vos collectes. Pour toute question, écrivez-nous à contact@gosavr.io.',
};

// Statuts qui gardent « Modifier » et « Annuler la collecte », comme le pied de
// la fiche collecte cliente (`droitsFiche`, lib/collectes/fiche-client.ts) et
// les routes d'annulation : annulation directe en brouillon ou programmée,
// demande d'annulation (validée par l'Admin) en validée ; modification en
// programmée ou validée.
const STATUTS_ANNULABLES = ['brouillon', 'programmee', 'validee'];
const STATUTS_MODIFIABLES = ['programmee', 'validee'];

function formatDate(date: string | null): string {
  if (!date) return '—';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  const texte = parsed.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

// `heure_collecte` est une colonne `time` (ex. "14:30:00") — on n'affiche que HH:MM
// (même convention que les listes collectes agence/organisateur).
function formatHeure(heure: string | null): string {
  return heure ? heure.slice(0, 5) : '';
}

function formatDateHeure(c: CollecteRecap): string {
  const heure = formatHeure(c.heure_collecte);
  return `${formatDate(c.date_collecte)}${heure ? ` · ${heure}` : ''}`;
}

function formatLieu(lieux: EvenementRecap['lieux']): string {
  const lieu = Array.isArray(lieux) ? (lieux[0] ?? null) : lieux;
  if (!lieu) return '—';
  const adresse = [
    lieu.adresse_acces,
    [lieu.code_postal, lieu.ville].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return [lieu.nom, adresse].filter(Boolean).join(' — ') || '—';
}

// « Nom · téléphone » sur une ligne ; le téléphone est cliquable.
function Contact({
  nom,
  telephone,
}: {
  nom: string | null | undefined;
  telephone: string | null | undefined;
}) {
  return (
    <>
      {renseigne(nom) ? nom : '—'}
      {renseigne(telephone) && (
        <>
          {' · '}
          <TelephoneLien telephone={telephone} />
        </>
      )}
    </>
  );
}

const renseigne = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim() !== '';

// Collecte comptée dans « Nous réaliserons » et dans le récapitulatif : ni
// annulée ni en demande d'annulation (les deux s'affichent « Annulée » côté
// client, `STATUTS_ANNULES`).
const estActive = (c: CollecteRecap): boolean =>
  !STATUTS_ANNULES.includes(c.statut);

// « Modifier » (décision Val 2026-10-16) : la fiche de la collecte s'ouvre en
// édition dans la liste Collectes de l'espace du rôle, comme le crayon de
// cette liste. Staff : la fiche collecte Admin, éditée bloc par bloc.
function lienModifierCollecte(
  role: string | undefined,
  collecteId: string,
): string | null {
  if (isStaff(role)) return ROUTES.admin.collecte(collecteId);
  const espace = role ? ESPACE_PAR_ROLE[role as Role] : undefined;
  if (espace !== 'traiteur' && espace !== 'agence' && espace !== 'gestionnaire')
    return null;
  return `${ROUTES[espace].collectes}?collecte=${encodeURIComponent(collecteId)}&edit=1`;
}

// « Annuler la collecte » (décision Val 2026-10-22, C6 : règles habituelles).
// Traiteur, agence et gestionnaire de lieux (ses propres programmations,
// décision Val 2026-10-26) : la boîte d'annulation de leurs fiches, sur la
// route de leur espace (directe, ou demande si la collecte est validée). Les
// collectes de cette page sont toujours celles que l'appelant vient de
// programmer ; la route revérifie l'organisation. Staff : la fiche collecte
// Admin, où l'équipe Savr annule.
type ActionAnnulation =
  | { kind: 'boite'; url: string; demande: boolean }
  | { kind: 'lien'; href: string };

function actionAnnulation(
  role: string | undefined,
  c: CollecteRecap,
): ActionAnnulation | null {
  if (!STATUTS_ANNULABLES.includes(c.statut)) return null;
  if (isStaff(role)) return { kind: 'lien', href: ROUTES.admin.collecte(c.id) };
  const espace = role ? ESPACE_PAR_ROLE[role as Role] : undefined;
  if (espace !== 'traiteur' && espace !== 'agence' && espace !== 'gestionnaire')
    return null;
  return {
    kind: 'boite',
    url: `${ESPACES[espace].apiCollectes}/${encodeURIComponent(c.id)}/annulation`,
    demande: c.statut === 'validee',
  };
}

// Ligne libellé / valeur : libellé à gauche dès `sm`, au-dessus sur téléphone.
function Ligne({ label, children }: { label: string; children: ReactNode }) {
  return (
    <InfoItem
      label={label}
      className="grid gap-0.5 py-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4"
      valueClassName={cn(VALEUR_RECAP, 'font-normal')}
    >
      {children}
    </InfoItem>
  );
}

function CarteCollecte({
  collecte: c,
  libelle,
  role,
  onAnnuler,
}: {
  collecte: CollecteRecap;
  libelle: string;
  role: string | undefined;
  onAnnuler: (url: string, demande: boolean) => void;
}) {
  const idTitre = useId();
  const contacts = c.contacts ?? null;
  const avecSecours =
    renseigne(contacts?.contact_secours_nom) ||
    renseigne(contacts?.contact_secours_telephone);
  const lienModifier = STATUTS_MODIFIABLES.includes(c.statut)
    ? lienModifierCollecte(role, c.id)
    : null;
  const annulation = actionAnnulation(role, c);
  const convives = [
    c.pax ?? '—',
    renseigne(c.type_evenement) ? c.type_evenement : null,
  ]
    .filter((v) => v !== null)
    .join(' · ');

  return (
    <Card padding="sm" role="region" aria-labelledby={idTitre}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* Pastille de type : vert Zéro Déchet, orange Anti-Gaspi. */}
          <Heading
            level={3}
            size="inherit"
            tone="inherit"
            id={idTitre}
            className={cn(
              'rounded-savr-full px-2.5 py-0.5 text-xs',
              estZeroDechet(c.type)
                ? 'bg-savr-success-subtle text-savr-success-strong'
                : 'bg-savr-accent-50 text-savr-accent-800',
            )}
          >
            {libelle.replace(/^Collecte /, '')}
          </Heading>
          <dl>
            <div>
              <dt className="sr-only">Date et heure</dt>
              <dd className="text-[15px] font-bold text-savr-neutral-900">
                {formatDateHeure(c)}
              </dd>
            </div>
          </dl>
        </div>
        <CollecteStatutBadge statut={c.statut} />
      </div>
      <dl className="mt-2 text-sm">
        <Ligne label="Convives">{convives}</Ligne>
        <Ligne label="Contact principal">
          <Contact
            nom={contacts?.contact_principal_nom}
            telephone={contacts?.contact_principal_telephone}
          />
        </Ligne>
        {/* Contact de secours facultatif : omis s'il n'est pas renseigné. */}
        {avecSecours && (
          <Ligne label="Contact de secours">
            <Contact
              nom={contacts?.contact_secours_nom}
              telephone={contacts?.contact_secours_telephone}
            />
          </Ligne>
        )}
        {/* Toujours affichées : « Aucune » montre au traiteur qu'il n'a rien
            précisé au transporteur (`informations_supplementaires`, seul
            canal vers lui, §06.01). */}
        <Ligne label="Instructions">
          {renseigne(c.informations_supplementaires) ? (
            <span className="block whitespace-pre-line break-words border-l-[3px] border-savr-primary-300 bg-savr-neutral-50 px-3 py-2">
              {c.informations_supplementaires}
            </span>
          ) : (
            <span className={textClasses({ tone: 'faint' })}>Aucune</span>
          )}
        </Ligne>
      </dl>
      {(lienModifier || annulation) && (
        <div className="mt-2 flex flex-wrap justify-end gap-2 border-t border-savr-neutral-100 pt-2">
          {lienModifier && (
            <Button asChild variant="ghost">
              <Link href={lienModifier}>
                <PencilSimpleIcon />
                Modifier
              </Link>
            </Button>
          )}
          {annulation?.kind === 'lien' && (
            <Button asChild variant="ghost-destructive">
              <Link href={annulation.href}>
                <XIcon />
                Annuler
              </Link>
            </Button>
          )}
          {annulation?.kind === 'boite' && (
            <Button
              variant="ghost-destructive"
              onClick={() => onAnnuler(annulation.url, annulation.demande)}
            >
              <XIcon />
              {/* Collecte validée : une demande, transmise à l'équipe Savr. */}
              {annulation.demande ? 'Demander l’annulation' : 'Annuler'}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

type CibleAnnulation = {
  collecte: CollecteRecap;
  url: string;
  demande: boolean;
};

function ConfirmationContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const role = useUserRole();

  const [evenement, setEvenement] = useState<EvenementRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cible, setCible] = useState<CibleAnnulation | null>(null);
  const [annulEnCours, setAnnulEnCours] = useState(false);
  const [annulErreur, setAnnulErreur] = useState<string | null>(null);

  // Une réponse arrivée après une lecture plus récente (ou après le démontage)
  // n'écrase rien.
  const derniereLecture = useRef(0);

  const charger = useCallback(async (): Promise<void> => {
    const lecture = ++derniereLecture.current;
    const perimee = () => derniereLecture.current !== lecture;
    if (!id || id === 'undefined') {
      setError('Identifiant de l’événement manquant.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/v1/programmation/evenements/${encodeURIComponent(id)}`,
      );
      const data = (await res.json()) as EvenementRecap & { error?: string };
      if (perimee()) return;
      if (!res.ok) {
        setError(data.error ?? 'Événement introuvable.');
        return;
      }
      setError(null);
      setEvenement(data);
    } catch {
      if (!perimee()) setError('Erreur lors du chargement de l’événement.');
    } finally {
      if (!perimee()) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void charger();
    return () => {
      derniereLecture.current++;
    };
  }, [charger]);

  async function confirmerAnnulation(motif: string) {
    if (!cible) return;
    setAnnulEnCours(true);
    setAnnulErreur(null);
    try {
      const res = await fetch(cible.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motif }),
      });
      if (res.ok) {
        setCible(null);
        // Statut de la carte et compte des collectes relus sur l'événement.
        await charger();
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setAnnulErreur(j.error ?? 'L’annulation a échoué.');
      }
    } catch {
      setAnnulErreur('L’annulation a échoué.');
    } finally {
      setAnnulEnCours(false);
    }
  }

  if (loading) {
    return <LoadingState label="Chargement du récapitulatif…" />;
  }

  const collectes = evenement?.collectes ?? [];
  // Numérotation par type (« Collecte Zéro Déchet #1 »), celle de l'email
  // récapitulatif ; les collectes annulées gardent leur numéro.
  const numerotees = numeroterCollectes(collectes);
  const actives = collectes.filter(estActive);
  const titreCollectes =
    actives.length === 0
      ? 'Aucune collecte à réaliser'
      : actives.length === 1
        ? 'Votre collecte'
        : `Vos ${actives.length} collectes`;
  // Traiteur opérant : choisi à l'écran 1 par l'agence, le gestionnaire de
  // lieux ou l'équipe Savr. Quand le traiteur programme pour lui-même, c'est
  // sa propre organisation : la ligne n'apprendrait rien, elle est omise.
  const traiteurOperant =
    evenement?.traiteur_operationnel &&
    evenement.traiteur_operationnel.id !== evenement.organisation?.id &&
    renseigne(evenement.traiteur_operationnel.nom)
      ? evenement.traiteur_operationnel.nom
      : null;
  const etatEmail = evenement?.email_recap ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      {error && (
        <AlertBar variant="err" role="alert" icon={<WarningIcon />}>
          {error}
        </AlertBar>
      )}

      {/* Deux colonnes dès `lg` : le détail à gauche, la gestion à droite.
          Le panneau suit le titre dans la page : sur téléphone, il s'affiche
          sous le titre, avant le détail. */}
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="lg:col-start-1 lg:row-start-1">
          {/* Événement non lu : la page n'affirme pas qu'il est programmé. */}
          {evenement && (
            <Text
              variant="overline"
              className="font-semibold uppercase tracking-wide"
            >
              Événement programmé
            </Text>
          )}
          <Heading
            level={1}
            size="2xl"
            tone="inherit"
            className="mt-1 text-savr-primary-900"
          >
            {evenement?.nom_evenement ?? 'Votre événement'}
          </Heading>
          {evenement && (
            <Text tone="soft" className="mt-1 flex items-start gap-1.5">
              <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {formatLieu(evenement.lieux)}
            </Text>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Card padding="md" className="space-y-3">
            <Heading
              level={2}
              size="base"
              weight="bold"
              tone="inherit"
              className="text-savr-primary-900"
            >
              Gérer votre événement
            </Heading>
            {/* Confirmation et rappel de l'email récap (§06.01 étape 13), selon
                l'issue réelle de l'envoi. Rien n'est parti → avertissement :
                avant la facture, le tarif Zéro Déchet n'est communiqué que par
                cet email (§06.01 §3.b). */}
            {evenement && (
              <div className="flex items-start gap-2 border-t-[3px] border-savr-success bg-savr-success-subtle px-3 py-3 text-sm text-savr-success-strong">
                <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-savr-success" />
                <p>
                  Votre événement est programmé.
                  {(etatEmail === 'envoye' || etatEmail === 'en_reprise') && (
                    <>
                      {' '}
                      <span>{MESSAGES_EMAIL_RECAP[etatEmail]}</span>
                    </>
                  )}
                </p>
              </div>
            )}
            {etatEmail === 'non_envoye' && (
              <AlertBar variant="warn" icon={<EnvelopeSimpleIcon />}>
                {MESSAGES_EMAIL_RECAP.non_envoye}
              </AlertBar>
            )}
            <div className="flex flex-col gap-2 pt-1">
              {evenement && (
                <Button asChild className="w-full">
                  <Link href={ROUTES.programmer.ajouterCollecte(evenement.id)}>
                    <PlusCircleIcon />
                    Ajouter une collecte
                  </Link>
                </Button>
              )}
              <Button
                asChild
                variant="secondary"
                className="w-full text-savr-primary-700"
              >
                <Link href={ROUTES.programmer.nouveau}>
                  <CalendarPlusIcon />
                  Programmer un autre événement
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className="w-full text-savr-neutral-600"
              >
                <Link href="/">Retour au tableau de bord</Link>
              </Button>
            </div>
          </Card>

          <Card padding="md" className="space-y-2">
            <Heading
              level={2}
              size="base"
              weight="bold"
              tone="inherit"
              className="text-savr-primary-900"
            >
              Besoin d’aide ?
            </Heading>
            <Text>
              Collecte dans moins de 24 h ou demande particulière : appelez
              l’équipe Savr.
            </Text>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <PhoneIcon className="h-4 w-4 shrink-0 text-savr-primary-600" />
              <TelephoneLien telephone={TELEPHONE_SAVR} />
            </p>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <EnvelopeSimpleIcon className="h-4 w-4 shrink-0 text-savr-primary-600" />
              <a
                href="mailto:contact@gosavr.io"
                className="text-savr-primary-700 hover:underline"
              >
                contact@gosavr.io
              </a>
            </p>
          </Card>
        </aside>

        <div className="min-w-0 space-y-8 lg:col-start-1 lg:row-start-2">
          {/* Récapitulatif de l'événement : client final et référence interne
              s'ils sont renseignés, traiteur opérant s'il n'est pas l'organisation
              programmatrice, contrôle d'accès (le nombre de collectes est dans le
              titre « Vos N collectes », non
              annulées). Le lieu est sous le titre. */}
          {evenement && (
            <section className="space-y-2.5">
              <Heading
                level={2}
                size="base"
                weight="bold"
                tone="inherit"
                className="text-savr-primary-900"
              >
                Votre événement
              </Heading>
              <Card padding="sm">
                <dl className="text-sm">
                  {renseigne(evenement.nom_client_organisateur) && (
                    <Ligne label="Client final">
                      {evenement.nom_client_organisateur}
                    </Ligne>
                  )}
                  {renseigne(evenement.reference_affaire) && (
                    <Ligne label="Référence interne">
                      {evenement.reference_affaire}
                    </Ligne>
                  )}
                  {traiteurOperant && (
                    <Ligne label="Traiteur opérant">{traiteurOperant}</Ligne>
                  )}
                  <Ligne label="Contrôle d’accès">
                    {evenement.controle_acces_requis ? (
                      <span className="inline-flex items-center gap-1.5">
                        <IdentificationCardIcon className="h-4 w-4 shrink-0 text-savr-accent-600" />
                        Plaque et nom du chauffeur requis
                      </span>
                    ) : (
                      'Non requis'
                    )}
                  </Ligne>
                </dl>
              </Card>
            </section>
          )}

          {/* Une carte par collecte, avec « Modifier » et « Annuler ». */}
          {numerotees.length > 0 && (
            <section className="space-y-2.5">
              <Heading
                level={2}
                size="base"
                weight="bold"
                tone="inherit"
                className="text-savr-primary-900"
              >
                {titreCollectes}
              </Heading>
              <ul className="space-y-3">
                {numerotees.map(({ collecte, libelle }) => (
                  <li key={collecte.id}>
                    <CarteCollecte
                      collecte={collecte}
                      libelle={libelle}
                      role={role}
                      onAnnuler={(url, demande) => {
                        setAnnulErreur(null);
                        setCible({ collecte, url, demande });
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* Annulation directe (brouillon, programmée) ou demande (validée). */}
      <AnnulationCollecteDialog
        open={cible !== null}
        demande={cible?.demande ?? false}
        antiGaspi={
          normaliserTypeCollecte(cible?.collecte.type) === 'anti_gaspi'
        }
        loading={annulEnCours}
        error={annulErreur}
        onConfirm={(motif) => void confirmerAnnulation(motif)}
        onCancel={() => setCible(null)}
      />
    </div>
  );
}

export default function ConfirmationProgrammationPage() {
  return (
    <Suspense fallback={<LoadingState label="Chargement du récapitulatif…" />}>
      <ConfirmationContent />
    </Suspense>
  );
}
