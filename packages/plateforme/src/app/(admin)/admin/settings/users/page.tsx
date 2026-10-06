'use client';

import { libelleRole } from '@/lib/libelles/role';
import { useState } from 'react';
import { Users, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ListFooter } from '@/components/ui/list-footer';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { useUserRole } from '@/lib/use-user-role';
import { InviteUserModal } from './invite-user-modal';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
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

const columns: Column<StaffUser>[] = [
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

export default function SettingsUsersPage() {
  const [showInvite, setShowInvite] = useState(false);
  const [page, setPage] = useState(1);
  const role = useUserRole();
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
      <div className="flex items-center justify-between">
        <div>
          <Heading level={1} weight="semibold" tone="primary-deep">
            Utilisateurs Savr
          </Heading>
          <Text className="mt-1">
            {total} membre{total !== 1 ? 's' : ''} de l&apos;équipe
          </Text>
        </div>
        <Button onClick={() => setShowInvite(true)}>
          <Plus />
          Inviter un membre
        </Button>
      </div>

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
        columns={columns}
        data={users}
        keyExtractor={(row) => row.id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        empty={
          <EmptyState
            icon={<Users />}
            title="Aucun utilisateur Savr"
            description="Invitez les membres de votre équipe."
          />
        }
      />
      <ListFooter total={total} page={page} onPageChange={setPage} />
    </div>
  );
}
