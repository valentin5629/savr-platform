'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  MapPin,
  PlusCircle,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EditerCollecteForm } from '@/components/collecte/editer-collecte-form';
import type { FicheCollecteMeta } from '@/components/collecte/fiche-collecte-modal-cadre';
import { StatutCollecteClient } from '@/components/collecte/statut-collecte-client';
import {
  OngletInformations,
  OngletLogistique,
  type FicheClientDonnees,
} from '@/components/collecte/fiche-collecte-client-onglets';
import { OngletBilan } from '@/components/collecte/fiche-collecte-client-bilan';
import { dateLongueCapitalisee } from '@/components/collecte/fiche-blocs';
import { EnTeteMention } from '@/components/ui/fiche/fiche-en-tete';
import { FicheCorps, FichePied } from '@/components/ui/fiche/fiche-modal';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';
import { libelleTypeOrganisationMinuscule } from '@/lib/libelles/organisation';
import { refCourteCollecte } from '@/lib/collecte-ref';
import { ROUTES } from '@/lib/routes';
import type { EspaceClient } from '@/lib/collectes/fiche-client-types';
import { Text } from '@/components/ui/text';
import { fmtPax } from '@/lib/format';
import { TextLink } from '@/components/ui/text-link';
import { FormActions } from '@/components/ui/form-actions';
import { AnnulationCollecteDialog } from '@/components/collecte/annulation-collecte-dialog';

// Pop-up fiche collecte COMMUN aux rôles clients — traiteur (§06.04), agence
// (§06.11) et gestionnaire de lieux (§06.05) — refonte Val 2026-09-29, au
// format des fiches Admin depuis le 2026-10-01 : grand en-tête (badge type,
// réf., lieu, date · heure · pax, frise client), barre d'onglets horizontale
// (Informations / Logistique / Bilan & documents), pied d'actions. Seules
// changent les actions, calculées par le serveur selon le rôle.

export type OngletFiche = 'informations' | 'logistique' | 'bilan';
type Onglet = OngletFiche;

interface FicheCollecteClientPanelProps {
  espace: EspaceClient;
  collecteId: string;
  // Ouverture directe en édition (action « Modifier » de la liste, ?edit=1).
  initialEditing?: boolean;
  // Onglet ouvert d'emblée — « bilan » depuis le picto de téléchargement d'un
  // rapport de recyclage, qui se fabrique dans cet onglet (Val 2026-10-16).
  initialOnglet?: Onglet;
  // Remonte au cadre le type + le titre accessible une fois la collecte chargée.
  onLoaded?: (info: FicheCollecteMeta) => void;
  // Miroir « une sous-modale est ouverte » : le cadre ne ferme pas la fiche sur
  // Échap tant qu'une sous-modale (annulation, programmée par, SIRET,
  // confirmation d'édition) est ouverte.
  blockCloseRef?: MutableRefObject<boolean>;
}

export function FicheCollecteClientPanel({
  espace,
  collecteId: id,
  initialEditing = false,
  initialOnglet = 'informations',
  onLoaded,
  blockCloseRef,
}: FicheCollecteClientPanelProps) {
  const base = `/api/v1/${encodeURIComponent(espace)}/collectes/${encodeURIComponent(id)}`;
  const [c, setC] = useState<FicheClientDonnees | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [editing, setEditing] = useState(initialEditing);
  const [onglet, setOnglet] = useState<Onglet>(initialOnglet);

  // Annulation (directe ou demande) — modale + motif facultatif.
  const [annulOpen, setAnnulOpen] = useState(false);
  const [annulEnCours, setAnnulEnCours] = useState(false);
  const [annulErreur, setAnnulErreur] = useState<string | null>(null);
  const [progOpen, setProgOpen] = useState(false);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  // Agence : complétion du SIRET d'un traiteur hors référentiel (§06.11 F2).
  const [siretOpen, setSiretOpen] = useState(false);
  const [siret, setSiret] = useState('');
  const [siretErreur, setSiretErreur] = useState<string | null>(null);
  const [siretEnCours, setSiretEnCours] = useState(false);
  // Demande urgente des coordonnées du chauffeur.
  const [urgence, setUrgence] = useState<'idle' | 'envoi' | 'envoyee'>('idle');
  const [urgenceErreur, setUrgenceErreur] = useState<string | null>(null);

  // Fiche → fiche sans remontage : une réponse lente de la fiche quittée ne doit
  // pas écraser la nouvelle (id capturé par la requête vs id rendu).
  const idRendu = useRef(id);
  idRendu.current = id;

  const reload = useCallback(() => {
    setErreur(null);
    const perime = (): boolean => idRendu.current !== id;
    fetch(base)
      .then(async (r) => {
        // 404 = collecte supprimée ou hors périmètre : état « introuvable »,
        // distinct de l'état Erreur (§10 §7).
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => {
        if (perime()) return;
        setC(j?.data ?? null);
      })
      .catch(() => {
        if (!perime()) setErreur('Le chargement de la collecte a échoué.');
      })
      .finally(() => {
        if (!perime()) setLoading(false);
      });
  }, [base, id]);

  useEffect(() => {
    setC(null);
    setLoading(true);
    setUrgence('idle');
    reload();
  }, [reload]);

  // Titre accessible du dialogue (l'en-tête visuel est porté par le panneau).
  useEffect(() => {
    if (!c) return;
    const lieu = c.evenement?.lieu;
    onLoaded?.({
      title: [
        `Collecte ${libelleTypeCollecte(c.type)}`,
        lieu?.nom,
        dateLongueCapitalisee(c.date_collecte),
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }, [c, onLoaded]);

  if (blockCloseRef)
    blockCloseRef.current =
      annulOpen || progOpen || editConfirmOpen || siretOpen;

  async function confirmerAnnulation(motif: string) {
    setAnnulEnCours(true);
    setAnnulErreur(null);
    try {
      const res = await fetch(`${base}/annulation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motif }),
      });
      if (res.ok) {
        setAnnulOpen(false);
        reload();
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setAnnulErreur(j.error ?? 'L’annulation a échoué.');
      }
    } finally {
      setAnnulEnCours(false);
    }
  }

  async function demanderUrgence() {
    setUrgence('envoi');
    setUrgenceErreur(null);
    const res = await fetch(`${base}/coordonnees-urgence`, { method: 'POST' });
    if (res.ok) {
      setUrgence('envoyee');
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setUrgence('idle');
    setUrgenceErreur(j.error ?? 'La demande n’a pas pu être envoyée.');
  }

  async function enregistrerSiret() {
    const traiteur = c?.traiteur_operationnel;
    if (!traiteur) return;
    setSiretEnCours(true);
    setSiretErreur(null);
    try {
      const res = await fetch(
        `/api/v1/agence/shadow/${encodeURIComponent(traiteur.id)}/siret`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siret }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setSiretErreur(j.error ?? 'Erreur lors de la complétion du SIRET');
        return;
      }
      setSiretOpen(false);
      setSiret('');
      reload();
    } finally {
      setSiretEnCours(false);
    }
  }

  // États système §10 §7 : Loading = skeleton, Error = message + « Réessayer ».
  if (loading)
    return (
      <div className="space-y-4 p-6" data-testid="fiche-skeleton">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (erreur)
    return (
      <ErrorState
        className="p-6"
        data-testid="fiche-erreur"
        message={erreur}
        onRetry={() => {
          setLoading(true);
          reload();
        }}
      />
    );
  if (!c) return <ErrorState className="p-6" message="Collecte introuvable." />;

  const evt = c.evenement;
  const lieu = evt?.lieu ?? null;
  const heure = c.heure_collecte?.slice(0, 5) ?? null;
  const { actions } = c;
  const demande = actions.annulation === 'demande';
  // Ajout d'une collecte à l'événement : la page d'ajout, hors de la fiche.
  const lienAjouterCollecte =
    actions.ajouter_collecte && evt
      ? ROUTES.programmer.ajouterCollecte(evt.id)
      : null;
  const piedVisible =
    !editing &&
    (actions.annuler !== 'absent' ||
      actions.modifier !== 'absent' ||
      lienAjouterCollecte !== null);
  const motifGrise =
    espace === 'traiteur'
      ? 'Seul le créateur de la collecte ou un manager peut la modifier.'
      : 'Seule l’organisation qui a programmé la collecte peut la modifier.';
  const progTypeLabel = c.programmee_par
    ? libelleTypeOrganisationMinuscule(c.programmee_par.type)
    : null;

  const sousTitre = [evt?.nom_evenement, evt?.nom_client_organisateur]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(' · ');

  // Variante B (décision Val 2026-10-27) : grand en-tête sur deux lignes (lieu
  // + événement · client, puis date, heure, pax, ville), statut en pastille à
  // droite du titre, onglets soulignés dans l'en-tête ; seul le corps défile.
  return (
    <Tabs
      value={onglet}
      onValueChange={(v) => setOnglet(v as Onglet)}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex shrink-0 flex-col gap-5 px-6 pt-6 md:gap-6 md:px-14 md:pt-9">
        <div className="flex min-w-0 flex-wrap items-center gap-3 pr-12 md:pr-16">
          <TypeCollecteBadge type={c.type} forme="plein" />
          <EnTeteMention>Réf. {refCourteCollecte(c)}</EnTeteMention>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-3">
          <div className="flex min-w-0 flex-col gap-2.5">
            <h3 className="font-display text-3xl font-semibold leading-[1.05] tracking-[-0.035em] text-savr-primary-900 md:text-5xl">
              {lieu?.nom ?? 'Collecte'}
            </h3>
            {sousTitre && (
              <p className="text-[17px] text-savr-neutral-600">{sousTitre}</p>
            )}
          </div>
          <StatutCollecteClient statut={c.statut} />
        </div>
        <p
          data-testid="fiche-sous-ligne"
          className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[15px] text-savr-neutral-700"
        >
          <InfoEnTete icon={CalendarDays}>
            {dateLongueCapitalisee(c.date_collecte)}
          </InfoEnTete>
          {heure && <InfoEnTete icon={Clock}>{heure}</InfoEnTete>}
          {/* Pax de la collecte (décision Val 2026-10-20). */}
          <InfoEnTete icon={Users}>{fmtPax(c.pax)}</InfoEnTete>
          {lieu?.ville && <InfoEnTete icon={MapPin}>{lieu.ville}</InfoEnTete>}
        </p>
        {!editing && (
          <TabsList
            aria-label="Sections de la fiche collecte"
            className="w-full gap-6 overflow-x-auto border-savr-sable-200 md:gap-9"
          >
            <TabsTrigger value="informations" className={ONGLET}>
              Informations
            </TabsTrigger>
            <TabsTrigger value="logistique" className={ONGLET}>
              Logistique
            </TabsTrigger>
            <TabsTrigger value="bilan" className={ONGLET}>
              Bilan & documents
            </TabsTrigger>
          </TabsList>
        )}
      </header>

      {editing && evt ? (
        <FicheCorps className="border-t border-savr-sable-200 py-6 md:px-14">
          <EditerCollecteForm
            collecte={{
              id: c.id,
              type: c.type,
              statut: c.statut,
              statut_tms: c.statut_tms,
              date_collecte: c.date_collecte,
              heure_collecte: c.heure_collecte,
              pax: c.pax,
              controle_acces_requis: c.controle_acces_requis,
              informations_supplementaires: c.informations_supplementaires,
              type_evenement_id: c.type_evenement_id,
              contact_principal_nom: c.contact_principal_nom,
              contact_principal_telephone: c.contact_principal_telephone,
              contact_secours_nom: c.contact_secours_nom,
              contact_secours_telephone: c.contact_secours_telephone,
              lieu_nom: lieu?.nom ?? null,
              evenement: {
                id: evt.id,
                nom_evenement: evt.nom_evenement,
                nom_client_organisateur: evt.nom_client_organisateur,
                reference_affaire: evt.reference_affaire,
              },
            }}
            collecteEndpoint={base}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
            onCancel={() => setEditing(false)}
            onConfirmOpenChange={setEditConfirmOpen}
          />
        </FicheCorps>
      ) : (
        <FicheCorps className="py-8 md:px-14">
          {!c.informations_completes && (
            <AlertBar
              variant="warn"
              className="mb-6"
              data-testid="bandeau-infos-incompletes"
            >
              Informations incomplètes — merci de compléter avant la collecte.
            </AlertBar>
          )}
          <TabsContent value="informations">
            <OngletInformations
              c={c}
              onProgrammeePar={() => setProgOpen(true)}
              onHorsReferentiel={() => {
                setSiretErreur(null);
                setSiretOpen(true);
              }}
            />
          </TabsContent>
          <TabsContent value="logistique">
            <OngletLogistique
              c={c}
              urgence={urgence}
              urgenceErreur={urgenceErreur}
              onDemanderUrgence={() => void demanderUrgence()}
            />
          </TabsContent>
          <TabsContent value="bilan">
            <OngletBilan c={c} base={base} espace={espace} />
          </TabsContent>
        </FicheCorps>
      )}

      {piedVisible && (
        <FichePied className="justify-start gap-3 border-savr-sable-200 px-6 py-5 md:px-14">
          {actions.annuler !== 'absent' && (
            <Button
              variant="ghost-destructive"
              size="pilule"
              data-testid="action-annuler"
              disabled={actions.annuler === 'grise'}
              title={actions.annuler === 'grise' ? motifGrise : undefined}
              onClick={() => {
                setAnnulErreur(null);
                setAnnulOpen(true);
              }}
              className="px-3"
            >
              {demande ? 'Demander l’annulation' : 'Annuler la collecte'}
            </Button>
          )}
          <span className="hidden flex-1 sm:block" aria-hidden="true" />
          {lienAjouterCollecte && (
            <Button
              asChild
              variant="sable"
              size="pilule"
              data-testid="action-ajouter-collecte"
              // Libellé long : il passe à la ligne sur un téléphone au lieu
              // de déborder du pied de la fiche.
              className="max-sm:h-auto max-sm:min-h-11 max-sm:whitespace-normal max-sm:text-center"
            >
              <Link href={lienAjouterCollecte}>
                <PlusCircle className="h-4 w-4" aria-hidden="true" />
                Ajouter une collecte à cet événement
              </Link>
            </Button>
          )}
          {actions.modifier !== 'absent' && (
            <Button
              size="pilule"
              data-testid="action-modifier"
              disabled={actions.modifier === 'grise'}
              title={actions.modifier === 'grise' ? motifGrise : undefined}
              onClick={() => setEditing(true)}
            >
              Modifier la collecte
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </FichePied>
      )}

      {/* Modale info « Programmée par » (§06.04) — informative, sans action. */}
      <Modal
        open={progOpen}
        title="Collecte programmée par un tiers"
        onClose={() => setProgOpen(false)}
      >
        <div className="space-y-4 text-sm">
          <p>
            Cette collecte a été programmée par{' '}
            <strong>{c.programmee_par?.nom}</strong>, {progTypeLabel}. Vous êtes
            le traiteur opérationnel sur place.
          </p>
          {c.programmee_par?.email && (
            <p className="text-savr-neutral-500">
              Pour toute question :{' '}
              <TextLink href={`mailto:${c.programmee_par.email}`} external>
                {c.programmee_par.email}
              </TextLink>
            </p>
          )}
          <div className="flex justify-end border-t border-savr-neutral-100 pt-4">
            <Button variant="secondary" onClick={() => setProgOpen(false)}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Annulation directe (brouillon/programmee) ou demande (validee). */}
      <AnnulationCollecteDialog
        open={annulOpen}
        demande={demande}
        antiGaspi={c.type === 'anti_gaspi'}
        loading={annulEnCours}
        error={annulErreur}
        onConfirm={(motif) => void confirmerAnnulation(motif)}
        onCancel={() => setAnnulOpen(false)}
      />

      {/* Agence — complétion du SIRET d'un traiteur hors référentiel (§06.11 F2). */}
      <Modal
        open={siretOpen}
        title={`Compléter le SIRET — ${c.traiteur_operationnel?.nom ?? ''}`}
        onClose={() => setSiretOpen(false)}
      >
        <div className="space-y-3" data-testid="modal-siret">
          <Text>
            Le SIRET du traiteur opérationnel est requis pour finaliser le
            bordereau Cerfa.
          </Text>
          <FormField
            label="SIRET"
            htmlFor="fiche-siret-traiteur"
            required
            hint="14 chiffres"
            error={siretErreur ?? undefined}
          >
            <Input
              id="fiche-siret-traiteur"
              type="text"
              inputMode="numeric"
              required
              maxLength={14}
              value={siret}
              onChange={(e) =>
                setSiret(e.target.value.replace(/\D/g, '').slice(0, 14))
              }
              error={siretErreur !== null}
            />
          </FormField>
          <FormActions
            cancel={{ label: 'Annuler', onClick: () => setSiretOpen(false) }}
            submit={{
              label: 'Enregistrer',
              disabled: siret.length !== 14,
              onClick: () => void enregistrerSiret(),
            }}
            loading={siretEnCours}
            bordered
          />
        </div>
      </Modal>
    </Tabs>
  );
}

// Onglets de la variante B : soulignés, plus espacés, texte 15 px.
const ONGLET =
  'px-0 text-[15px] data-[state=active]:border-savr-primary-900 data-[state=active]:text-savr-primary-900';

function InfoEnTete({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="h-4 w-4 text-savr-neutral-400" aria-hidden="true" />
      {children}
    </span>
  );
}
