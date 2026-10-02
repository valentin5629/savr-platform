'use client';

import {
  libelleVerificationSiret,
  variantVerificationSiret,
} from '@/lib/libelles/organisation';
import {
  libelleStatutPack,
  libelleTypePack,
  variantStatutPack,
} from '@/lib/libelles/pack';
import { libelleRole } from '@/lib/libelles/role';
import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Users,
  Package,
  CreditCard,
  BarChart3,
  Tag,
  Percent,
  DollarSign,
  FlaskConical,
  ArrowLeft,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/ui/page-hero';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Textarea } from '@/components/ui/textarea';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { useUserRole } from '@/lib/use-user-role';
import {
  OngletCollectes,
  OngletFactures,
  OngletGrilleZd,
  OngletTarifRefacture,
  OngletCoefficients,
  OngletRemises,
  PackAjustementsHistorique,
} from './onglets';
import { ClientInviteUserModal } from './invite-user-modal';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { IconButton } from '@/components/ui/icon-button';
import { FormActions } from '@/components/ui/form-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface OrgDetail {
  id: string;
  raison_sociale: string;
  type: string;
  siret: string | null;
  email_principal: string | null;
  telephone: string | null;
  actif: boolean;
  logo_url: string | null;
  tarif_refacture_pax_zd: number | null;
  grille_tarifaire_zd_id: string | null;
  entites_facturation: {
    id: string;
    raison_sociale: string;
    siret: string;
    siret_verification: string;
    entite_par_defaut: boolean;
  }[];
  organisations_domaines_email: { domaine: string }[];
  users: {
    id: string;
    prenom: string;
    nom: string;
    email: string;
    role: string;
    actif: boolean;
  }[];
  packs_antgaspi: {
    id: string;
    type_pack: string;
    credits_initiaux: number;
    credits_consommes: number;
    statut: string;
    created_at: string;
  }[];
  tarifs_negocie: {
    id: string;
    activite: string;
    remise_pct: number;
    valide_du: string;
    valide_jusqu_au: string | null;
    scope: string;
    commentaires: string | null;
  }[];
  // Fiche gestionnaire de lieux : remises portées sur ses lieux + ses lieux.
  remises_gestionnaire?: {
    id: string;
    activite: string;
    remise_pct: number;
    valide_du: string;
    valide_jusqu_au: string | null;
    scope: string;
    commentaires: string | null;
    lieu_id: string | null;
    lieux: { nom: string } | null;
  }[];
  organisations_lieux?: { lieux: { id: string; nom: string } | null }[];
}

// Libellé lisible du type d'organisation (aligné sur la liste Clients).
const TYPE_LABELS: Record<string, string> = {
  traiteur: 'Traiteur',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire de lieux',
  client_organisateur: 'Client organisateur',
};

const ONGLETS = [
  { key: 'informations', label: 'Informations légales', icon: Building2 },
  { key: 'users', label: 'Utilisateurs', icon: Users },
  { key: 'packs', label: 'Packs AG', icon: Package },
  { key: 'collectes', label: 'Collectes', icon: BarChart3 },
  { key: 'factures', label: 'Factures', icon: CreditCard },
  { key: 'grille', label: 'Grille tarifaire ZD', icon: Tag },
  { key: 'remises', label: 'Remises négociées', icon: Percent },
  { key: 'tarif-refacture', label: 'Tarif refacturé', icon: DollarSign },
  { key: 'coefficients', label: 'Coeff. perte labo', icon: FlaskConical },
] as const;

type OngletKey = (typeof ONGLETS)[number]['key'];

type ModalType = 'creer' | 'ajuster' | 'annuler' | null;

const TYPES_PACK = [
  { value: 'unitaire', label: '1 collecte (Unitaire)' },
  { value: 'pack_10', label: '10 collectes' },
  { value: 'pack_30', label: '30 collectes' },
  { value: 'pack_60', label: '60 collectes' },
  { value: 'personnalise', label: 'Personnalisé' },
] as const;

type UserRow = OrgDetail['users'][number];
type PackRow = OrgDetail['packs_antgaspi'][number];

// Utilisateurs et packs sont embarqués dans la fiche organisation (route
// détail sans pagination) : listes complètes → tri navigateur.
const COLONNES_USERS: ColumnDef<UserRow, unknown>[] = [
  {
    id: 'nom',
    header: 'Nom',
    accessorFn: (u) => `${u.prenom} ${u.nom}`,
    meta: { className: 'font-medium' },
    cell: ({ row: { original: u } }) => (
      <>
        {u.prenom} {u.nom}
      </>
    ),
  },
  {
    id: 'email',
    header: 'Email',
    accessorFn: (u) => u.email,
    meta: { className: 'text-savr-neutral-500' },
    cell: ({ row: { original: u } }) => u.email,
  },
  {
    id: 'role',
    header: 'Rôle',
    accessorFn: (u) => u.role,
    cell: ({ row: { original: u } }) => (
      <Badge variant="neutral" className="text-xs">
        {libelleRole(u.role)}
      </Badge>
    ),
  },
  {
    id: 'statut',
    header: 'Statut',
    accessorFn: (u) => (u.actif ? 'Actif' : 'Suspendu'),
    cell: ({ row: { original: u } }) =>
      u.actif ? (
        <Badge variant="success" className="text-xs">
          Actif
        </Badge>
      ) : (
        <Badge variant="neutral" className="text-xs">
          Suspendu
        </Badge>
      ),
  },
];

const COLONNES_PACKS: ColumnDef<PackRow, unknown>[] = [
  {
    id: 'type',
    header: 'Type',
    accessorFn: (p) => p.type_pack,
    meta: { className: 'font-medium' },
    cell: ({ row: { original: p } }) => p.type_pack,
  },
  {
    id: 'credits_initiaux',
    header: 'Crédits initiaux',
    accessorFn: (p) => p.credits_initiaux,
    cell: ({ row: { original: p } }) => p.credits_initiaux,
  },
  {
    id: 'credits_consommes',
    header: 'Consommés',
    accessorFn: (p) => p.credits_consommes,
    cell: ({ row: { original: p } }) => p.credits_consommes,
  },
  {
    id: 'statut',
    header: 'Statut',
    accessorFn: (p) => p.statut,
    cell: ({ row: { original: p } }) => (
      <Badge variant={variantStatutPack(p.statut)} className="text-xs">
        {libelleStatutPack(p.statut)}
      </Badge>
    ),
  },
  {
    id: 'date_achat',
    header: 'Date achat',
    accessorFn: (p) => p.created_at,
    meta: { className: 'text-savr-neutral-500' },
    cell: ({ row: { original: p } }) =>
      new Date(p.created_at).toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris',
      }),
  },
];

// BlocHeader — gabarit Design System partagé avec les fiches association (#255)
// et collecte (#226/#257) : pastille primary + titre extrabold tracking serré
// (leviers §10 #2/#7).
function BlocHeader({
  icon: Icon,
  title,
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
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
  );
}

export default function ClientFichePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const role = useUserRole();
  // Édition des colonnes/onglets admin-only (tarif refacturé, grille ZD,
  // coefficient perte labo) réservée à admin_savr — ops_savr = lecture seule
  // + bandeau (§06.06 §8 ; §09 §144/§293/§359-367). Le serveur ré-applique le
  // droit (routes requireAdmin) : ce flag ne fait que masquer/désactiver l'UI.
  const canEditAdminOnly = role === 'admin_savr';
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [logoKo, setLogoKo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState<OngletKey>('informations');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [modal, setModal] = useState<ModalType>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Formulaire créer pack
  const [fTypePack, setFTypePack] = useState('pack_10');
  const [fCredits, setFCredits] = useState(10);
  const [fMontant, setFMontant] = useState('');
  const [fModeFacturation, setFModeFacturation] = useState('par_collecte');
  const [fCommentaires, setFCommentaires] = useState('');

  // Formulaire ajuster
  const [fAjusterCredits, setFAjusterCredits] = useState(0);
  const [fAjusterMotif, setFAjusterMotif] = useState('');

  // Formulaire annuler

  useEffect(() => {
    // Durcir : vérifier res.ok AVANT de désérialiser. Sinon une réponse d'erreur
    // (404/400 → `{ error }`) était castée en OrgDetail → `org.entites_facturation`
    // undefined → `.length`/`.map` → exception client-side = écran blanc.
    setLogoKo(false);
    fetch(`/api/v1/admin/organisations/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setOrg(data as OrgDetail | null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!org)
    return (
      <EmptyState
        icon={<Building2 />}
        title="Organisation introuvable"
        description="Cette organisation n'existe pas ou a été supprimée."
      />
    );

  // Onglets visibles selon le type d'organisation
  const ongletsVisibles = ONGLETS.filter((o) => {
    if (
      (o.key === 'grille' ||
        o.key === 'tarif-refacture' ||
        o.key === 'coefficients') &&
      org.type !== 'traiteur'
    )
      return false;
    return true;
  });

  const packActif = org.packs_antgaspi.find((p) => p.statut === 'actif');
  const creditsRestants = packActif
    ? packActif.credits_initiaux - packActif.credits_consommes
    : 0;

  async function refreshOrg() {
    const r = await fetch(
      `/api/v1/admin/organisations/${encodeURIComponent(id)}`,
    );
    if (!r.ok) return;
    setOrg((await r.json()) as OrgDetail);
  }

  async function submitCreerPack(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const r = await fetch('/api/v1/admin/packs-antgaspi', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          organisation_id: id,
          type_pack: fTypePack,
          credits_initiaux: fCredits,
          montant_total_ht: fMontant ? parseFloat(fMontant) : undefined,
          mode_facturation: fModeFacturation,
          commentaires: fCommentaires || undefined,
        }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setFormError(data.error ?? 'Erreur');
        return;
      }
      setModal(null);
      await refreshOrg();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAjuster(e: React.FormEvent) {
    e.preventDefault();
    if (!packActif) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const r = await fetch(
        `/api/v1/admin/packs-antgaspi/${encodeURIComponent(packActif.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'ajuster_credits',
            credits_initiaux: fAjusterCredits,
            motif: fAjusterMotif,
          }),
        },
      );
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setFormError(data.error ?? 'Erreur');
        return;
      }
      setModal(null);
      await refreshOrg();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAnnuler(motif: string) {
    if (!packActif) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const r = await fetch(
        `/api/v1/admin/packs-antgaspi/${encodeURIComponent(packActif.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'annuler', motif }),
        },
      );
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setFormError(data.error ?? 'Erreur');
        return;
      }
      setModal(null);
      await refreshOrg();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* En-tête — bandeau navy (levier #2 §10) : logo + nom + type + statut */}
      <PageHero
        icon={
          <div className="flex items-center gap-2">
            <IconButton
              size="sm"
              onClick={() => router.back()}
              aria-label="Retour"
              className="text-savr-white hover:bg-savr-white/10 hover:text-savr-white [&>svg]:h-4 [&>svg]:w-4"
            >
              <ArrowLeft />
            </IconButton>
            {org.logo_url && !logoKo ? (
              <img
                // logo_url porte une CLÉ R2, pas une URL : le proxy staff la
                // résout (clé bornée au bucket applicatif + logos/).
                src={`/api/v1/admin/uploads/logo?key=${encodeURIComponent(org.logo_url)}`}
                alt=""
                onError={() => setLogoKo(true)}
                className="h-10 w-10 rounded-savr-md border border-savr-white/20 bg-savr-white object-contain"
              />
            ) : (
              <Building2 className="h-6 w-6 text-savr-primary-200" />
            )}
          </div>
        }
        title={org.raison_sociale}
        subtitle={TYPE_LABELS[org.type] ?? org.type}
        actions={
          org.actif ? (
            <Badge variant="success">Actif</Badge>
          ) : (
            <Badge variant="neutral">Inactif</Badge>
          )
        }
      />

      {/* Navigation onglets — DS Tabs (Radix, §10 §6) */}
      <Tabs
        value={onglet}
        onValueChange={(v) => setOnglet(v as OngletKey)}
        className="space-y-6"
      >
        <TabsList className="w-full justify-start overflow-x-auto">
          {ongletsVisibles.map(({ key, label, icon: Icon }) => (
            <TabsTrigger key={key} value={key} className="gap-2">
              <Icon className="h-4 w-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Informations légales */}
        <TabsContent value="informations" className="space-y-4">
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
            <Card padding="lg" className="space-y-4">
              <BlocHeader icon={Building2} title="Informations légales" />
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-savr-neutral-500">SIREN/SIRET</dt>
                  <dd className="mt-1 font-mono font-medium">
                    {org.siret ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-savr-neutral-500">Type</dt>
                  <dd className="mt-1 font-medium">
                    {TYPE_LABELS[org.type] ?? org.type}
                  </dd>
                </div>
                <div>
                  <dt className="text-savr-neutral-500">Email</dt>
                  <dd className="mt-1 font-medium">
                    {org.email_principal ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-savr-neutral-500">Téléphone</dt>
                  <dd className="mt-1 font-medium">{org.telephone ?? '—'}</dd>
                </div>
              </dl>
            </Card>

            <Card padding="lg" className="space-y-4">
              <BlocHeader icon={CreditCard} title="Entités de facturation" />
              {org.entites_facturation.length === 0 ? (
                <Text>Aucune entité de facturation.</Text>
              ) : (
                <div className="space-y-1">
                  {org.entites_facturation.map((ef) => (
                    <div
                      key={ef.id}
                      className="flex items-center gap-3 border-b border-savr-neutral-100 py-2 last:border-0"
                    >
                      <span className="flex-1 text-sm font-medium">
                        {ef.raison_sociale}
                      </span>
                      <Text as="span" className="font-mono">
                        {ef.siret}
                      </Text>
                      <Badge
                        variant={variantVerificationSiret(
                          ef.siret_verification,
                        )}
                        className="text-xs"
                      >
                        {libelleVerificationSiret(ef.siret_verification)}
                      </Badge>
                      {ef.entite_par_defaut && (
                        <Badge variant="neutral" className="text-xs">
                          Défaut
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Domaines email — fusionnés dans « Informations légales »
                (décision Val 2026-07-03, onglet Domaines supprimé). */}
            <Card padding="lg" className="space-y-4 md:col-span-2">
              <BlocHeader icon={Tag} title="Domaines email" />
              {org.organisations_domaines_email.length === 0 ? (
                <Text>Aucun domaine whitelisté pour cette organisation.</Text>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {org.organisations_domaines_email.map(({ domaine }) => (
                    <Text
                      as="li"
                      variant="body"
                      className="rounded-savr-md bg-savr-neutral-50 px-3 py-1.5 font-mono"
                      key={domaine}
                    >
                      @{domaine}
                    </Text>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* Utilisateurs */}
        <TabsContent value="users">
          <Card padding="lg" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <BlocHeader icon={Users} title="Utilisateurs" />
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus />
                Ajouter un utilisateur
              </Button>
            </div>
            {org.users.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title="Aucun utilisateur"
                description="Invitez le premier utilisateur."
              />
            ) : (
              <DataGrid
                columnsToggle={false}
                columns={COLONNES_USERS}
                data={org.users}
                getRowId={(u) => u.id}
              />
            )}
          </Card>
        </TabsContent>

        {/* Packs AG */}
        <TabsContent value="packs" className="space-y-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                setFTypePack('pack_10');
                setFCredits(10);
                setFMontant('');
                setFModeFacturation('par_collecte');
                setFCommentaires('');
                setFormError(null);
                setModal('creer');
              }}
            >
              Créer un pack
            </Button>
          </div>

          {/* Bandeau alerte crédits faibles */}
          {packActif && creditsRestants < 5 && (
            <AlertBar variant="warn">
              Pack {packActif.type_pack} — {creditsRestants} crédit
              {creditsRestants !== 1 ? 's' : ''} restant
              {creditsRestants !== 1 ? 's' : ''}. Dernier achat :{' '}
              {new Date(packActif.created_at).toLocaleDateString('fr-FR', {
                timeZone: 'Europe/Paris',
              })}
              .
            </AlertBar>
          )}

          {/* Pack actif */}
          {packActif ? (
            <Card padding="lg">
              <div className="mb-4 flex items-center justify-between">
                <Heading
                  level={3}
                  size="inherit"
                  weight="medium"
                  tone="inherit"
                >
                  Pack actif
                </Heading>
                <div className="flex items-center gap-2">
                  <Badge variant="success">
                    {libelleTypePack(packActif.type_pack)}
                  </Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFAjusterCredits(packActif.credits_initiaux);
                      setFAjusterMotif('');
                      setFormError(null);
                      setModal('ajuster');
                    }}
                  >
                    Ajuster crédits
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setFormError(null);
                      setModal('annuler');
                    }}
                  >
                    Annuler le pack
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-savr-neutral-500">
                    Crédits restants
                  </span>
                  <span className="font-medium">
                    {creditsRestants} / {packActif.credits_initiaux}
                  </span>
                </div>
                <div className="h-2 w-full rounded-savr-full bg-savr-neutral-100">
                  <div
                    className="h-2 rounded-savr-full bg-savr-primary-600"
                    style={{
                      width: `${Math.round((packActif.credits_consommes / packActif.credits_initiaux) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </Card>
          ) : (
            <Card padding="lg">
              <EmptyState
                icon={<Package />}
                title="Aucun pack actif"
                description="Créez un pack pour cette organisation."
              />
            </Card>
          )}

          {/* Historique */}
          {org.packs_antgaspi.length > 0 && (
            <Card padding="lg">
              <Heading
                level={3}
                size="inherit"
                weight="medium"
                tone="inherit"
                className="mb-4"
              >
                Historique des packs
              </Heading>
              <DataGrid
                columnsToggle={false}
                columns={COLONNES_PACKS}
                data={org.packs_antgaspi}
                getRowId={(p) => p.id}
                initialSorting={[{ id: 'date_achat', desc: true }]}
              />
            </Card>
          )}

          {/* Journal des ajustements de crédits (audit_log) — rien si aucun. */}
          <PackAjustementsHistorique organisationId={id} />
        </TabsContent>

        {/* Remises négociées */}
        <TabsContent value="remises">
          <OngletRemises
            organisationId={id}
            organisationType={org.type}
            lieuxGestionnaire={(org.organisations_lieux ?? [])
              .map((ol) => ol.lieux)
              .filter((l): l is { id: string; nom: string } => l !== null)
              .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))}
            remises={[
              ...(org.remises_gestionnaire ?? []),
              ...org.tarifs_negocie,
            ]}
            canEdit={canEditAdminOnly}
            onUpdated={() => void refreshOrg()}
          />
        </TabsContent>

        {/* Collectes */}
        <TabsContent value="collectes">
          <OngletCollectes organisationId={id} />
        </TabsContent>

        {/* Factures */}
        <TabsContent value="factures">
          <OngletFactures organisationId={id} />
        </TabsContent>

        {/* Grille tarifaire ZD (traiteur only) */}
        {org.type === 'traiteur' && (
          <TabsContent value="grille">
            <OngletGrilleZd
              organisationId={id}
              grilleId={org.grille_tarifaire_zd_id}
              canEdit={canEditAdminOnly}
              onUpdated={() => void refreshOrg()}
            />
          </TabsContent>
        )}

        {/* Tarif refacturé (traiteur only) */}
        {org.type === 'traiteur' && (
          <TabsContent value="tarif-refacture">
            <OngletTarifRefacture
              organisationId={id}
              value={org.tarif_refacture_pax_zd}
              canEdit={canEditAdminOnly}
              onUpdated={() => void refreshOrg()}
            />
          </TabsContent>
        )}

        {/* Coefficient perte labo (traiteur only) */}
        {org.type === 'traiteur' && (
          <TabsContent value="coefficients">
            <OngletCoefficients
              organisationId={id}
              canEdit={canEditAdminOnly}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* ── Modale : Créer un pack AG ─────────────────────────────────────── */}
      <Modal
        open={modal === 'creer'}
        title="Créer un pack AG"
        onClose={() => setModal(null)}
        footer={
          <FormActions
            cancel={{ label: 'Annuler', onClick: () => setModal(null) }}
            submit={{ label: 'Créer le pack', form: 'creer-pack-form' }}
            loading={submitting}
            loadingText="Création…"
          />
        }
      >
        {formError && (
          <AlertBar variant="err" className="mb-4">
            {formError}
          </AlertBar>
        )}
        <form
          id="creer-pack-form"
          onSubmit={(e) => void submitCreerPack(e)}
          className="space-y-4"
        >
          <FormField label="Type de pack" htmlFor="pack-type">
            <Combobox
              id="pack-type"
              icon={null}
              options={TYPES_PACK.map((t) => ({
                value: t.value,
                label: t.label,
              }))}
              value={fTypePack}
              onChange={(t) => {
                setFTypePack(t);
                const preset: Record<string, number> = {
                  unitaire: 1,
                  pack_10: 10,
                  pack_30: 30,
                  pack_60: 60,
                };
                if (preset[t]) setFCredits(preset[t]);
              }}
            />
          </FormField>
          <FormField label="Crédits initiaux" htmlFor="pack-credits" required>
            <Input
              id="pack-credits"
              type="number"
              min={1}
              value={fCredits}
              onChange={(e) => setFCredits(parseInt(e.target.value) || 1)}
              required
            />
          </FormField>
          <FormField label="Montant total HT (€)" htmlFor="pack-montant">
            <Input
              id="pack-montant"
              type="number"
              min={0}
              step="0.01"
              value={fMontant}
              onChange={(e) => setFMontant(e.target.value)}
              placeholder="Optionnel"
            />
          </FormField>
          <FormField label="Mode de facturation" htmlFor="pack-mode">
            <Combobox
              id="pack-mode"
              icon={null}
              options={[
                { value: 'par_collecte', label: 'Par collecte' },
                { value: 'globale_achat', label: 'Globale (achat forfait)' },
              ]}
              value={fModeFacturation}
              onChange={setFModeFacturation}
            />
          </FormField>
          <FormField label="Commentaires" htmlFor="pack-commentaires">
            <Textarea
              id="pack-commentaires"
              value={fCommentaires}
              onChange={(e) => setFCommentaires(e.target.value)}
              rows={2}
              placeholder="Optionnel"
            />
          </FormField>
        </form>
      </Modal>

      {/* ── Modale : Ajuster crédits ──────────────────────────────────────── */}
      <Modal
        open={modal === 'ajuster'}
        title="Ajuster les crédits"
        onClose={() => setModal(null)}
        footer={
          <FormActions
            cancel={{ label: 'Annuler', onClick: () => setModal(null) }}
            submit={{ label: 'Ajuster', form: 'ajuster-pack-form' }}
            loading={submitting}
            loadingText="Enregistrement…"
          />
        }
      >
        {formError && (
          <AlertBar variant="err" className="mb-4">
            {formError}
          </AlertBar>
        )}
        {packActif && (
          <form
            id="ajuster-pack-form"
            onSubmit={(e) => void submitAjuster(e)}
            className="space-y-4"
          >
            <Text>
              Pack actif : <strong>{packActif.type_pack}</strong> —{' '}
              {packActif.credits_consommes} crédits consommés sur{' '}
              {packActif.credits_initiaux}.
            </Text>
            <FormField
              label="Nouveau total de crédits initiaux"
              htmlFor="ajuster-credits"
              required
            >
              <Input
                id="ajuster-credits"
                type="number"
                min={0}
                value={fAjusterCredits}
                onChange={(e) =>
                  setFAjusterCredits(parseInt(e.target.value) || 0)
                }
                required
              />
              {fAjusterCredits < packActif.credits_consommes && (
                <p className="mt-1 text-xs text-savr-warning-strong">
                  Valeur inférieure aux crédits consommés — le pack passera en
                  épuisé.
                </p>
              )}
            </FormField>
            <FormField
              label="Motif (≥ 10 caractères)"
              htmlFor="ajuster-motif"
              required
            >
              <Textarea
                id="ajuster-motif"
                value={fAjusterMotif}
                onChange={(e) => setFAjusterMotif(e.target.value)}
                rows={2}
                minLength={10}
                required
              />
            </FormField>
          </form>
        )}
      </Modal>

      {/* ── Modale : Annuler le pack ──────────────────────────────────────── */}
      <ConfirmDialog
        open={modal === 'annuler'}
        title="Annuler le pack"
        confirmLabel="Confirmer l’annulation"
        cancelLabel="Retour"
        variant="destructive"
        loading={submitting}
        loadingText="Annulation…"
        error={formError}
        motif={{ label: 'Motif', minLength: 10 }}
        onConfirm={(motif) => void submitAnnuler(motif)}
        onCancel={() => setModal(null)}
      >
        {packActif && (
          <Text>
            Le pack <strong>{packActif.type_pack}</strong> ({creditsRestants}{' '}
            crédit{creditsRestants !== 1 ? 's' : ''} restant
            {creditsRestants !== 1 ? 's' : ''}) sera annulé définitivement. Les
            crédits non consommés seront perdus.
          </Text>
        )}
      </ConfirmDialog>

      {/* ── Modale : Ajouter un utilisateur (org imposée = la fiche) ───────── */}
      {inviteOpen && (
        <ClientInviteUserModal
          organisationId={id}
          orgType={org.type}
          onClose={() => setInviteOpen(false)}
          onCreated={() => {
            setInviteOpen(false);
            void refreshOrg();
          }}
        />
      )}
    </div>
  );
}
