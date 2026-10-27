'use client';

import { BellRing, CheckCircle2, HandHeart, Plus } from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Badge, BadgeBouton } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TelephoneLien } from '@/components/collecte/fiche-blocs';
import { SectionHeader } from '@/components/ui/section-header';
import { InfoItem } from '@/components/ui/info-item';
import {
  STATUTS_LOGISTIQUE,
  coordonneesCompletes,
  type AssociationFiche,
  type FicheCollecteClient,
} from '@/lib/collectes/fiche-client-types';
import { Text } from '@/components/ui/text';
import { fmtInt } from '@/lib/format';
import { libelleTypeOrganisationMinuscule } from '@/lib/libelles/organisation';

// Onglets Informations et Logistique du pop-up fiche collecte CLIENT (§06.04
// « Fiche collecte (vue détail) », refonte Val 2026-09-29). Wording 100 % Savr :
// aucun libellé ne mentionne le transporteur ni un prestataire (marque blanche).

export interface ProgrammeePar {
  nom: string;
  type: string;
  email: string | null;
}

export interface TraiteurOperationnel {
  id: string;
  nom: string | null;
  est_shadow: boolean;
  siret: string | null;
}

export interface FactureInfo {
  id: string;
  numero_facture: string;
  statut: string;
  pdf_url_savr: string | null;
  pdf_url_pennylane: string | null;
}

// Réponse des routes GET /api/v1/{espace}/collectes/[id] : socle commun + les
// seuls compléments de rôle (traiteur : programmée par, factures ; agence :
// traiteur opérationnel).
export interface FicheClientDonnees extends FicheCollecteClient {
  programmee_par?: ProgrammeePar | null;
  factures?: FactureInfo[];
  traiteur_operationnel?: TraiteurOperationnel | null;
}

const GRILLE_4 =
  'grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4';

function Vide({ children = '—' }: { children?: React.ReactNode }) {
  return <span className="text-savr-neutral-400">{children}</span>;
}

// ── Informations ─────────────────────────────────────────────────────────────

// Variante B (décision Val 2026-10-27) : une section par ligne, libellé à
// gauche, champs sur trois colonnes à droite, filets sable entre les sections.
// Reprise par la fiche collecte Admin (décision Val 2026-10-27), qui pose sous
// le libellé un badge ou une action de section (`action`).
export function SectionInfos({
  titre,
  action,
  children,
  ...props
}: {
  titre: string;
  action?: React.ReactNode;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className="grid gap-x-10 gap-y-4 border-t border-savr-sable-200 py-6 first:border-t-0 first:pt-0 sm:py-7 md:grid-cols-[13rem_minmax(0,1fr)]"
      {...props}
    >
      {action ? (
        <div className="flex flex-wrap items-start gap-3 md:flex-col">
          <h4 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-savr-neutral-900">
            {titre}
          </h4>
          {action}
        </div>
      ) : (
        <h4 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-savr-neutral-900">
          {titre}
        </h4>
      )}
      {children}
    </section>
  );
}

export const GRILLE_3 =
  'grid grid-cols-1 gap-x-10 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3';

function initiales(nom: string | null | undefined): string {
  return (nom ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m.charAt(0).toUpperCase())
    .join('');
}

export function CarteContact({
  nom,
  telephone,
  role,
}: {
  nom: string | null | undefined;
  telephone: string | null | undefined;
  role: string;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span
        aria-hidden="true"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-savr-full bg-savr-primary-50 font-display text-sm font-semibold text-savr-primary-700"
      >
        {initiales(nom) || '—'}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="font-semibold text-savr-neutral-900">
          {nom?.trim() || <Vide />}
        </span>
        <span className="text-sm text-savr-neutral-600">
          <TelephoneLien telephone={telephone} />
        </span>
        <span className="text-xs text-savr-neutral-500">{role}</span>
      </span>
    </div>
  );
}

// Bouton « Ajouter un contact de secours » de la variante B (Val 2026-10-27) :
// fiche client (ouvre l'édition) et fiche Admin (ouvre la fenêtre des contacts).
export function AjoutContactSecours({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      data-testid="action-ajouter-contact-secours"
      className="h-auto justify-start gap-3.5 whitespace-normal rounded-savr-lg p-0 text-left font-normal text-savr-accent-700 hover:bg-transparent hover:text-savr-accent-800 active:bg-transparent"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-savr-full border-[1.5px] border-dashed border-savr-accent-400"
      >
        <Plus className="h-4 w-4" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">
          Ajouter un contact de secours
        </span>
        <span className="text-sm text-savr-neutral-500">
          À compléter avant la collecte
        </span>
      </span>
    </Button>
  );
}

export function OngletInformations({
  c,
  onProgrammeePar,
  onHorsReferentiel,
  onAjouterSecours,
}: {
  c: FicheClientDonnees;
  onProgrammeePar: () => void;
  onHorsReferentiel: () => void;
  /** Ouvre l'édition de la collecte ; absent si l'utilisateur ne peut pas la
   *  modifier (bouton « Ajouter un contact de secours » masqué). */
  onAjouterSecours?: () => void;
}) {
  const evt = c.evenement;
  const lieu = evt?.lieu ?? null;
  const heure = c.heure_collecte?.slice(0, 5) ?? null;
  const dateCourte = new Date(c.date_collecte).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });
  const adresse = [lieu?.adresse_acces, lieu?.code_postal, lieu?.ville]
    .filter(Boolean)
    .join(' ');
  // Instructions d'accès : détails d'accès EFFECTIFS du lieu (référence +
  // surcharge de la collecte) puis informations saisies pour la collecte.
  const instructions = [lieu?.acces_details, c.informations_supplementaires]
    .map((v) => v?.trim())
    .filter(Boolean);
  // Contacts et type d'événement : ceux de LA collecte (lot B1).
  const avecSecours = Boolean(
    c.contact_secours_nom?.trim() || c.contact_secours_telephone?.trim(),
  );
  const traiteurOp = c.traiteur_operationnel;
  const progTypeLabel = c.programmee_par
    ? libelleTypeOrganisationMinuscule(c.programmee_par.type)
    : null;

  return (
    <div>
      <SectionInfos titre="Événement" data-testid="bloc-evenement">
        <dl className={GRILLE_3}>
          <InfoItem label="Client">
            {evt?.nom_client_organisateur ?? <Vide />}
          </InfoItem>
          <InfoItem label="Date et heure">
            {dateCourte}
            {heure ? `, ${heure}` : ''}
          </InfoItem>
          <InfoItem label="Pax">{fmtInt(c.pax)}</InfoItem>
          <InfoItem label="Type d’événement">
            <span className="flex flex-wrap items-center gap-2">
              {c.type_evenement?.libelle ?? <Vide />}
              {c.taille_bracket && (
                <Badge
                  variant="neutral"
                  dot={false}
                  title={`Taille de l’événement (calculée sur le nombre de convives) : ${c.taille_bracket}`}
                >
                  {c.taille_bracket}
                </Badge>
              )}
            </span>
          </InfoItem>
          {/* §06.11 différence #3 : l'agence voit qui opère sur place. */}
          {c.traiteur_operationnel !== undefined && (
            <InfoItem
              label="Traiteur opérationnel"
              data-testid="traiteur-operationnel"
              valueClassName="flex flex-wrap items-center gap-2"
            >
              {traiteurOp?.nom ?? <Vide />}
              {traiteurOp?.est_shadow && (
                <BadgeBouton
                  variant="warning"
                  onClick={onHorsReferentiel}
                  data-testid="badge-hors-referentiel"
                >
                  Hors référentiel
                </BadgeBouton>
              )}
            </InfoItem>
          )}
          {/* Badge « Programmée par » (§06.04, ajout 2026-05-07) : événement
              programmé par un tiers, le traiteur est l'opérationnel sur place. */}
          {c.programmee_par && (
            <div className="sm:col-span-2 lg:col-span-3">
              <BadgeBouton
                variant="action"
                data-testid="badge-programmee-par"
                onClick={onProgrammeePar}
              >
                Programmée par {c.programmee_par.nom} ({progTypeLabel})
              </BadgeBouton>
            </div>
          )}
        </dl>
      </SectionInfos>

      <SectionInfos titre="Lieu et accès" data-testid="bloc-lieu">
        <dl className={GRILLE_3}>
          <InfoItem label="Adresse">
            {lieu?.nom ?? <Vide />}
            {adresse && (
              <span className="block font-normal text-savr-neutral-600">
                {adresse}
              </span>
            )}
          </InfoItem>
          <InfoItem label="Contrôle d’accès">
            {c.controle_acces_requis ? 'Oui' : 'Non'}
          </InfoItem>
          <InfoItem
            variant="texte"
            label="Instructions d’accès"
            valueClassName="whitespace-pre-line"
          >
            {instructions.length > 0 ? instructions.join('\n\n') : <Vide />}
          </InfoItem>
        </dl>
      </SectionInfos>

      {/* Bloc absent pour le gestionnaire sur la collecte d'un traiteur tiers
          (§06.05 : rien de personnel sur un traiteur tiers) — décidé serveur. */}
      {c.contacts_visibles && (
        <SectionInfos titre="Contacts sur place" data-testid="bloc-contacts">
          <div className={GRILLE_3}>
            <CarteContact
              nom={c.contact_principal_nom}
              telephone={c.contact_principal_telephone}
              role="Contact principal"
            />
            {/* Contact de secours (Q4) : affiché s'il est renseigné ; sinon,
                bouton d'ajout pour qui peut modifier la collecte (Val
                2026-10-27), rien pour les autres. */}
            {avecSecours ? (
              <CarteContact
                nom={c.contact_secours_nom}
                telephone={c.contact_secours_telephone}
                role="Contact de secours"
              />
            ) : (
              onAjouterSecours && (
                <AjoutContactSecours onClick={onAjouterSecours} />
              )
            )}
          </div>
        </SectionInfos>
      )}
    </div>
  );
}

// ── Association bénéficiaire (AG) ────────────────────────────────────────────

export function BlocAssociation({
  association,
}: {
  association: AssociationFiche;
}) {
  return (
    <Card padding="md" className="space-y-4" data-testid="bloc-association">
      <SectionHeader icon={HandHeart} title="Association bénéficiaire" />
      <dl className={GRILLE_4}>
        <InfoItem label="Association" pleineLargeur>
          {association.nom}
        </InfoItem>
        <InfoItem label="Ville">{association.ville ?? <Vide />}</InfoItem>
        <InfoItem
          variant="texte"
          label="Présentation"
          className="sm:col-span-2 lg:col-span-4"
        >
          {association.description?.trim() || <Vide />}
        </InfoItem>
      </dl>
    </Card>
  );
}

// ── Logistique ───────────────────────────────────────────────────────────────

// Lignes « libellé à gauche, valeur à droite » d'un camion (variante B).
const LIGNES_CAMION =
  'divide-y divide-savr-sable-200 text-sm [&>div]:flex [&>div]:items-baseline [&>div]:justify-between [&>div]:gap-4 [&>div]:py-3 [&>div>dd]:text-right';

function EnAttente() {
  return <span className="text-savr-neutral-400">En attente</span>;
}

interface PropsChauffeurs {
  c: FicheCollecteClient;
  urgence: 'idle' | 'envoi' | 'envoyee';
  urgenceErreur: string | null;
  onDemanderUrgence: () => void;
  /** `variante-b` : onglet Logistique de la fiche client (Val 2026-10-27). */
  presentation?: 'standard' | 'variante-b';
}

// Variante B (décision Val 2026-10-27) : la section « Vos chauffeurs » seule
// (ni suivi en temps réel, ni association : C3, l'association n'est pas
// affichée avant la collecte), libellé à gauche, camions sur deux colonnes,
// demande urgente discrète sur sa propre ligne, centrée sur la largeur.
export function OngletLogistique(props: PropsChauffeurs) {
  const fenetre = STATUTS_LOGISTIQUE.includes(props.c.statut);
  const tournees = props.c.tournees;
  const titre = !fenetre
    ? 'Logistique'
    : tournees.length === 0
      ? 'Chauffeur pas encore affecté'
      : tournees.length > 1
        ? 'Vos chauffeurs'
        : 'Votre chauffeur';
  return (
    <div data-testid="bloc-logistique">
      <SectionInfos titre={titre}>
        <div className="min-w-0">
          <Chauffeurs {...props} presentation="variante-b" />
        </div>
      </SectionInfos>
    </div>
  );
}

/**
 * Coordonnées du chauffeur d'une collecte, par camion, et demande urgente.
 * Reprises dans la carte de chaque collecte de la fiche événement du
 * gestionnaire (décision Val 2026-10-26).
 */
export function Chauffeurs({
  c,
  urgence,
  urgenceErreur,
  onDemanderUrgence,
  presentation = 'standard',
}: PropsChauffeurs) {
  const vb = presentation === 'variante-b';
  const fenetre = STATUTS_LOGISTIQUE.includes(c.statut);
  const tournees = c.tournees;
  const complet = coordonneesCompletes(tournees);
  const demandeEnvoyee =
    urgence === 'envoyee' || c.coordonnees_urgence_demandee;

  return (
    <>
      {!fenetre ? (
        <EmptyState
          size="inline"
          title="Aucune information logistique à afficher pour cette collecte."
        />
      ) : tournees.length === 0 ? (
        <>
          <Text tone="soft" className="leading-relaxed">
            Nous affectons votre chauffeur avant la collecte. Son nom, la plaque
            du véhicule et son téléphone apparaîtront ici dès qu’il sera
            désigné.
          </Text>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-dashed border-savr-neutral-200 pt-4 text-sm sm:grid-cols-3">
            <InfoItem label="Chauffeur">
              <Vide />
            </InfoItem>
            <InfoItem label="Plaque">
              <Vide />
            </InfoItem>
            <InfoItem label="Téléphone">
              <Vide />
            </InfoItem>
          </dl>
        </>
      ) : (
        <div
          className={
            vb
              ? 'grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2'
              : 'space-y-2'
          }
        >
          {tournees.map((t, i) => (
            <div
              key={i}
              data-testid="camion"
              className={
                vb
                  ? 'flex min-w-0 flex-col gap-3'
                  : 'rounded-savr-md border border-savr-neutral-100 bg-savr-neutral-50 px-3 py-2.5 text-sm'
              }
            >
              {tournees.length > 1 && (
                <p
                  className={
                    vb
                      ? 'font-display text-[15px] font-semibold text-savr-neutral-900'
                      : 'mb-1.5 font-medium'
                  }
                >
                  Camion {i + 1}
                </p>
              )}
              <dl
                className={
                  vb
                    ? LIGNES_CAMION
                    : 'grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-3'
                }
              >
                <InfoItem label="Chauffeur">
                  {t.chauffeur_nom?.trim() || <EnAttente />}
                </InfoItem>
                <InfoItem label="Plaque d’immatriculation">
                  {t.plaque_immatriculation?.trim() ||
                    (t.type_vehicule === 'velo_cargo' ? (
                      // Vélo cargo : jamais de plaque, jamais « En attente ».
                      <span className="text-savr-neutral-400">
                        Sans objet (vélo cargo)
                      </span>
                    ) : (
                      <EnAttente />
                    ))}
                </InfoItem>
                <InfoItem label="Téléphone">
                  {t.chauffeur_telephone?.trim() ? (
                    <TelephoneLien telephone={t.chauffeur_telephone} />
                  ) : (
                    <EnAttente />
                  )}
                </InfoItem>
              </dl>
            </div>
          ))}
        </div>
      )}

      {/* Demande urgente (Q3) : alerte in-app Ops seule, 1 par collecte. */}
      {fenetre && !complet && (
        <div
          data-testid="zone-urgence"
          // Mobile : bouton pleine largeur sous le texte. Au-delà, sur une
          // ligne, qui passe à la ligne si la place manque (carte étroite de la
          // fiche événement).
          className={
            vb
              ? 'mt-8 flex flex-col items-center justify-center gap-4 rounded-savr-xl border border-savr-sable-200 bg-savr-sable-50 px-5 py-4 text-center sm:flex-row sm:text-left md:-ml-[15.5rem]'
              : 'flex flex-col gap-3 rounded-savr-md bg-savr-warning-subtle px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center'
          }
        >
          {demandeEnvoyee ? (
            <Text
              variant="body"
              className="flex flex-1 items-start gap-2"
              role="status"
            >
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-savr-success-strong"
                aria-hidden="true"
              />
              <span>
                <strong className="text-savr-neutral-900">
                  Demande envoyée à l’équipe Savr.
                </strong>{' '}
                Nous revenons vers vous au plus vite avec les coordonnées du
                chauffeur.
              </span>
            </Text>
          ) : (
            <>
              <Text
                variant="body"
                className={
                  vb ? 'text-savr-neutral-600' : 'min-w-[14rem] flex-1'
                }
              >
                Besoin de ces informations rapidement (accès au site, liste de
                sécurité) ?
              </Text>
              <Button
                variant="outline-warning"
                size={vb ? 'pilule' : undefined}
                onClick={onDemanderUrgence}
                disabled={urgence === 'envoi'}
              >
                <BellRing className="h-4 w-4" aria-hidden="true" />
                Demander les coordonnées en urgence
              </Button>
            </>
          )}
        </div>
      )}
      {urgenceErreur && (
        <AlertBar variant="err" role="alert">
          {urgenceErreur}
        </AlertBar>
      )}
    </>
  );
}
