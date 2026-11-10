'use client';

import { libelleRole } from '@/lib/libelles/role';
import { useState } from 'react';
import { PlusIcon, UsersIcon } from '@/components/ui/icones';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ListFooter } from '@/components/ui/list-footer';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { useUserId, useUserRole } from '@/lib/use-user-role';
import { DialogueReinitialisationCode } from '@/components/admin/dialogue-reinitialisation-code';
import { InviteUserModal } from './invite-user-modal';
import { PageHero } from '@/components/ui/page-hero';
import { TextLink } from '@/components/ui/text-link';
import { ROUTES } from '@/lib/routes';
import { ActifBadge } from '@/components/ui/actif-badge';

interface StaffUser {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  role: string;
  actif: boolean;
  derniere_connexion: string | null;
}

// `reinitialisation` absent : pas de colonne « Code de vérification » (seul
// admin_savr réinitialise un code ; ops_savr n'y verrait que des tirets).
function colonnes(reinitialisation?: {
  moi: string | undefined;
  onReinitialiser: (row: StaffUser) => void;
}): Column<StaffUser>[] {
  const base: Column<StaffUser>[] = [
    {
      key: 'nom',
      header: 'Nom',
      render: (row) => (
        <span className="font-medium">
          {row.prenom} {row.nom}
        </span>
      ),
    },
    { key: 'email', header: 'Email' },
    {
      key: 'role',
      header: 'Rôle',
      render: (row) => <Badge variant="neutral">{libelleRole(row.role)}</Badge>,
    },
    {
      key: 'actif',
      header: 'Statut',
      render: (row) => <ActifBadge actif={row.actif} />,
    },
    {
      key: 'derniere_connexion',
      header: 'Dernière connexion',
      render: (row) =>
        row.derniere_connexion
          ? new Date(row.derniere_connexion).toLocaleDateString('fr-FR', {
              timeZone: 'Europe/Paris',
            })
          : '—',
    },
  ];
  if (!reinitialisation) return base;
  const { moi, onReinitialiser } = reinitialisation;
  return [
    ...base,
    {
      // Code de vérification (lib/code-verification.ts) : un administrateur le
      // réinitialise pour un autre membre (téléphone perdu ou changé), jamais
      // pour lui-même.
      key: 'code_verification',
      header: 'Code de vérification',
      render: (row) =>
        moi && row.id !== moi ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onReinitialiser(row)}
            aria-label={`Réinitialiser le code de vérification de ${row.prenom} ${row.nom}`}
          >
            Réinitialiser
          </Button>
        ) : (
          '—'
        ),
    },
  ];
}

export default function SettingsUsersPage() {
  const [showInvite, setShowInvite] = useState(false);
  const [page, setPage] = useState(1);
  const role = useUserRole();
  const moi = useUserId();
  const [aReinitialiser, setAReinitialiser] = useState<StaffUser | null>(null);
  // Un seul appel paginé (R-UI-4a, E5) : avant, deux appels par rôle plafonnés
  // à 50 lignes chacun, concaténés et re-triés — au-delà, les membres manquaient
  // sans que le compteur (somme des totaux) ne le dise.
  const {
    data: users,
    total,
    loading,
    erreur,
    recharger,
  } = useListePaginee<StaffUser>(
    `/api/v1/admin/users?roles=admin_savr,ops_savr&page=${page}`,
  );

  return (
    <div className="space-y-6">
      <PageHero
        icon={<UsersIcon className="h-6 w-6" />}
        title="Utilisateurs Savr"
        actions={
          <Button variant="accent" onClick={() => setShowInvite(true)}>
            <PlusIcon />
            Inviter un membre
          </Button>
        }
      />

      {showInvite && (
        <InviteUserModal
          canInviteAdmin={role === 'admin_savr'}
          onClose={() => setShowInvite(false)}
          onCreated={() => {
            setShowInvite(false);
            recharger();
          }}
        />
      )}

      {/* Paramètres avancés (algo AG) — accès depuis la page Paramètres */}
      <div className="flex flex-wrap items-center gap-4 rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50 px-4 py-3 text-sm">
        <span className="font-medium text-savr-neutral-700">Paramètres :</span>
        <TextLink href={ROUTES.admin.parametresAlgoAg}>
          Paramètres algorithme →
        </TextLink>
        <TextLink href={ROUTES.admin.parametresAutoAccept}>
          Configuration auto-accept →
        </TextLink>
      </div>

      <DataTable
        columns={colonnes(
          role === 'admin_savr'
            ? {
                moi,
                onReinitialiser: (row) => setAReinitialiser(row),
              }
            : undefined,
        )}
        data={users}
        keyExtractor={(row) => row.id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        empty={
          <EmptyState
            icon={<UsersIcon />}
            title="Aucun utilisateur Savr"
            description="Invitez les membres de votre équipe."
          />
        }
      />
      <ListFooter total={total} page={page} onPageChange={setPage} />

      <DialogueReinitialisationCode
        utilisateur={aReinitialiser}
        onFermer={() => setAReinitialiser(null)}
      />
    </div>
  );
}
