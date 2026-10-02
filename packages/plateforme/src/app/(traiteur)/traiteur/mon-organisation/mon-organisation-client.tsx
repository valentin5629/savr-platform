'use client';

import { AlertBar } from '@/components/ui/alert-bar';
import { fmtEuro } from '@/lib/format';
import { libelleStatutFacture } from '@/lib/libelles/facture';
import {
  libelleVerificationSiret,
  variantVerificationSiret,
} from '@/lib/libelles/organisation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FormField } from '@/components/ui/form-field';
import { BarreFiltres, FiltreCoches } from '@/components/ui/filtre-en-ligne';
import { Input } from '@/components/ui/input';
import { PreferencesLangueCard } from '@/components/compte/preferences-langue';
import { InfosLegalesCard } from '@/components/organisation/infos-legales-card';
import type { Database } from '@savr/shared/src/database.types.js';
import { LogoCard } from '@/components/organisation/logo-card';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';

// Ids des filtres typés par l'enum DB : un renommage casse la compilation au
// lieu de devenir un filtre ignoré en silence par la route (liste blanche).
type Enums = Database['plateforme']['Enums'];

type OrgTab = 'infos' | 'equipe' | 'facturation' | 'preferences';

interface OrgProfil {
  id: string;
  nom: string;
  raison_sociale: string | null;
  siret: string | null;
  adresse: string | null;
  email_principal: string | null;
  telephone: string | null;
  logo_url: string | null;
}
interface Entite {
  id: string;
  raison_sociale: string;
  siret: string;
  adresse_facturation: string;
  code_postal: string;
  ville: string;
  email_facturation: string | null;
  siret_verification: string;
  entite_par_defaut: boolean;
  actif: boolean;
}
interface Domaine {
  id: string;
  domaine: string;
  verifie_at: string | null;
}
interface UserRow {
  id: string;
  prenom: string | null;
  nom: string | null;
  email: string;
  role: string;
  actif: boolean;
  derniere_connexion: string | null;
}
interface FactureRow {
  id: string;
  numero_facture: string | null;
  type: string | null;
  statut: string;
  montant_ttc: number | null;
  date_emission: string | null;
  date_echeance: string | null;
  pdf_url_pennylane: string | null;
  pdf_url_savr: string | null;
}

const ROLE_OPTIONS = [
  { value: 'traiteur_commercial', label: 'Commercial' },
  { value: 'traiteur_manager', label: 'Manager' },
];

export function MonOrganisationClient({
  isManager,
  userId,
}: {
  isManager: boolean;
  userId: string;
}) {
  const [tab, setTab] = useState<OrgTab>('infos');

  const tabCls = (t: OrgTab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? 'border-savr-primary-600 text-savr-primary-700'
        : 'border-transparent text-savr-neutral-500 hover:text-savr-neutral-700'
    }`;

  return (
    <div className="space-y-6">
      <Heading level={1} tone="primary">
        Mon organisation
      </Heading>
      {!isManager && (
        <Text>
          Vous pouvez modifier les informations légales. Le logo, les entités de
          facturation, les domaines email et l&apos;équipe ne sont modifiables
          que par le manager.
        </Text>
      )}

      <div className="flex flex-wrap border-b border-savr-neutral-200">
        <button className={tabCls('infos')} onClick={() => setTab('infos')}>
          Informations légales
        </button>
        {/* Équipe : masquée au commercial (CDC §6 l.653) */}
        {isManager && (
          <button className={tabCls('equipe')} onClick={() => setTab('equipe')}>
            Équipe
          </button>
        )}
        <button
          className={tabCls('facturation')}
          onClick={() => setTab('facturation')}
        >
          Facturation
        </button>
        <button
          className={tabCls('preferences')}
          onClick={() => setTab('preferences')}
        >
          Préférences
        </button>
      </div>

      {tab === 'infos' && <InfosTab isManager={isManager} />}
      {tab === 'equipe' && isManager && <EquipeTab userId={userId} />}
      {tab === 'facturation' && <FacturationTab isManager={isManager} />}
      {tab === 'preferences' && <PreferencesTab />}
    </div>
  );
}

/* ─────────────────────────── Informations légales ─────────────────────────── */

function InfosTab({ isManager }: { isManager: boolean }) {
  const [profil, setProfil] = useState<OrgProfil | null>(null);
  const [entites, setEntites] = useState<Entite[]>([]);
  const [domaines, setDomaines] = useState<Domaine[]>([]);

  const reloadProfil = useCallback(() => {
    fetch('/api/v1/traiteur/mon-organisation/profil')
      .then((r) => r.json())
      .then((j) => setProfil(j.data as OrgProfil));
  }, []);
  const reloadEntites = useCallback(() => {
    fetch('/api/v1/traiteur/mon-organisation/entites-facturation')
      .then((r) => r.json())
      .then((j) => setEntites((j.data ?? []) as Entite[]));
  }, []);
  const reloadDomaines = useCallback(() => {
    fetch('/api/v1/traiteur/mon-organisation/domaines-email')
      .then((r) => r.json())
      .then((j) => setDomaines((j.data ?? []) as Domaine[]));
  }, []);

  useEffect(() => {
    reloadProfil();
    reloadEntites();
    reloadDomaines();
  }, [reloadProfil, reloadEntites, reloadDomaines]);

  return (
    <div className="space-y-4">
      {/* Informations légales : modifiables manager ET commercial (décision Val
          2026-09-28, écart au tableau des droits §6) ; logo, entités et domaines
          restent manager only. */}
      {profil ? (
        <InfosLegalesCard
          profil={profil}
          urlProfil="/api/v1/traiteur/mon-organisation/profil"
          onSaved={setProfil}
        />
      ) : (
        <Card>
          <CardContent className="py-4 text-sm text-savr-neutral-500">
            Chargement…
          </CardContent>
        </Card>
      )}
      <LogoCard
        logoKey={profil?.logo_url}
        uploadUrl="/api/v1/traiteur/mon-organisation/logo"
        previewSrc={(k) =>
          `/api/v1/traiteur/mon-organisation/logo?key=${encodeURIComponent(k)}`
        }
        canEdit={isManager}
        onUploaded={async (k) => {
          const patch = await fetch(
            '/api/v1/traiteur/mon-organisation/profil',
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ logo_url: k }),
            },
          );
          if (!patch.ok) throw new Error('Logo uploadé mais non enregistré.');
          reloadProfil();
        }}
      />
      <EntitesCard
        entites={entites}
        isManager={isManager}
        onChanged={reloadEntites}
      />
      <DomainesCard
        domaines={domaines}
        isManager={isManager}
        onChanged={reloadDomaines}
      />
    </div>
  );
}

function EntitesCard({
  entites,
  isManager,
  onChanged,
}: {
  entites: Entite[];
  isManager: boolean;
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    raison_sociale: '',
    siret: '',
    adresse_facturation: '',
    code_postal: '',
    ville: '',
    email_facturation: '',
  });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const res = await fetch(
      '/api/v1/traiteur/mon-organisation/entites-facturation',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      },
    );
    if (res.ok) {
      setForm({
        raison_sociale: '',
        siret: '',
        adresse_facturation: '',
        code_postal: '',
        ville: '',
        email_facturation: '',
      });
      setShowForm(false);
      onChanged();
    } else {
      const j = (await res.json()) as { error?: string };
      setMsg(j.error ?? 'Erreur.');
    }
    setSaving(false);
  }

  async function remove(id: string) {
    if (!confirm('Supprimer cette entité de facturation ?')) return;
    const res = await fetch(
      `/api/v1/traiteur/mon-organisation/entites-facturation/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (res.ok) onChanged();
    else {
      const j = (await res.json()) as { error?: string };
      alert(j.error ?? 'Erreur.');
    }
  }

  const actives = entites.filter((e) => e.actif);

  const colonnes: ColumnDef<Entite, unknown>[] = [
    {
      id: 'raison_sociale',
      header: 'Raison sociale',
      accessorFn: (e) => e.raison_sociale,
      cell: ({ row: { original: e } }) => e.raison_sociale,
    },
    {
      id: 'siret',
      header: 'SIRET',
      accessorFn: (e) => e.siret,
      meta: { className: 'tabular-nums' },
      cell: ({ row: { original: e } }) => e.siret,
    },
    {
      id: 'contact',
      header: 'Contact facturation',
      accessorFn: (e) => e.email_facturation ?? '',
      cell: ({ row: { original: e } }) => e.email_facturation ?? '—',
    },
    {
      id: 'verification',
      header: 'Vérif.',
      accessorFn: (e) => e.siret_verification,
      cell: ({ row: { original: e } }) => (
        <Badge variant={variantVerificationSiret(e.siret_verification)}>
          {libelleVerificationSiret(e.siret_verification)}
        </Badge>
      ),
    },
    {
      id: 'defaut',
      header: 'Défaut',
      accessorFn: (e) => (e.entite_par_defaut ? 0 : 1),
      cell: ({ row: { original: e } }) => (e.entite_par_defaut ? '★' : ''),
    },
    ...(isManager
      ? [
          {
            id: 'actions',
            header: () => <span className="sr-only">Actions</span>,
            meta: { label: 'Actions', interactive: true },
            cell: ({ row: { original: e } }) =>
              !e.entite_par_defaut && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-savr-error text-xs"
                  onClick={() => remove(e.id)}
                >
                  Supprimer
                </Button>
              ),
          } satisfies ColumnDef<Entite, unknown>,
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entités de facturation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Data Table commune, tri côté navigateur : la route renvoie toutes
            les entités de l'organisation (aucune pagination). Ordre initial =
            celui de la route (entité par défaut d'abord). */}
        <DataGrid
          columns={colonnes}
          data={actives}
          getRowId={(e) => e.id}
          empty={<Text>Aucune entité.</Text>}
        />

        {isManager &&
          (showForm ? (
            <form
              onSubmit={add}
              className="space-y-2 rounded-savr-sm border border-savr-neutral-200 p-3"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  label="Raison sociale"
                  htmlFor="entite-raison-sociale"
                  required
                >
                  <Input
                    id="entite-raison-sociale"
                    value={form.raison_sociale}
                    onChange={(ev) =>
                      setForm({ ...form, raison_sociale: ev.target.value })
                    }
                    required
                  />
                </FormField>
                <FormField
                  label="SIRET"
                  htmlFor="entite-siret"
                  required
                  hint="14 chiffres"
                >
                  <Input
                    id="entite-siret"
                    value={form.siret}
                    onChange={(ev) =>
                      setForm({ ...form, siret: ev.target.value })
                    }
                    required
                  />
                </FormField>
                <FormField
                  label="Adresse de facturation"
                  htmlFor="entite-adresse"
                  required
                  className="md:col-span-2"
                >
                  <Input
                    id="entite-adresse"
                    value={form.adresse_facturation}
                    onChange={(ev) =>
                      setForm({ ...form, adresse_facturation: ev.target.value })
                    }
                    required
                  />
                </FormField>
                <FormField
                  label="Code postal"
                  htmlFor="entite-code-postal"
                  required
                >
                  <Input
                    id="entite-code-postal"
                    value={form.code_postal}
                    onChange={(ev) =>
                      setForm({ ...form, code_postal: ev.target.value })
                    }
                    required
                  />
                </FormField>
                <FormField label="Ville" htmlFor="entite-ville" required>
                  <Input
                    id="entite-ville"
                    value={form.ville}
                    onChange={(ev) =>
                      setForm({ ...form, ville: ev.target.value })
                    }
                    required
                  />
                </FormField>
                <FormField
                  label="Contact facturation"
                  htmlFor="entite-email-facturation"
                  hint="Email qui reçoit les factures"
                  className="md:col-span-2"
                >
                  <Input
                    id="entite-email-facturation"
                    type="email"
                    value={form.email_facturation}
                    onChange={(ev) =>
                      setForm({ ...form, email_facturation: ev.target.value })
                    }
                  />
                </FormField>
              </div>
              {msg && <p className="text-sm text-savr-error">{msg}</p>}
              <div className="flex gap-2">
                <Button type="submit" loading={saving} loadingText="Ajout…">
                  Ajouter
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowForm(false)}
                >
                  Annuler
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setShowForm(true)}>
              + Ajouter une entité
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}

function DomainesCard({
  domaines,
  isManager,
  onChanged,
}: {
  domaines: Domaine[];
  isManager: boolean;
  onChanged: () => void;
}) {
  const [domaine, setDomaine] = useState('');
  const [msg, setMsg] = useState('');

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const res = await fetch(
      '/api/v1/traiteur/mon-organisation/domaines-email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domaine }),
      },
    );
    if (res.ok) {
      setDomaine('');
      onChanged();
    } else {
      const j = (await res.json()) as { error?: string };
      setMsg(j.error ?? 'Erreur.');
    }
  }

  async function remove(id: string) {
    const res = await fetch(
      `/api/v1/traiteur/mon-organisation/domaines-email/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (res.ok) onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domaines email autorisés</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Text variant="faint">
          Les collaborateurs dont l’email appartient à ces domaines sont
          rattachés automatiquement à l’organisation.
        </Text>
        {domaines.length === 0 ? (
          <Text>Aucun domaine.</Text>
        ) : (
          <ul className="space-y-1 text-sm">
            {domaines.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between border-t border-savr-neutral-100 py-1"
              >
                <span>{d.domaine}</span>
                {isManager && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-savr-error text-xs"
                    onClick={() => remove(d.id)}
                  >
                    Retirer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isManager && (
          <form onSubmit={add} className="flex items-end gap-2">
            <FormField
              label="Nouveau domaine"
              htmlFor="domaine-email"
              className="flex-1"
            >
              <Input
                id="domaine-email"
                placeholder="monentreprise.fr"
                value={domaine}
                onChange={(e) => setDomaine(e.target.value)}
              />
            </FormField>
            <Button type="submit">Ajouter</Button>
          </form>
        )}
        {msg && <p className="text-sm text-savr-error">{msg}</p>}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────── Équipe (manager) ─────────────────────────── */

function EquipeTab({ userId }: { userId: string }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const reload = useCallback(() => {
    fetch('/api/v1/traiteur/equipe')
      .then((r) => r.json())
      .then((j) => setUsers((j.data ?? []) as UserRow[]));
  }, []);
  useEffect(() => reload(), [reload]);

  async function changeRole(id: string, role: string) {
    await fetch(`/api/v1/traiteur/equipe/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    reload();
  }
  async function suspend(id: string) {
    if (!confirm('Suspendre ce collaborateur ?')) return;
    await fetch(`/api/v1/traiteur/equipe/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif: false }),
    });
    reload();
  }

  const colonnes: ColumnDef<UserRow, unknown>[] = [
    {
      id: 'nom',
      header: 'Nom',
      accessorFn: (u) => `${u.prenom ?? ''} ${u.nom ?? ''}`.trim(),
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
      cell: ({ row: { original: u } }) => u.email,
    },
    {
      id: 'role',
      header: 'Rôle',
      accessorFn: (u) =>
        ROLE_OPTIONS.find((o) => o.value === u.role)?.label ?? u.role,
      // Saisie dans la cellule : le clic/clavier ne remonte pas à la ligne.
      meta: { interactive: true },
      cell: ({ row: { original: u } }) => (
        /* Sa PROPRE ligne : rôle en lecture seule. Le CDC §06.04 §6 ne prévoit
           que « modifier le rôle d'un COLLABORATEUR », et la base refuse
           désormais tout auto-changement (volet 3 du trigger anti-escalade,
           20260921170000). Sans ce grisage, la liste resterait cliquable pour
           un refus silencieux. */
        <span
          className="block w-36"
          title={
            u.id === userId
              ? 'Vous ne pouvez pas modifier votre propre rôle'
              : undefined
          }
        >
          <Combobox
            aria-label={`Rôle de ${u.prenom} ${u.nom}`}
            icon={null}
            options={ROLE_OPTIONS}
            value={u.role}
            disabled={u.id === userId}
            onChange={(v) => changeRole(u.id, v)}
          />
        </span>
      ),
    },
    {
      id: 'derniere_connexion',
      header: 'Dernière connexion',
      accessorFn: (u) => u.derniere_connexion ?? '',
      cell: ({ row: { original: u } }) => u.derniere_connexion ?? '—',
    },
    {
      id: 'statut',
      header: 'Statut',
      accessorFn: (u) => (u.actif ? 'Actif' : 'Suspendu'),
      cell: ({ row: { original: u } }) => (
        <Badge variant={u.actif ? 'success' : 'neutral'}>
          {u.actif ? 'Actif' : 'Suspendu'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { label: 'Actions', interactive: true },
      cell: ({ row: { original: u } }) =>
        u.actif && (
          <Button
            variant="ghost"
            size="sm"
            className="text-savr-error text-xs"
            onClick={() => suspend(u.id)}
          >
            Suspendre
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Utilisateurs</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Data Table commune, tri côté navigateur : la route /equipe
              renvoie tous les membres de l'organisation (aucune pagination). */}
          <DataGrid
            columns={colonnes}
            data={users}
            getRowId={(u) => u.id}
            empty={<Text>Aucun membre.</Text>}
          />
        </CardContent>
      </Card>

      <InviteCard onInvited={reload} />
      <TransfertCard users={users} onDone={reload} />
    </div>
  );
}

function InviteCard({ onInvited }: { onInvited: () => void }) {
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/v1/traiteur/equipe/invitation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prenom, nom, email }),
    });
    if (res.ok) {
      setMsg({ ok: true, text: 'Invitation envoyée.' });
      setPrenom('');
      setNom('');
      setEmail('');
      onInvited();
    } else {
      const j = (await res.json()) as { error?: string };
      setMsg({ ok: false, text: j.error ?? 'Erreur.' });
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inviter un collaborateur</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={invite} className="space-y-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField label="Prénom" htmlFor="invite-prenom" required>
              <Input
                id="invite-prenom"
                value={prenom}
                onChange={(e) => setPrenom(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Nom" htmlFor="invite-nom" required>
              <Input
                id="invite-nom"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Email" htmlFor="invite-email" required>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>
          </div>
          <Text variant="faint">
            Le collaborateur est ajouté avec le rôle Commercial.
          </Text>
          {msg && (
            <AlertBar variant={msg.ok ? 'success' : 'err'}>{msg.text}</AlertBar>
          )}
          <Button type="submit" loading={busy} loadingText="Envoi…">
            Envoyer l’invitation
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TransfertCard({
  users,
  onDone,
}: {
  users: UserRow[];
  onDone: () => void;
}) {
  const [source, setSource] = useState('');
  const [cible, setCible] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const userOptions = users.map((u) => ({
    value: u.id,
    label: `${u.prenom} ${u.nom}`,
  }));

  async function transfer(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    // Les deux champs sont obligatoires (ex-`required` des <select> natifs).
    if (!source || !cible) {
      setMsg({
        ok: false,
        text: 'Choisissez le collaborateur de départ et celui d’arrivée.',
      });
      return;
    }
    const res = await fetch('/api/v1/traiteur/equipe/transfert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_user_id: source, cible_user_id: cible }),
    });
    if (res.ok) {
      const j = (await res.json()) as { data?: { transferes?: number } };
      setMsg({
        ok: true,
        text: `${j.data?.transferes ?? 0} événement(s) transféré(s).`,
      });
      onDone();
    } else {
      const j = (await res.json()) as { error?: string };
      setMsg({ ok: false, text: j.error ?? 'Erreur.' });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transférer les collectes</CardTitle>
      </CardHeader>
      <CardContent>
        <Text variant="faint" className="mb-3">
          Réassigne toutes les collectes d’un collaborateur (ex. en cas de
          départ) vers un autre membre de l’équipe.
        </Text>
        <form onSubmit={transfer} className="space-y-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Depuis" htmlFor="transfert-source" required>
              <Combobox
                id="transfert-source"
                icon={null}
                required
                placeholder="Choisir un collaborateur"
                options={userOptions}
                value={source}
                onChange={setSource}
              />
            </FormField>
            <FormField label="Vers" htmlFor="transfert-cible" required>
              <Combobox
                id="transfert-cible"
                icon={null}
                required
                placeholder="Choisir un collaborateur"
                options={userOptions}
                value={cible}
                onChange={setCible}
              />
            </FormField>
          </div>
          {msg && (
            <AlertBar variant={msg.ok ? 'success' : 'err'}>{msg.text}</AlertBar>
          )}
          <Button type="submit">Transférer</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────── Facturation ──────────────────────────────── */

// Factures — Data Table commune, tri côté navigateur : la route
// /traiteur/factures renvoie toutes les factures qui passent les filtres
// (filtrage serveur, aucune pagination ni `.limit()`).
const COLONNES_FACTURES: ColumnDef<FactureRow, unknown>[] = [
  {
    id: 'numero',
    header: 'Numéro',
    accessorFn: (f) => f.numero_facture ?? '',
    cell: ({ row: { original: f } }) => f.numero_facture ?? '—',
  },
  {
    id: 'emission',
    header: 'Émission',
    accessorFn: (f) => f.date_emission ?? '',
    cell: ({ row: { original: f } }) => f.date_emission ?? '—',
  },
  {
    id: 'echeance',
    header: 'Échéance',
    accessorFn: (f) => f.date_echeance ?? '',
    cell: ({ row: { original: f } }) => f.date_echeance ?? '—',
  },
  {
    id: 'montant',
    header: 'Montant TTC',
    accessorFn: (f) => f.montant_ttc ?? undefined,
    sortUndefined: 'last',
    meta: { className: 'tabular-nums' },
    cell: ({ row: { original: f } }) =>
      f.montant_ttc != null ? fmtEuro(f.montant_ttc) : '—',
  },
  {
    id: 'statut',
    header: 'Statut',
    accessorFn: (f) => f.statut,
    cell: ({ row: { original: f } }) => (
      <Badge variant="neutral">{libelleStatutFacture(f.statut)}</Badge>
    ),
  },
  {
    id: 'pdf',
    header: 'PDF',
    meta: { interactive: true },
    cell: ({ row: { original: f } }) => {
      const pdf = f.pdf_url_pennylane ?? f.pdf_url_savr;
      return pdf ? (
        <TextLink
          href={pdf}
          external
          target="_blank"
          rel="noreferrer"
          className="text-xs"
        >
          Télécharger
        </TextLink>
      ) : (
        '—'
      );
    },
  },
];

function FacturationTab({ isManager }: { isManager: boolean }) {
  const [factures, setFactures] = useState<FactureRow[]>([]);
  // Statut et Type à choix multiple, case « Tous » = sélection vide (décision
  // Val 2026-09-30, divergence M0.8_20260930_filtres-choix-multiple-tous).
  const [statuts, setStatuts] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');

  useEffect(() => {
    // Filtres §6 l.690 : statut, type, période (date d'émission). Une réponse
    // arrivée après un changement de filtre (effet nettoyé) est ignorée.
    let perime = false;
    const params = new URLSearchParams();
    if (statuts.length > 0) params.set('statuts', statuts.join(','));
    if (types.length > 0) params.set('types', types.join(','));
    if (dateDebut) params.set('date_debut', dateDebut);
    if (dateFin) params.set('date_fin', dateFin);
    const qs = params.toString();
    fetch(`/api/v1/traiteur/factures${qs ? `?${qs}` : ''}`)
      .then((r) => r.json())
      .then((j) => {
        if (!perime) setFactures((j.data ?? []) as FactureRow[]);
      });
    return () => {
      perime = true;
    };
  }, [statuts, types, dateDebut, dateFin]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Paramètres de facturation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-savr-neutral-600">
          <p>
            Le <strong>contact principal de facturation</strong> (email qui
            reçoit les factures et relances) se règle sur chaque{' '}
            <strong>entité de facturation</strong>
            {isManager
              ? ' (onglet Informations légales > Entités de facturation).'
              : '.'}
          </p>
          <Text variant="faint">
            Les coordonnées bancaires de règlement figurent sur la facture
            (virement — pas de paiement en ligne en V1).
          </Text>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Factures</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filtres §6 l.690 : statut, type, période — filtres en ligne
              (décision Val 2026-09-30). */}
          <BarreFiltres
            className="mb-4"
            data-testid="factures-filtres"
            resetTestId="factures-filtres-reset"
            onReset={
              statuts.length > 0 || types.length > 0 || dateDebut || dateFin
                ? () => {
                    setStatuts([]);
                    setTypes([]);
                    setDateDebut('');
                    setDateFin('');
                  }
                : undefined
            }
          >
            {/* « Période » en premier (décision Val 2026-09-30). */}
            <DateRangePicker
              titre="Période"
              id="factures-periode"
              value={{ from: dateDebut, to: dateFin }}
              onChange={(p) => {
                setDateDebut(p.from);
                setDateFin(p.to);
              }}
            />
            {/* Valeurs = enums réels plateforme.facture_statut / facture_type
                (brouillon exclu par la route ; « En retard » est un badge dérivé
                de date_echeance, pas un statut stocké → non filtrable). */}
            <FiltreCoches
              label="Statut"
              testid="factures-statut"
              options={
                [
                  { id: 'en_attente_pennylane', nom: 'En attente' },
                  { id: 'emise', nom: 'Émise' },
                  { id: 'payee', nom: 'Payée' },
                  { id: 'annulee', nom: 'Annulée' },
                ] satisfies { id: Enums['facture_statut']; nom: string }[]
              }
              selected={statuts}
              onChange={setStatuts}
            />
            <FiltreCoches
              label="Type"
              testid="factures-type"
              options={
                [
                  { id: 'zero_dechet', nom: 'ZD' },
                  { id: 'collecte_antigaspi', nom: 'AG' },
                  { id: 'achat_pack_antigaspi', nom: 'Pack' },
                  { id: 'avoir', nom: 'Avoir' },
                ] satisfies { id: Enums['facture_type']; nom: string }[]
              }
              selected={types}
              onChange={setTypes}
            />
          </BarreFiltres>
          <DataGrid
            columns={COLONNES_FACTURES}
            data={factures}
            getRowId={(f) => f.id}
            empty={<Text>Aucune facture.</Text>}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────────── Préférences ──────────────────────────────── */

function PreferencesTab() {
  return <PreferencesLangueCard />;
}
