'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Users, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/lib/use-user-role';
import { InviteUserModal } from './invite-user-modal';

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
    render: (row) => <Badge variant="neutral">{row.role}</Badge>,
  },
  {
    key: 'actif',
    header: 'Statut',
    render: (row) =>
      row.actif ? (
        <Badge variant="success">Actif</Badge>
      ) : (
        <Badge variant="neutral">Suspendu</Badge>
      ),
  },
  {
    key: 'derniere_connexion',
    header: 'Dernière connexion',
    render: (row) =>
      row.derniere_connexion
        ? new Date(row.derniere_connexion).toLocaleDateString('fr-FR')
        : '—',
  },
];

export default function SettingsUsersPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const role = useUserRole();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/v1/admin/users?role=admin_savr');
    const res2 = await fetch('/api/v1/admin/users?role=ops_savr');
    if (res.ok && res2.ok) {
      const j1 = (await res.json()) as { data: StaffUser[]; total: number };
      const j2 = (await res2.json()) as { data: StaffUser[]; total: number };
      const all = [...j1.data, ...j2.data].sort((a, b) =>
        a.nom.localeCompare(b.nom),
      );
      setUsers(all);
      setTotal(j1.total + j2.total);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary-950">
            Utilisateurs Savr
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            {total} membre{total !== 1 ? 's' : ''} de l&apos;équipe
          </p>
        </div>
        <Button onClick={() => setShowInvite(true)}>
          <Plus className="w-4 h-4" />
          Inviter un membre
        </Button>
      </div>

      {showInvite && (
        <InviteUserModal
          canInviteAdmin={role === 'admin_savr'}
          onClose={() => setShowInvite(false)}
          onCreated={() => {
            setShowInvite(false);
            void fetchUsers();
          }}
        />
      )}

      {/* Paramètres avancés (algo AG) — accès depuis la page Paramètres */}
      <div className="flex flex-wrap items-center gap-4 rounded-md border border-savr-neutral-200 bg-savr-neutral-50 px-4 py-3 text-sm">
        <span className="font-medium text-savr-neutral-700">Paramètres :</span>
        <Link
          href="/admin/parametres/algo-ag"
          className="text-primary-600 hover:underline"
        >
          Paramètres algorithme →
        </Link>
        <Link
          href="/admin/parametres/auto-accept"
          className="text-primary-600 hover:underline"
        >
          Configuration auto-accept →
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Aucun utilisateur Savr"
          description="Invitez les membres de votre équipe."
        />
      ) : (
        <DataTable
          columns={columns}
          data={users}
          keyExtractor={(row) => row.id}
        />
      )}
    </div>
  );
}
