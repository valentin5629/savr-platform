'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { AlertBar } from '@/components/ui/alert-bar';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  PlusCircle,
  CalendarPlus,
  Mail,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { Heading } from '@/components/ui/heading';
import { Text, textClasses } from '@/components/ui/text';
import { InfoItem } from '@/components/ui/info-item';
import { ContactLigne } from '@/components/collecte/fiche-blocs';
import { ESPACE_PAR_ROLE, ROUTES } from '@/lib/routes';
import { isStaff, type Role } from '@/lib/roles';
import { useUserRole } from '@/lib/use-user-role';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';
import type { EtatRecapEmail } from '@/lib/programmation/suivi-recap-email';

// Valeur du récapitulatif événement : texte courant neutral-900.
const VALEUR_RECAP = textClasses({ tone: 'ink' });

type CollecteRecap = {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  heure_collecte: string | null;
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
  pax: number | null;
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
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

// Libellés type collecte : `libelleTypeCollecte` tolère l'enum DB
// (zero_dechet/anti_gaspi) et les alias UI (zd/ag) renvoyés par l'API.
const libelleType = libelleTypeCollecte;

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

// « Modifier la collecte » (décision Val 2026-10-16) : la fiche de la collecte
// s'ouvre en édition dans la liste Collectes de l'espace du rôle, comme le
// crayon de cette liste. Staff : la fiche collecte Admin, éditée bloc par bloc.
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

function ConfirmationContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const role = useUserRole();

  const [evenement, setEvenement] = useState<EvenementRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || id === 'undefined') {
      setError('Identifiant de l’événement manquant.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/programmation/evenements/${encodeURIComponent(id)}`,
        );
        const data = (await res.json()) as EvenementRecap & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? 'Événement introuvable.');
          return;
        }
        setEvenement(data);
      } catch {
        if (!cancelled) setError('Erreur lors du chargement de l’événement.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <LoadingState label="Chargement du récapitulatif…" />;
  }

  const collectes = evenement?.collectes ?? [];
  const etatEmail = evenement?.email_recap ?? null;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Bandeau succès */}
      <div className="flex items-start gap-3 rounded-savr-lg border border-savr-success bg-savr-success-subtle px-5 py-4">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-savr-success" />
        <div className="space-y-1">
          <Heading level={1} size="lg">
            {collectes.length > 1
              ? 'Vos collectes sont programmées'
              : 'Votre collecte est programmée'}
          </Heading>
          <Text variant="body">
            {evenement
              ? `Événement « ${evenement.nom_evenement} » enregistré avec succès.`
              : 'Programmation enregistrée avec succès.'}
          </Text>
        </div>
      </div>

      {error && (
        <AlertBar variant="err" role="alert" icon={<AlertTriangle />}>
          {error}
        </AlertBar>
      )}

      {/* Récapitulatif (décision Val 2026-10-16, déplacé de l'étape 3) : client,
          lieu, convives et contacts sont portés par `evenements`, la date et
          l'heure par chaque collecte (§04 Data Model). */}
      {evenement && (
        <div className="space-y-3">
          <Heading level={2} size="sm" tone="faint" overline>
            Récapitulatif
          </Heading>
          <dl className="grid gap-4 rounded-savr-md border border-savr-neutral-200 bg-savr-white px-4 py-3 sm:grid-cols-2">
            <InfoItem
              variant="hint"
              label="Client"
              pleineLargeur
              className="space-y-0.5"
              valueClassName={VALEUR_RECAP}
            >
              {evenement.nom_client_organisateur || '—'}
            </InfoItem>
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
              label="Convives"
              className="space-y-0.5"
              valueClassName={VALEUR_RECAP}
            >
              {evenement.pax ?? '—'}
            </InfoItem>
            <InfoItem
              variant="hint"
              label="Date et heure"
              className="space-y-0.5"
              valueClassName={VALEUR_RECAP}
            >
              {collectes.length > 1
                ? collectes.map((c) => (
                    <span key={c.id} className="block">
                      {libelleType(c.type)} : {formatDateHeure(c)}
                    </span>
                  ))
                : collectes[0]
                  ? formatDateHeure(collectes[0])
                  : '—'}
            </InfoItem>
            <InfoItem
              variant="hint"
              label="Contact principal"
              className="space-y-0.5"
              valueClassName={VALEUR_RECAP}
            >
              <ContactLigne
                nom={evenement.contact_principal_nom}
                telephone={evenement.contact_principal_telephone}
              />
            </InfoItem>
            <InfoItem
              variant="hint"
              label="Contact de secours"
              className="space-y-0.5"
              valueClassName={VALEUR_RECAP}
            >
              <ContactLigne
                nom={evenement.contact_secours_nom}
                telephone={evenement.contact_secours_telephone}
              />
            </InfoItem>
          </dl>
        </div>
      )}

      {/* Collectes créées : statut et accès à la modification */}
      {collectes.length > 0 && (
        <div className="space-y-3">
          <Heading level={2} size="sm" tone="faint" overline>
            {collectes.length > 1
              ? `${collectes.length} collectes créées`
              : 'Collecte créée'}
          </Heading>
          <ul className="space-y-2">
            {collectes.map((c) => {
              const lienModifier = lienModifierCollecte(role, c.id);
              return (
                <li
                  key={c.id}
                  className="flex flex-col gap-3 rounded-savr-md border border-savr-neutral-200 bg-savr-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <Text tone="ink" className="font-semibold">
                      {libelleType(c.type)}
                    </Text>
                    <CollecteStatutBadge statut={c.statut} />
                  </div>
                  {lienModifier && (
                    <Button asChild variant="secondary">
                      <Link href={lienModifier}>
                        <Pencil />
                        Modifier la collecte
                      </Link>
                    </Button>
                  )}
                </li>
              );
            })}
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

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {evenement && (
          <Button asChild>
            <Link href={ROUTES.programmer.ajouterCollecte(evenement.id)}>
              <PlusCircle />
              Ajouter une collecte à cet événement
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
          <Link href="/">Retour à l&apos;accueil</Link>
        </Button>
      </div>
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
