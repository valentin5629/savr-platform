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
  ArrowClockwiseIcon,
  ArrowRightIcon,
  CalendarDotsIcon,
  ClockIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  MapPinIcon,
  PlusCircleIcon,
  UsersIcon,
} from '@/components/ui/icones';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { EditerCollecteForm } from '@/components/collecte/editer-collecte-form';
import type { FicheCollecteMeta } from '@/components/collecte/fiche-collecte-modal-cadre';
import { StatutCollecteClient } from '@/components/collecte/statut-collecte-client';
import {
  OngletInformations,
  OngletLogistique,
  type FicheClientDonnees,
} from '@/components/collecte/fiche-collecte-client-onglets';
import {
  OngletBilan,
  useRadarFiche,
  useRapportCollecte,
} from '@/components/collecte/fiche-collecte-client-bilan';
import { dateLongueCapitalisee } from '@/components/collecte/fiche-blocs';
import { EnTeteMention } from '@/components/ui/fiche/fiche-en-tete';
import { FicheCorps, FichePied } from '@/components/ui/fiche/fiche-modal';
import {
  FicheGrandEnTete,
  FicheOnglet,
  FicheOnglets,
  FicheRepere,
} from '@/components/ui/fiche/fiche-grand-en-tete';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';
import { libelleMisAJour } from '@/lib/format-date-collecte';
import { libelleTypeOrganisationMinuscule } from '@/lib/libelles/organisation';
import { refCourteCollecte } from '@/lib/collecte-ref';
import { ROUTES } from '@/lib/routes';
import {
  LIBELLE_ETAT_RAPPORT,
  type EspaceClient,
} from '@/lib/collectes/fiche-client-types';
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

  // Radar et rapport portés par le panneau : le bouton « Télécharger le
  // rapport » est dans le pied (visible sans défiler, Val 2026-10-27) et
  // reprend les filtres du radar réglés dans l'onglet Bilan.
  const radar = useRadarFiche(`${base}/benchmark`, c);
  const rapport = useRapportCollecte(c, base, radar);

  // Titre accessible du dialogue (l'en-tête visuel est porté par le panneau).
  useEffect(() => {
    if (!c) return;
    const lieu = c.evenement?.lieu;
    onLoaded?.({
      title: [
        `Collecte ${libelleTypeCollecte(c.type)}`,
        c.evenement?.nom_evenement?.trim(),
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
  // Ajout d'une collecte à l'événement : la page d'ajout, hors de la fiche.
  const lienAjouterCollecte =
    actions.ajouter_collecte && evt
      ? ROUTES.programmer.ajouterCollecte(evt.id)
      : null;
  const piedVisible =
    !editing &&
    (actions.annuler !== 'absent' ||
      actions.modifier !== 'absent' ||
      lienAjouterCollecte !== null ||
      rapport.visible);
  // Téléphone (B4) : une seule action en grand — Modifier, à défaut
  // Télécharger le rapport, à défaut Ajouter une collecte ; les autres
  // passent dans le menu « ⋯ ».
  const principale: 'modifier' | 'telecharger' | 'ajouter' | null =
    actions.modifier !== 'absent'
      ? 'modifier'
      : rapport.visible
        ? 'telecharger'
        : lienAjouterCollecte
          ? 'ajouter'
          : null;
  const motifGrise =
    espace === 'traiteur'
      ? 'Seul le créateur de la collecte ou un manager peut la modifier.'
      : 'Seule l’organisation qui a programmé la collecte peut la modifier.';
  // Rapport pas encore téléchargeable : son état d'attente (ex. « disponible
  // dans les 48h après la collecte »).
  const motifRapport =
    rapport.desactive && c.rapport_etat !== 'disponible'
      ? LIBELLE_ETAT_RAPPORT[c.rapport_etat]
      : undefined;
  // Téléphone : raison de l'action principale grisée, écrite au-dessus du
  // pied (le `title` des boutons ne s'affiche pas au toucher).
  const motifPrincipale =
    principale === 'modifier' && actions.modifier === 'grise'
      ? motifGrise
      : principale === 'telecharger'
        ? motifRapport
        : undefined;
  // « Mis à jour le … » d'un document AG refait après sa première émission
  // (§05 « Indicateur de mise à jour », §12 §1.4).
  const miseAJour =
    rapport.visible && c.rapport_mis_a_jour_at
      ? libelleMisAJour(c.rapport_mis_a_jour_at)
      : null;
  const libelleAnnuler = 'Annuler la collecte';
  const secondaires: {
    cle: 'annuler' | 'ajouter' | 'telecharger';
    libelle: string;
    desactive?: boolean;
    // Raison d'une action grisée, écrite sous elle dans le menu « ⋯ » : un
    // `title` ne s'affiche pas au toucher.
    motif?: string;
    lien?: string;
    onClick?: () => void;
  }[] = [
    ...(lienAjouterCollecte && principale !== 'ajouter'
      ? [
          {
            cle: 'ajouter' as const,
            libelle: 'Ajouter une collecte à cet événement',
            lien: lienAjouterCollecte,
          },
        ]
      : []),
    ...(rapport.visible && principale !== 'telecharger'
      ? [
          {
            cle: 'telecharger' as const,
            libelle: 'Télécharger le rapport',
            desactive: rapport.desactive || rapport.fabrication,
            motif: motifRapport,
            onClick: () => void rapport.telecharger(),
          },
        ]
      : []),
    ...(actions.annuler !== 'absent'
      ? [
          {
            cle: 'annuler' as const,
            libelle: libelleAnnuler,
            desactive: actions.annuler === 'grise',
            motif: actions.annuler === 'grise' ? motifGrise : undefined,
            onClick: () => {
              setAnnulErreur(null);
              setAnnulOpen(true);
            },
          },
        ]
      : []),
  ];
  const masqueTel = (cle: string) =>
    secondaires.some((a) => a.cle === cle) ? 'max-sm:hidden' : undefined;
  const progTypeLabel = c.programmee_par
    ? libelleTypeOrganisationMinuscule(c.programmee_par.type)
    : null;

  // Titre = nom de l'événement (décision Val 2026-10-27), le lieu à défaut ;
  // dessous, le lieu (s'il n'est pas déjà le titre) et le client.
  const titre = evt?.nom_evenement?.trim() || lieu?.nom || 'Collecte';
  const sousTitre = [
    titre === lieu?.nom ? null : lieu?.nom,
    evt?.nom_client_organisateur,
  ]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(' · ');

  // Variante B (décision Val 2026-10-27) : grand en-tête sur deux lignes
  // (événement + lieu · client, puis date, heure, pax, ville), statut en pastille à
  // droite du titre, onglets soulignés dans l'en-tête ; seul le corps défile.
  return (
    <Tabs
      value={onglet}
      onValueChange={(v) => setOnglet(v as Onglet)}
      className="flex h-full min-h-0 flex-col"
    >
      <FicheGrandEnTete
        surtitre={
          <>
            <TypeCollecteBadge type={c.type} forme="plein" />
            <EnTeteMention>Réf. {refCourteCollecte(c)}</EnTeteMention>
          </>
        }
        titre={titre}
        sousTitre={sousTitre || undefined}
        statut={<StatutCollecteClient statut={c.statut} />}
        reperesTestId="fiche-sous-ligne"
        reperes={
          <>
            <FicheRepere icon={CalendarDotsIcon}>
              {dateLongueCapitalisee(c.date_collecte)}
            </FicheRepere>
            {heure && <FicheRepere icon={ClockIcon}>{heure}</FicheRepere>}
            {/* Pax de la collecte (décision Val 2026-10-20). */}
            <FicheRepere icon={UsersIcon}>{fmtPax(c.pax)}</FicheRepere>
            {lieu?.ville && (
              <FicheRepere icon={MapPinIcon}>{lieu.ville}</FicheRepere>
            )}
          </>
        }
        onglets={
          editing ? undefined : (
            <FicheOnglets
              mobile="pastilles"
              aria-label="Sections de la fiche collecte"
            >
              <FicheOnglet value="informations">
                <span aria-hidden="true" className="sm:hidden">
                  Infos
                </span>
                <span className="max-sm:sr-only">Informations</span>
              </FicheOnglet>
              <FicheOnglet value="logistique">Logistique</FicheOnglet>
              <FicheOnglet value="bilan">
                <span aria-hidden="true" className="sm:hidden">
                  Bilan
                </span>
                <span className="max-sm:sr-only">Bilan & documents</span>
              </FicheOnglet>
            </FicheOnglets>
          )
        }
      />

      {editing && evt ? (
        <FicheCorps className="border-t border-savr-sable-200 py-6">
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
        <FicheCorps className="pb-3 pt-5 md:px-12">
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
              onAjouterSecours={
                actions.modifier === 'actif'
                  ? () => setEditing(true)
                  : undefined
              }
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
            <OngletBilan
              c={c}
              espace={espace}
              radar={radar}
              rapport={rapport}
            />
          </TabsContent>
        </FicheCorps>
      )}

      {rapport.erreur && !editing && (
        <AlertBar
          variant="err"
          role="alert"
          className="mx-6 mb-2 md:mx-12"
          data-testid="erreur-rapport"
        >
          {rapport.erreur}
        </AlertBar>
      )}
      {piedVisible && (motifPrincipale || miseAJour) && (
        // Téléphone : ce que l'infobulle et l'espace libre du pied disent sur
        // écran large, écrit au-dessus du pied.
        <div
          className="space-y-1 border-t border-savr-sable-200 px-5 pt-3 text-xs text-savr-neutral-600 sm:hidden"
          data-testid="notes-pied-telephone"
        >
          {motifPrincipale && <p>{motifPrincipale}</p>}
          {miseAJour && (
            <p className="inline-flex items-center gap-1.5">
              <ArrowClockwiseIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {miseAJour}
            </p>
          )}
        </div>
      )}
      {piedVisible && (
        <FichePied
          className={cn(
            'flex-nowrap justify-start gap-3 border-savr-sable-200 px-5 pb-7 pt-3 sm:flex-wrap sm:px-6 sm:py-4 md:px-12',
            // Notes du téléphone au-dessus : elles portent déjà le filet.
            (motifPrincipale || miseAJour) && 'max-sm:border-t-0',
          )}
        >
          {/* Téléphone (B4) : l'action principale en grand, les autres dans
              « ⋯ ». Les boutons secondaires restent dans le DOM, masqués
              sous 640 px. */}
          {secondaires.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <IconButton
                  aria-label="Autres actions"
                  data-testid="action-autres"
                  className="h-[52px] w-[52px] rounded-savr-full bg-savr-sable-100 text-savr-neutral-900 hover:bg-savr-sable-200 sm:hidden"
                >
                  <DotsThreeIcon aria-hidden="true" />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="top"
                className="flex w-72 flex-col p-1.5"
              >
                {secondaires.map((a) => {
                  const motif = a.desactive ? a.motif : undefined;
                  return (
                    <div key={a.cle}>
                      <Button
                        variant={
                          a.cle === 'annuler' ? 'ghost-destructive' : 'ghost'
                        }
                        className="w-full justify-start"
                        disabled={a.desactive}
                        aria-describedby={
                          motif ? `motif-menu-${a.cle}` : undefined
                        }
                        asChild={a.lien != null}
                        onClick={a.lien ? undefined : a.onClick}
                        data-testid={`menu-${a.cle}`}
                      >
                        {a.lien ? (
                          <Link href={a.lien}>{a.libelle}</Link>
                        ) : (
                          a.libelle
                        )}
                      </Button>
                      {motif && (
                        <p
                          id={`motif-menu-${a.cle}`}
                          className="px-4 pb-2 text-xs text-savr-neutral-600"
                          data-testid={`motif-menu-${a.cle}`}
                        >
                          {motif}
                        </p>
                      )}
                    </div>
                  );
                })}
              </PopoverContent>
            </Popover>
          )}
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
              className={cn('px-3', masqueTel('annuler'))}
            >
              {libelleAnnuler}
            </Button>
          )}
          {/* Écran large : « Mis à jour le … » dans l'espace libre du pied, à
              gauche du bouton de téléchargement. */}
          <span className="hidden flex-1 justify-end sm:flex">
            {miseAJour && (
              <span
                className="inline-flex items-center gap-1.5 text-xs text-savr-neutral-600"
                data-testid="rapport-mis-a-jour"
              >
                <ArrowClockwiseIcon
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                {miseAJour}
              </span>
            )}
          </span>
          {lienAjouterCollecte && (
            <Button
              asChild
              variant={principale === 'ajouter' ? 'primary' : 'sable'}
              size="pilule"
              data-testid="action-ajouter-collecte"
              className={cn(
                'max-sm:h-[52px] max-sm:flex-1',
                masqueTel('ajouter'),
              )}
            >
              <Link href={lienAjouterCollecte}>
                <PlusCircleIcon className="h-4 w-4" aria-hidden="true" />
                Ajouter une collecte à cet événement
              </Link>
            </Button>
          )}
          {rapport.visible && (
            <Button
              size="pilule"
              // Bouton principal quand la collecte ne se modifie plus (cas
              // courant : rapport disponible après la collecte).
              variant={actions.modifier === 'absent' ? 'primary' : 'sable'}
              data-testid="action-telecharger-rapport"
              disabled={rapport.desactive}
              // L'état du rapport (ex. « disponible dans les 48h après la
              // collecte ») remplace l'encadré retiré de l'onglet Bilan.
              title={motifRapport}
              loading={rapport.fabrication}
              loadingText="Préparation du PDF…"
              onClick={() => void rapport.telecharger()}
              className={cn(
                'max-sm:h-[52px] max-sm:flex-1',
                masqueTel('telecharger'),
              )}
            >
              <DownloadSimpleIcon aria-hidden="true" />
              Télécharger le rapport
            </Button>
          )}
          {actions.modifier !== 'absent' && (
            <Button
              size="pilule"
              data-testid="action-modifier"
              disabled={actions.modifier === 'grise'}
              title={actions.modifier === 'grise' ? motifGrise : undefined}
              onClick={() => setEditing(true)}
              className="max-sm:h-[52px] max-sm:flex-1"
            >
              Modifier la collecte
              <ArrowRightIcon aria-hidden="true" />
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

      <AnnulationCollecteDialog
        open={annulOpen}
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
