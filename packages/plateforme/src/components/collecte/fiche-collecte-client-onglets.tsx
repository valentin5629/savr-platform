'use client';

import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  HandHeart,
  MapPin,
  Truck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  BlocHeader,
  InfoItem,
  TelephoneLien,
} from '@/components/collecte/fiche-blocs';
import {
  STATUTS_LOGISTIQUE,
  coordonneesCompletes,
  type AssociationFiche,
  type FicheCollecteClient,
} from '@/lib/collectes/fiche-client-types';
import { Text } from '@/components/ui/text';
import { fmtInt } from '@/lib/format';

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
// seuls compléments de rôle (traiteur : programmée par, factures, régénération ;
// agence : traiteur opérationnel).
export interface FicheClientDonnees extends FicheCollecteClient {
  programmee_par?: ProgrammeePar | null;
  factures?: FactureInfo[];
  can_regenerate?: boolean;
  traiteur_operationnel?: TraiteurOperationnel | null;
}

// Libellés des organisations programmatrices tierces (§06.04 « Programmée par »).
export const TYPE_ORGA_LABEL: Record<string, string> = {
  agence: 'agence',
  gestionnaire_lieux: 'gestionnaire de lieux',
};

const GRILLE_4 =
  'grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4';

function Vide({ children = '—' }: { children?: React.ReactNode }) {
  return <span className="text-savr-neutral-400">{children}</span>;
}

// ── Informations ─────────────────────────────────────────────────────────────

export function OngletInformations({
  c,
  onProgrammeePar,
  onHorsReferentiel,
}: {
  c: FicheClientDonnees;
  onProgrammeePar: () => void;
  onHorsReferentiel: () => void;
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
  const avecSecours = Boolean(
    evt?.contact_secours_nom?.trim() || evt?.contact_secours_telephone?.trim(),
  );
  const traiteurOp = c.traiteur_operationnel;
  const progTypeLabel = c.programmee_par
    ? (TYPE_ORGA_LABEL[c.programmee_par.type] ?? c.programmee_par.type)
    : null;

  return (
    <div className="space-y-3">
      <Card padding="md" className="space-y-4" data-testid="bloc-evenement">
        <BlocHeader icon={CalendarDays} title="Événement" />
        <dl className={GRILLE_4}>
          <InfoItem label="Client">
            {evt?.nom_client_organisateur ?? <Vide />}
          </InfoItem>
          <InfoItem label="Date et heure">
            {dateCourte}
            {heure ? `, ${heure}` : ''}
          </InfoItem>
          <InfoItem label="Pax">
            {evt?.pax != null ? fmtInt(evt.pax) : <Vide />}
          </InfoItem>
          <InfoItem label="Type d’événement">
            <span className="flex flex-wrap items-center gap-2">
              {evt?.type_evenement?.libelle ?? <Vide />}
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
            <div className="sm:col-span-2" data-testid="traiteur-operationnel">
              <dt className="text-savr-neutral-500">Traiteur opérationnel</dt>
              <dd className="flex flex-wrap items-center gap-2 font-medium">
                {traiteurOp?.nom ?? <Vide />}
                {traiteurOp?.est_shadow && (
                  <button
                    type="button"
                    onClick={onHorsReferentiel}
                    data-testid="badge-hors-referentiel"
                    className="rounded-savr-full"
                  >
                    <Badge variant="warning">Hors référentiel</Badge>
                  </button>
                )}
              </dd>
            </div>
          )}
          {/* Badge « Programmée par » (§06.04, ajout 2026-05-07) : événement
              programmé par un tiers, le traiteur est l'opérationnel sur place. */}
          {c.programmee_par && (
            <div className="sm:col-span-2 lg:col-span-4">
              <button
                type="button"
                data-testid="badge-programmee-par"
                onClick={onProgrammeePar}
                className="rounded-savr-full"
              >
                <Badge variant="action">
                  Programmée par {c.programmee_par.nom} ({progTypeLabel})
                </Badge>
              </button>
            </div>
          )}
        </dl>
      </Card>

      <Card padding="md" className="space-y-4" data-testid="bloc-lieu">
        <BlocHeader icon={MapPin} title="Lieu" />
        <dl className={GRILLE_4}>
          <InfoItem label="Adresse" pleineLargeur>
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
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="text-savr-neutral-500">Instructions d’accès</dt>
            <dd className="whitespace-pre-line leading-relaxed text-savr-neutral-700">
              {instructions.length > 0 ? instructions.join('\n\n') : <Vide />}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Bloc absent pour le gestionnaire sur la collecte d'un traiteur tiers
          (§06.05 : rien de personnel sur un traiteur tiers) — décidé serveur. */}
      {evt?.contacts_visibles && (
        <Card padding="md" className="space-y-4" data-testid="bloc-contacts">
          <BlocHeader icon={Users} title="Contacts sur place" />
          <dl className={GRILLE_4}>
            <InfoItem label="Contact principal">
              {evt.contact_principal_nom ?? <Vide />}
            </InfoItem>
            <InfoItem label="Téléphone">
              <TelephoneLien telephone={evt.contact_principal_telephone} />
            </InfoItem>
            {/* Contact de secours (Q4) : ligne masquée seulement si vide. */}
            {avecSecours && (
              <>
                <InfoItem label="Contact de secours">
                  {evt.contact_secours_nom ?? <Vide />}
                </InfoItem>
                <InfoItem label="Téléphone">
                  <TelephoneLien telephone={evt.contact_secours_telephone} />
                </InfoItem>
              </>
            )}
          </dl>
        </Card>
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
      <BlocHeader icon={HandHeart} title="Association bénéficiaire" />
      <dl className={GRILLE_4}>
        <InfoItem label="Association" pleineLargeur>
          {association.nom}
        </InfoItem>
        <InfoItem label="Ville">{association.ville ?? <Vide />}</InfoItem>
        <div className="sm:col-span-2 lg:col-span-4">
          <dt className="text-savr-neutral-500">Présentation</dt>
          <dd className="leading-relaxed text-savr-neutral-700">
            {association.description?.trim() || <Vide />}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

// ── Logistique ───────────────────────────────────────────────────────────────

function EnAttente() {
  return <span className="text-savr-neutral-400">En attente</span>;
}

export function OngletLogistique({
  c,
  urgence,
  urgenceErreur,
  onDemanderUrgence,
}: {
  c: FicheClientDonnees;
  urgence: 'idle' | 'envoi' | 'envoyee';
  urgenceErreur: string | null;
  onDemanderUrgence: () => void;
}) {
  const fenetre = STATUTS_LOGISTIQUE.includes(c.statut);
  const tournees = c.tournees;
  const complet = coordonneesCompletes(tournees);
  const demandeEnvoyee =
    urgence === 'envoyee' || c.coordonnees_urgence_demandee;

  return (
    <div className="space-y-3">
      <Card padding="md" className="space-y-4" data-testid="bloc-logistique">
        <BlocHeader
          icon={Truck}
          title={
            !fenetre
              ? 'Logistique'
              : tournees.length === 0
                ? 'Chauffeur pas encore affecté'
                : tournees.length > 1
                  ? 'Vos chauffeurs'
                  : 'Votre chauffeur'
          }
        />
        {!fenetre ? (
          <Text>
            Aucune information logistique à afficher pour cette collecte.
          </Text>
        ) : tournees.length === 0 ? (
          <>
            <Text tone="soft" className="leading-relaxed">
              Nous affectons votre chauffeur avant la collecte. Son nom, la
              plaque du véhicule et son téléphone apparaîtront ici dès qu’il
              sera désigné.
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
          <div className="space-y-2">
            {tournees.map((t, i) => (
              <div
                key={i}
                data-testid="camion"
                className="rounded-savr-md border border-savr-neutral-100 bg-savr-neutral-50 px-3 py-2.5 text-sm"
              >
                {tournees.length > 1 && (
                  <p className="mb-1.5 font-medium">Camion {i + 1}</p>
                )}
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-3">
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
            className="flex flex-col gap-3 rounded-savr-md bg-savr-warning-subtle px-4 py-3 sm:flex-row sm:items-center"
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
                <Text variant="body" className="flex-1">
                  Besoin de ces informations rapidement (accès au site, liste de
                  sécurité) ?
                </Text>
                <Button
                  variant="outline-warning"
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
          <p className="text-sm text-savr-error-strong" role="alert">
            {urgenceErreur}
          </p>
        )}
      </Card>

      {c.type === 'anti_gaspi' && c.association && (
        <BlocAssociation association={c.association} />
      )}
    </div>
  );
}
