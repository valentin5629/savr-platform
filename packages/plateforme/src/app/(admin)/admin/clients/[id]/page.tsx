'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
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
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/lib/use-user-role';
import {
  OngletCollectes,
  OngletFactures,
  OngletGrilleZd,
  OngletTarifRefacture,
  OngletCoefficients,
  OngletRemises,
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

export default function ClientFichePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
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
        <Skeleton className="h-8 w-64" />
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
      {/* En-tête */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {org.logo_url ? (
            <img
              src={org.logo_url}
              alt=""
              className="w-12 h-12 rounded-lg object-contain border border-neutral-200"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-neutral-100 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-neutral-400" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold text-savr-primary-950">
              {org.raison_sociale}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="neutral">{org.type}</Badge>
              {org.actif ? (
                <Badge variant="success">Actif</Badge>
              ) : (
                <Badge variant="neutral">Inactif</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation onglets */}
      <nav className="flex gap-1 border-b border-neutral-200 overflow-x-auto">
        {ongletsVisibles.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setOnglet(key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              onglet === key
                ? 'border-savr-primary-700 text-savr-primary-700'
                : 'border-transparent text-neutral-500 hover:text-neutral-900'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>

      {/* Contenu onglet */}
      <div>
        {onglet === 'informations' && (
          <Card className="p-6 space-y-4">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-neutral-500">SIREN/SIRET</dt>
                <dd className="font-mono mt-1">{org.siret ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Email</dt>
                <dd className="mt-1">{org.email_principal ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Téléphone</dt>
                <dd className="mt-1">{org.telephone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Type</dt>
                <dd className="mt-1">{org.type}</dd>
              </div>
            </dl>
            {org.entites_facturation.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">Entités de facturation</h3>
                {org.entites_facturation.map((ef) => (
                  <div
                    key={ef.id}
                    className="flex items-center gap-3 py-2 border-b border-neutral-100 last:border-0"
                  >
                    <span className="flex-1 text-sm">{ef.raison_sociale}</span>
                    <span className="font-mono text-sm text-neutral-500">
                      {ef.siret}
                    </span>
                    <Badge
                      variant={SIRET_BADGE[ef.siret_verification] ?? 'neutral'}
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
            {/* Domaines email — fusionnés dans « Informations légales »
                (décision Val 2026-07-03, onglet Domaines supprimé). */}
            <div>
              <h3 className="font-medium mb-2">Domaines email</h3>
              {org.organisations_domaines_email.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Aucun domaine whitelisté pour cette organisation.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {org.organisations_domaines_email.map(({ domaine }) => (
                    <li
                      key={domaine}
                      className="text-sm font-mono bg-neutral-50 px-3 py-1.5 rounded"
                    >
                      @{domaine}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}

        {onglet === 'users' && (
          <Card className="p-6">
            {org.users.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title="Aucun utilisateur"
                description="Invitez le premier utilisateur."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="pb-2">Nom</th>
                    <th className="pb-2">Email</th>
                    <th className="pb-2">Rôle</th>
                    <th className="pb-2">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {org.users.map((u) => (
                    <tr key={u.id} className="border-t border-neutral-100">
                      <td className="py-2 font-medium">
                        {u.prenom} {u.nom}
                      </td>
                      <td className="py-2 text-neutral-500">{u.email}</td>
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
        )}

        {onglet === 'packs' && (
          <div className="space-y-4">
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
              <div className="bg-warning-subtle border border-warning-300 text-warning-strong rounded-lg px-4 py-3 text-sm">
                Pack {packActif.type_pack} — {creditsRestants} crédit
                {creditsRestants !== 1 ? 's' : ''} restant
                {creditsRestants !== 1 ? 's' : ''}. Dernier achat :{' '}
                {new Date(packActif.created_at).toLocaleDateString('fr-FR')}.
              </div>
            )}

            {/* Pack actif */}
            {packActif ? (
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
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
                    <span className="text-neutral-500">Crédits restants</span>
                    <span className="font-medium">
                      {creditsRestants} / {packActif.credits_initiaux}
                    </span>
                  </div>
                  <div className="w-full bg-neutral-100 rounded-full h-2">
                    <div
                      className="bg-savr-primary-600 h-2 rounded-full"
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
                <h3 className="font-medium mb-4">Historique des packs</h3>
                <table className="w-full text-sm">
                  <thead className="text-left text-neutral-500">
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
                      <tr key={p.id} className="border-t border-neutral-100">
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
                        <td className="py-2 text-neutral-500">
                          {new Date(p.created_at).toLocaleDateString('fr-FR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}

        {onglet === 'remises' && (
          <OngletRemises
            organisationId={id}
            remises={org.tarifs_negocie}
            canEdit={canEditAdminOnly}
            onUpdated={() => void refreshOrg()}
          />
        )}

        {onglet === 'collectes' && <OngletCollectes organisationId={id} />}

        {onglet === 'factures' && <OngletFactures organisationId={id} />}

        {onglet === 'grille' && (
          <OngletGrilleZd
            organisationId={id}
            grilleId={org.grille_tarifaire_zd_id}
            canEdit={canEditAdminOnly}
            onUpdated={() => void refreshOrg()}
          />
        )}

        {onglet === 'tarif-refacture' && (
          <OngletTarifRefacture
            organisationId={id}
            value={org.tarif_refacture_pax_zd}
            canEdit={canEditAdminOnly}
            onUpdated={() => void refreshOrg()}
          />
        )}

        {onglet === 'coefficients' && (
          <OngletCoefficients organisationId={id} canEdit={canEditAdminOnly} />
        )}
      </div>

      {/* ── Modales ──────────────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {modal === 'creer' && 'Créer un pack AG'}
                {modal === 'ajuster' && 'Ajuster les crédits'}
                {modal === 'annuler' && 'Annuler le pack'}
              </h2>
              <button
                onClick={() => setModal(null)}
                className="text-neutral-400 hover:text-neutral-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
                {formError}
              </div>
            )}

            {/* Modale : Créer un pack */}
            {modal === 'creer' && (
              <form
                onSubmit={(e) => void submitCreerPack(e)}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Type de pack
                  </label>
                  <select
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
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {TYPES_PACK.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Crédits initiaux
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={fCredits}
                    onChange={(e) => setFCredits(parseInt(e.target.value) || 1)}
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Montant total HT (€)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={fMontant}
                    onChange={(e) => setFMontant(e.target.value)}
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Optionnel"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Mode de facturation
                  </label>
                  <select
                    value={fModeFacturation}
                    onChange={(e) => setFModeFacturation(e.target.value)}
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="par_collecte">Par collecte</option>
                    <option value="globale_achat">
                      Globale (achat forfait)
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Commentaires
                  </label>
                  <textarea
                    value={fCommentaires}
                    onChange={(e) => setFCommentaires(e.target.value)}
                    rows={2}
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Optionnel"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setModal(null)}
                    disabled={submitting}
                  >
                    Annuler
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? 'Création…' : 'Créer le pack'}
                  </Button>
                </div>
              </form>
            )}

            {/* Modale : Ajuster crédits */}
            {modal === 'ajuster' && packActif && (
              <form
                onSubmit={(e) => void submitAjuster(e)}
                className="space-y-4"
              >
                <p className="text-sm text-neutral-500">
                  Pack actif : <strong>{packActif.type_pack}</strong> —{' '}
                  {packActif.credits_consommes} crédits consommés sur{' '}
                  {packActif.credits_initiaux}.
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Nouveau total de crédits initiaux
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={fAjusterCredits}
                    onChange={(e) =>
                      setFAjusterCredits(parseInt(e.target.value) || 0)
                    }
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                  {fAjusterCredits < packActif.credits_consommes && (
                    <p className="text-xs text-warning-600 mt-1">
                      Valeur inférieure aux crédits consommés — le pack passera
                      en épuisé.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Motif (≥ 10 caractères)
                  </label>
                  <textarea
                    value={fAjusterMotif}
                    onChange={(e) => setFAjusterMotif(e.target.value)}
                    rows={2}
                    minLength={10}
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setModal(null)}
                    disabled={submitting}
                  >
                    Annuler
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? 'Enregistrement…' : 'Ajuster'}
                  </Button>
                </div>
              </form>
            )}

            {/* Modale : Annuler le pack */}
            {modal === 'annuler' && packActif && (
              <form
                onSubmit={(e) => void submitAnnuler(e)}
                className="space-y-4"
              >
                <p className="text-sm text-neutral-500">
                  Le pack <strong>{packActif.type_pack}</strong> (
                  {creditsRestants} crédit{creditsRestants !== 1 ? 's' : ''}{' '}
                  restant
                  {creditsRestants !== 1 ? 's' : ''}) sera annulé
                  définitivement. Les crédits non consommés seront perdus.
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Motif (≥ 10 caractères)
                  </label>
                  <textarea
                    value={fAnnulerMotif}
                    onChange={(e) => setFAnnulerMotif(e.target.value)}
                    rows={3}
                    minLength={10}
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
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
                    variant="destructive"
                    disabled={submitting}
                  >
                    {submitting ? 'Annulation…' : "Confirmer l'annulation"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
