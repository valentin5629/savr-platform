'use client';

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
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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

const STATUT_PACK_BADGE: Record<string, 'success' | 'neutral' | 'error'> = {
  actif: 'success',
  epuise: 'neutral',
  annule: 'error',
};

const SIRET_BADGE: Record<string, 'success' | 'warning' | 'error'> = {
  verifie: 'success',
  en_attente: 'warning',
  echec: 'error',
};

type ModalType = 'creer' | 'ajuster' | 'annuler' | null;

const TYPES_PACK = [
  { value: 'unitaire', label: '1 collecte (Unitaire)' },
  { value: 'pack_10', label: '10 collectes' },
  { value: 'pack_30', label: '30 collectes' },
  { value: 'pack_60', label: '60 collectes' },
  { value: 'personnalise', label: 'Personnalisé' },
] as const;

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
      <h2 className="truncate text-base font-extrabold tracking-[-0.01em] text-savr-neutral-900">
        {title}
      </h2>
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
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState<OngletKey>('informations');
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
  const [fAnnulerMotif, setFAnnulerMotif] = useState('');

  useEffect(() => {
    // Durcir : vérifier res.ok AVANT de désérialiser. Sinon une réponse d'erreur
    // (404/400 → `{ error }`) était castée en OrgDetail → `org.entites_facturation`
    // undefined → `.length`/`.map` → exception client-side = écran blanc.
    fetch(`/api/v1/admin/organisations/${id}`)
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
    const r = await fetch(`/api/v1/admin/organisations/${id}`);
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
      const r = await fetch(`/api/v1/admin/packs-antgaspi/${packActif.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ajuster_credits',
          credits_initiaux: fAjusterCredits,
          motif: fAjusterMotif,
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

  async function submitAnnuler(e: React.FormEvent) {
    e.preventDefault();
    if (!packActif) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const r = await fetch(`/api/v1/admin/packs-antgaspi/${packActif.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'annuler', motif: fAnnulerMotif }),
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

  return (
    <div className="space-y-6">
      {/* En-tête — bandeau navy (levier #2 §10) : logo + nom + type + statut */}
      <PageHero
        icon={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Retour"
              className="inline-flex h-9 w-9 items-center justify-center rounded-savr-md text-savr-white transition-colors hover:bg-savr-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            {org.logo_url ? (
              <img
                src={org.logo_url}
                alt=""
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
            <Card className="p-6 space-y-4">
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

            <Card className="p-6 space-y-4">
              <BlocHeader icon={CreditCard} title="Entités de facturation" />
              {org.entites_facturation.length === 0 ? (
                <p className="text-sm text-savr-neutral-500">
                  Aucune entité de facturation.
                </p>
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
                      <span className="font-mono text-sm text-savr-neutral-500">
                        {ef.siret}
                      </span>
                      <Badge
                        variant={
                          SIRET_BADGE[ef.siret_verification] ?? 'neutral'
                        }
                        className="text-xs"
                      >
                        {ef.siret_verification}
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
            <Card className="p-6 space-y-4 md:col-span-2">
              <BlocHeader icon={Tag} title="Domaines email" />
              {org.organisations_domaines_email.length === 0 ? (
                <p className="text-sm text-savr-neutral-500">
                  Aucun domaine whitelisté pour cette organisation.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {org.organisations_domaines_email.map(({ domaine }) => (
                    <li
                      key={domaine}
                      className="rounded-savr-md bg-savr-neutral-50 px-3 py-1.5 font-mono text-sm text-savr-neutral-700"
                    >
                      @{domaine}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* Utilisateurs */}
        <TabsContent value="users">
          <Card className="p-6 space-y-4">
            <BlocHeader icon={Users} title="Utilisateurs" />
            {org.users.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title="Aucun utilisateur"
                description="Invitez le premier utilisateur."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-savr-neutral-500">
                  <tr>
                    <th className="pb-2">Nom</th>
                    <th className="pb-2">Email</th>
                    <th className="pb-2">Rôle</th>
                    <th className="pb-2">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {org.users.map((u) => (
                    <tr key={u.id} className="border-t border-savr-neutral-100">
                      <td className="py-2 font-medium">
                        {u.prenom} {u.nom}
                      </td>
                      <td className="py-2 text-savr-neutral-500">{u.email}</td>
                      <td className="py-2">
                        <Badge variant="neutral" className="text-xs">
                          {u.role}
                        </Badge>
                      </td>
                      <td className="py-2">
                        {u.actif ? (
                          <Badge variant="success" className="text-xs">
                            Actif
                          </Badge>
                        ) : (
                          <Badge variant="neutral" className="text-xs">
                            Suspendu
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              {new Date(packActif.created_at).toLocaleDateString('fr-FR')}.
            </AlertBar>
          )}

          {/* Pack actif */}
          {packActif ? (
            <Card className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-medium">Pack actif</h3>
                <div className="flex items-center gap-2">
                  <Badge variant="success">{packActif.type_pack}</Badge>
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
                      setFAnnulerMotif('');
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
            <Card className="p-6">
              <EmptyState
                icon={<Package />}
                title="Aucun pack actif"
                description="Créez un pack pour cette organisation."
              />
            </Card>
          )}

          {/* Historique */}
          {org.packs_antgaspi.length > 0 && (
            <Card className="p-6">
              <h3 className="mb-4 font-medium">Historique des packs</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-savr-neutral-500">
                  <tr>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Crédits initiaux</th>
                    <th className="pb-2">Consommés</th>
                    <th className="pb-2">Statut</th>
                    <th className="pb-2">Date achat</th>
                  </tr>
                </thead>
                <tbody>
                  {org.packs_antgaspi.map((p) => (
                    <tr key={p.id} className="border-t border-savr-neutral-100">
                      <td className="py-2 font-medium">{p.type_pack}</td>
                      <td className="py-2">{p.credits_initiaux}</td>
                      <td className="py-2">{p.credits_consommes}</td>
                      <td className="py-2">
                        <Badge
                          variant={STATUT_PACK_BADGE[p.statut] ?? 'neutral'}
                          className="text-xs"
                        >
                          {p.statut}
                        </Badge>
                      </td>
                      <td className="py-2 text-savr-neutral-500">
                        {new Date(p.created_at).toLocaleDateString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Journal des ajustements de crédits (audit_log) — rien si aucun. */}
          <PackAjustementsHistorique organisationId={id} />
        </TabsContent>

        {/* Remises négociées */}
        <TabsContent value="remises">
          <OngletRemises
            organisationId={id}
            remises={org.tarifs_negocie}
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
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModal(null)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" form="creer-pack-form" disabled={submitting}>
              {submitting ? 'Création…' : 'Créer le pack'}
            </Button>
          </>
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
            <Select
              id="pack-type"
              value={fTypePack}
              onChange={(e) => {
                const t = e.target.value;
                setFTypePack(t);
                const preset: Record<string, number> = {
                  unitaire: 1,
                  pack_10: 10,
                  pack_30: 30,
                  pack_60: 60,
                };
                if (preset[t]) setFCredits(preset[t]);
              }}
            >
              {TYPES_PACK.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
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
            <Select
              id="pack-mode"
              value={fModeFacturation}
              onChange={(e) => setFModeFacturation(e.target.value)}
            >
              <option value="par_collecte">Par collecte</option>
              <option value="globale_achat">Globale (achat forfait)</option>
            </Select>
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
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModal(null)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              form="ajuster-pack-form"
              disabled={submitting}
            >
              {submitting ? 'Enregistrement…' : 'Ajuster'}
            </Button>
          </>
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
            <p className="text-sm text-savr-neutral-500">
              Pack actif : <strong>{packActif.type_pack}</strong> —{' '}
              {packActif.credits_consommes} crédits consommés sur{' '}
              {packActif.credits_initiaux}.
            </p>
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
      <Modal
        open={modal === 'annuler'}
        title="Annuler le pack"
        onClose={() => setModal(null)}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModal(null)}
              disabled={submitting}
            >
              Retour
            </Button>
            <Button
              type="submit"
              form="annuler-pack-form"
              variant="destructive"
              disabled={submitting}
            >
              {submitting ? 'Annulation…' : "Confirmer l'annulation"}
            </Button>
          </>
        }
      >
        {formError && (
          <AlertBar variant="err" className="mb-4">
            {formError}
          </AlertBar>
        )}
        {packActif && (
          <form
            id="annuler-pack-form"
            onSubmit={(e) => void submitAnnuler(e)}
            className="space-y-4"
          >
            <p className="text-sm text-savr-neutral-500">
              Le pack <strong>{packActif.type_pack}</strong> ({creditsRestants}{' '}
              crédit{creditsRestants !== 1 ? 's' : ''} restant
              {creditsRestants !== 1 ? 's' : ''}) sera annulé définitivement.
              Les crédits non consommés seront perdus.
            </p>
            <FormField
              label="Motif (≥ 10 caractères)"
              htmlFor="annuler-motif"
              required
            >
              <Textarea
                id="annuler-motif"
                value={fAnnulerMotif}
                onChange={(e) => setFAnnulerMotif(e.target.value)}
                rows={3}
                minLength={10}
                required
              />
            </FormField>
          </form>
        )}
      </Modal>
    </div>
  );
}
