'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { AlertBar } from '@/components/ui/alert-bar';
import {
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
  CheckCircle2,
  PlusCircle,
  CalendarPlus,
  Mail,
  AlertTriangle,
  Pencil,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { Heading } from '@/components/ui/heading';
import { Text, textClasses } from '@/components/ui/text';
import { InfoItem } from '@/components/ui/info-item';
import { ContactLigne } from '@/components/collecte/fiche-blocs';
import { AnnulationCollecteDialog } from '@/components/collecte/annulation-collecte-dialog';
import { ESPACES, ESPACE_PAR_ROLE, ROUTES } from '@/lib/routes';
import { isStaff, type Role } from '@/lib/roles';
import { useUserRole } from '@/lib/use-user-role';
import {
  libelleTypeCollecte,
  normaliserTypeCollecte,
} from '@/lib/libelles/type-collecte';
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
// le rappel de l'email récapitulatif.

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
  return parsed.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

// `heure_collecte` est une colonne `time` (ex. "14:30:00") — on n'affiche que HH:MM
// (même convention que les listes collectes agence/organisateur).
function formatHeure(heure: string | null): string {
  return heure ? heure.slice(0, 5) : '';
}

function formatDateHeure(c: CollecteRecap): string {
  const heure = formatHeure(c.heure_collecte);
  return `${formatDate(c.date_collecte)}${heure ? ` à ${heure}` : ''}`;
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
// Traiteur et agence : la boîte d'annulation de leurs listes et fiches, sur la
// route de leur espace (directe, ou demande si la collecte est validée).
// Gestionnaire de lieux : aucune action, il n'annule pas (§06.05). Staff : la
// fiche collecte Admin, où l'équipe Savr annule.
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
  if (espace !== 'traiteur' && espace !== 'agence') return null;
  return {
    kind: 'boite',
    url: `${ESPACES[espace].apiCollectes}/${encodeURIComponent(c.id)}/annulation`,
    demande: c.statut === 'validee',
  };
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

  return (
    <Card
      padding="sm"
      role="region"
      aria-labelledby={idTitre}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading level={3} size="base" id={idTitre}>
          {libelle}
        </Heading>
        <CollecteStatutBadge statut={c.statut} />
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <InfoItem
          variant="hint"
          label="Date et heure"
          className="space-y-0.5"
          valueClassName={VALEUR_RECAP}
        >
          {formatDateHeure(c)}
        </InfoItem>
        <InfoItem
          variant="hint"
          label="Convives"
          className="space-y-0.5"
          valueClassName={VALEUR_RECAP}
        >
          {c.pax ?? '—'}
        </InfoItem>
        <InfoItem
          variant="hint"
          label="Type d’événement"
          className="space-y-0.5"
          valueClassName={VALEUR_RECAP}
        >
          {renseigne(c.type_evenement) ? c.type_evenement : '—'}
        </InfoItem>
        <InfoItem
          variant="hint"
          label="Contact principal"
          className="space-y-0.5"
          valueClassName={VALEUR_RECAP}
        >
          <ContactLigne
            nom={contacts?.contact_principal_nom}
            telephone={contacts?.contact_principal_telephone}
          />
        </InfoItem>
        {/* Contact de secours facultatif : omis s'il n'est pas renseigné. */}
        {avecSecours && (
          <InfoItem
            variant="hint"
            label="Contact de secours"
            className="space-y-0.5"
            valueClassName={VALEUR_RECAP}
          >
            <ContactLigne
              nom={contacts?.contact_secours_nom}
              telephone={contacts?.contact_secours_telephone}
            />
          </InfoItem>
        )}
        {renseigne(c.informations_supplementaires) && (
          <InfoItem
            variant="hint"
            label="Informations supplémentaires"
            pleineLargeur
            className="space-y-0.5"
            valueClassName={cn(VALEUR_RECAP, 'whitespace-pre-line break-words')}
          >
            {c.informations_supplementaires}
          </InfoItem>
        )}
      </dl>
      {(lienModifier || annulation) && (
        <div className="flex flex-col gap-2 border-t border-savr-neutral-100 pt-3 sm:flex-row sm:justify-end">
          {lienModifier && (
            <Button asChild variant="secondary">
              <Link href={lienModifier}>
                <Pencil />
                Modifier
              </Link>
            </Button>
          )}
          {annulation?.kind === 'lien' && (
            <Button asChild variant="outline-destructive">
              <Link href={annulation.href}>
                <XCircle />
                Annuler la collecte
              </Link>
            </Button>
          )}
          {annulation?.kind === 'boite' && (
            <Button
              variant="outline-destructive"
              onClick={() => onAnnuler(annulation.url, annulation.demande)}
            >
              <XCircle />
              {/* Même libellé que le pied de la fiche collecte cliente. */}
              {annulation.demande
                ? 'Demander l’annulation'
                : 'Annuler la collecte'}
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
  const parType = [
    {
      type: 'zero_dechet',
      nombre: actives.filter((c) => estZeroDechet(c.type)).length,
    },
    {
      type: 'anti_gaspi',
      nombre: actives.filter((c) => !estZeroDechet(c.type)).length,
    },
  ].filter((t) => t.nombre > 0);
  const titreCollectes =
    actives.length === 0
      ? 'Aucune collecte à réaliser'
      : `Nous réaliserons ${actives.length} collecte${actives.length > 1 ? 's' : ''}`;
  const etatEmail = evenement?.email_recap ?? null;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Bandeau succès */}
      <div className="flex items-start gap-3 rounded-savr-lg border border-savr-success bg-savr-success-subtle px-5 py-4">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-savr-success" />
        <Heading level={1} size="lg">
          {evenement
            ? `Votre événement « ${evenement.nom_evenement} » est programmé`
            : 'Votre événement est programmé'}
        </Heading>
      </div>

      {error && (
        <AlertBar variant="err" role="alert" icon={<AlertTriangle />}>
          {error}
        </AlertBar>
      )}

      {/* Récapitulatif de l'événement : client final et référence interne
          s'ils sont renseignés, lieu, contrôle d'accès, collectes par type
          (non annulées). */}
      {evenement && (
        <div className="space-y-3">
          <Heading level={2} size="sm" tone="faint" overline>
            Récapitulatif
          </Heading>
          <dl className="grid gap-4 rounded-savr-md border border-savr-neutral-200 bg-savr-white px-4 py-3 sm:grid-cols-2">
            {renseigne(evenement.nom_client_organisateur) && (
              <InfoItem
                variant="hint"
                label="Client final"
                className="space-y-0.5"
                valueClassName={VALEUR_RECAP}
              >
                {evenement.nom_client_organisateur}
              </InfoItem>
            )}
            {renseigne(evenement.reference_affaire) && (
              <InfoItem
                variant="hint"
                label="Référence interne"
                className="space-y-0.5"
                valueClassName={VALEUR_RECAP}
              >
                {evenement.reference_affaire}
              </InfoItem>
            )}
            <InfoItem
              variant="hint"
              label="Lieu"
              pleineLargeur
              className="space-y-0.5"
              valueClassName={VALEUR_RECAP}
            >
              {formatLieu(evenement.lieux)}
            </InfoItem>
            <InfoItem
              variant="hint"
              label="Contrôle d’accès"
              className="space-y-0.5"
              valueClassName={VALEUR_RECAP}
            >
              {evenement.controle_acces_requis
                ? 'Plaque et nom du chauffeur requis'
                : 'Non requis'}
            </InfoItem>
            <InfoItem
              variant="hint"
              label="Collectes"
              className="space-y-0.5"
              valueClassName={VALEUR_RECAP}
            >
              {parType.length === 0
                ? '—'
                : parType.map((t) => (
                    <span key={t.type} className="block">
                      {libelleTypeCollecte(t.type)} : {t.nombre}
                    </span>
                  ))}
            </InfoItem>
          </dl>
        </div>
      )}

      {/* Une carte par collecte, avec « Modifier » et « Annuler la collecte ». */}
      {numerotees.length > 0 && (
        <div className="space-y-3">
          <Heading level={2} size="sm" tone="faint" overline>
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
        </div>
      )}

      {/* Rappel email récap (§06.01 étape 13), selon l'issue réelle de l'envoi.
          Rien n'est parti → bandeau visible, pas une ligne discrète : avant la
          facture, le tarif Zéro Déchet n'est communiqué que par cet email
          (§06.01 §3.b). */}
      {etatEmail === 'non_envoye' ? (
        <AlertBar variant="warn" icon={<Mail />}>
          {MESSAGES_EMAIL_RECAP.non_envoye}
        </AlertBar>
      ) : (
        etatEmail && (
          <Text tone="soft" className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0 text-savr-neutral-400" />
            {MESSAGES_EMAIL_RECAP[etatEmail]}
          </Text>
        )
      )}

      {/* Actions du bas de page */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {evenement && (
          <Button asChild>
            <Link href={ROUTES.programmer.ajouterCollecte(evenement.id)}>
              <PlusCircle />
              Ajouter une collecte
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link href={ROUTES.programmer.nouveau}>
            <CalendarPlus />
            Programmer un autre événement
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">Accueil</Link>
        </Button>
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
