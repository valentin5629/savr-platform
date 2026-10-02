'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { CalendarDays, Pencil, Users, XCircle } from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EditerCollecteForm } from '@/components/collecte/editer-collecte-form';
import type { FicheCollecteMeta } from '@/components/collecte/fiche-collecte-modal-cadre';
import { FriseStatutClient } from '@/components/collecte/frise-statut-client';
import {
  OngletInformations,
  OngletLogistique,
  TYPE_ORGA_LABEL,
  type FicheClientDonnees,
} from '@/components/collecte/fiche-collecte-client-onglets';
import { OngletBilan } from '@/components/collecte/fiche-collecte-client-bilan';
import {
  BadgeTypeCollecte,
  dateLongueCapitalisee,
  EnTeteMention,
  FicheEnTete,
  typeCollecteLabel,
} from '@/components/collecte/fiche-blocs';
import { refCourteCollecte } from '@/lib/collecte-ref';
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

type Onglet = 'informations' | 'logistique' | 'bilan';

interface FicheCollecteClientPanelProps {
  espace: EspaceClient;
  collecteId: string;
  // Ouverture directe en édition (action « Modifier » de la liste, ?edit=1).
  initialEditing?: boolean;
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
  onLoaded,
  blockCloseRef,
}: FicheCollecteClientPanelProps) {
  const base = `/api/v1/${encodeURIComponent(espace)}/collectes/${encodeURIComponent(id)}`;
  const [c, setC] = useState<FicheClientDonnees | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [editing, setEditing] = useState(initialEditing);
  const [onglet, setOnglet] = useState<Onglet>('informations');

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
        `Collecte ${typeCollecteLabel(c.type)}`,
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
      <div className="space-y-4 p-6" data-testid="fiche-erreur">
        <AlertBar variant="err">{erreur}</AlertBar>
        <Button
          variant="secondary"
          onClick={() => {
            setLoading(true);
            reload();
          }}
        >
          Réessayer
        </Button>
      </div>
    );
  if (!c) return <p className="p-6 text-sm">Collecte introuvable.</p>;

  const evt = c.evenement;
  const lieu = evt?.lieu ?? null;
  const heure = c.heure_collecte?.slice(0, 5) ?? null;
  const { actions } = c;
  const demande = actions.annulation === 'demande';
  const piedVisible =
    !editing && (actions.annuler !== 'absent' || actions.modifier !== 'absent');
  const motifGrise =
    espace === 'traiteur'
      ? 'Seul le créateur de la collecte ou un manager peut la modifier.'
      : 'Seule l’organisation qui a programmé la collecte peut la modifier.';
  const progTypeLabel = c.programmee_par
    ? (TYPE_ORGA_LABEL[c.programmee_par.type] ?? c.programmee_par.type)
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FicheEnTete
        surtitre={
          <>
            <BadgeTypeCollecte type={c.type} />
            <EnTeteMention>Réf. {refCourteCollecte(c)}</EnTeteMention>
          </>
        }
        titre={lieu?.nom ?? 'Collecte'}
        infosTestId="fiche-sous-ligne"
        infos={[
          {
            icon: CalendarDays,
            texte: `${dateLongueCapitalisee(c.date_collecte)}${heure ? ` · ${heure}` : ''}`,
          },
          {
            icon: Users,
            texte: evt?.pax != null ? fmtPax(evt.pax) : '— pax',
          },
        ]}
        statut={<FriseStatutClient statut={c.statut} />}
        statutLarge
      />

      {editing && evt ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-8">
          <EditerCollecteForm
            collecte={{
              id: c.id,
              type: c.type,
              statut: c.statut,
              statut_tms: c.statut_tms,
              date_collecte: c.date_collecte,
              heure_collecte: c.heure_collecte,
              controle_acces_requis: c.controle_acces_requis,
              informations_supplementaires: c.informations_supplementaires,
              lieu_nom: lieu?.nom ?? null,
              evenement: {
                id: evt.id,
                nom_evenement: evt.nom_evenement,
                pax: evt.pax,
                type_evenement_id: evt.type_evenement_id,
                nom_client_organisateur: evt.nom_client_organisateur,
                reference_affaire: evt.reference_affaire,
                contact_principal_nom: evt.contact_principal_nom,
                contact_principal_telephone: evt.contact_principal_telephone,
                contact_secours_nom: evt.contact_secours_nom,
                contact_secours_telephone: evt.contact_secours_telephone,
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
        </div>
      ) : (
        // Même barre d'onglets horizontale que les fiches Admin (décision Val
        // 2026-10-01), fixe au défilement du corps.
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 md:px-8">
          <Tabs value={onglet} onValueChange={(v) => setOnglet(v as Onglet)}>
            <TabsList
              aria-label="Sections de la fiche collecte"
              className="sticky top-0 z-10 w-full overflow-x-auto bg-savr-white"
            >
              <TabsTrigger value="informations" className="px-3 sm:px-4">
                Informations
              </TabsTrigger>
              <TabsTrigger value="logistique" className="px-3 sm:px-4">
                Logistique
              </TabsTrigger>
              <TabsTrigger value="bilan" className="px-3 sm:px-4">
                Bilan & documents
              </TabsTrigger>
            </TabsList>

            {!c.informations_completes && (
              <AlertBar
                variant="warn"
                className="mt-4"
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
          </Tabs>
        </div>
      )}

      {piedVisible && (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-savr-neutral-200 px-6 py-4 md:px-8">
          {actions.annuler !== 'absent' && (
            <Button
              variant="outline-destructive"
              data-testid="action-annuler"
              disabled={actions.annuler === 'grise'}
              title={actions.annuler === 'grise' ? motifGrise : undefined}
              onClick={() => {
                setAnnulErreur(null);
                setAnnulOpen(true);
              }}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              {demande ? 'Demander l’annulation' : 'Annuler la collecte'}
            </Button>
          )}
          {actions.modifier !== 'absent' && (
            <Button
              data-testid="action-modifier"
              disabled={actions.modifier === 'grise'}
              title={actions.modifier === 'grise' ? motifGrise : undefined}
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Modifier la collecte
            </Button>
          )}
        </footer>
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
              disabled: siretEnCours || siret.length !== 14,
              onClick: () => void enregistrerSiret(),
            }}
            bordered
          />
        </div>
      </Modal>
    </div>
  );
}
