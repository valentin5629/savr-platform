'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import {
  Building2,
  Users,
  Package,
  FileText,
  CreditCard,
  BarChart3,
  Tag,
  Percent,
  DollarSign,
  FlaskConical,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

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
    type_remise: string;
    remise_pct: number;
    valide_du: string;
    valide_jusqu_au: string | null;
  }[];
}

const ONGLETS = [
  { key: 'informations', label: 'Informations légales', icon: Building2 },
  { key: 'domaines', label: 'Domaines email', icon: FileText },
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

export default function ClientFichePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState<OngletKey>('informations');

  useEffect(() => {
    fetch(`/api/v1/admin/organisations/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setOrg(data as OrgDetail);
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
            <h1 className="text-2xl font-semibold text-primary-950">
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
                ? 'border-primary-700 text-primary-700'
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
          </Card>
        )}

        {onglet === 'domaines' && (
          <Card className="p-6">
            {org.organisations_domaines_email.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="Aucun domaine email"
                description="Aucun domaine whitelisté pour cette organisation."
              />
            ) : (
              <ul className="space-y-2">
                {org.organisations_domaines_email.map(({ domaine }) => (
                  <li
                    key={domaine}
                    className="flex items-center gap-2 text-sm font-mono bg-neutral-50 px-3 py-2 rounded"
                  >
                    @{domaine}
                  </li>
                ))}
              </ul>
            )}
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
                  <Badge variant="success">{packActif.type_pack}</Badge>
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
                      className="bg-primary-600 h-2 rounded-full"
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
          <Card className="p-6">
            {org.tarifs_negocie.length === 0 ? (
              <EmptyState
                icon={<Percent />}
                title="Aucune remise négociée"
                description="Ajoutez une remise pour cette organisation."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Remise</th>
                    <th className="pb-2">Valide du</th>
                    <th className="pb-2">Jusqu'au</th>
                  </tr>
                </thead>
                <tbody>
                  {org.tarifs_negocie.map((t) => (
                    <tr key={t.id} className="border-t border-neutral-100">
                      <td className="py-2">{t.type_remise}</td>
                      <td className="py-2 font-medium">{t.remise_pct} %</td>
                      <td className="py-2 text-neutral-500">
                        {new Date(t.valide_du).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="py-2 text-neutral-500">
                        {t.valide_jusqu_au
                          ? new Date(t.valide_jusqu_au).toLocaleDateString(
                              'fr-FR',
                            )
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}

        {(onglet === 'collectes' ||
          onglet === 'factures' ||
          onglet === 'grille' ||
          onglet === 'tarif-refacture' ||
          onglet === 'coefficients') && (
          <Card className="p-6">
            <EmptyState
              icon={<BarChart3 />}
              title="À venir"
              description={`Cet onglet sera disponible dans le prochain sous-lot (M1.1b/M1.1c).`}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
