'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { InfosLegalesCard } from '@/components/organisation/infos-legales-card';
import { Upload } from 'lucide-react';

type OrgTab = 'profil' | 'membres' | 'factures';

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
interface UserRow {
  id: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  role: string;
  actif: boolean;
}
interface FactureRow {
  id: string;
  numero_facture: string | null;
  statut: string;
  date_emission: string | null;
  montant_ttc: number | null;
  pdf_url_savr: string | null;
  pdf_url_pennylane: string | null;
}

const ERREUR_CHARGEMENT =
  'Impossible de charger ces informations. Veuillez réessayer.';

async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const j = (await res.json().catch(() => ({}))) as { data?: T };
  if (!res.ok || j.data === undefined) throw new Error();
  return j.data;
}

const ERREUR_ENREGISTREMENT = 'Enregistrement impossible. Veuillez réessayer.';

const PROFIL_URL = '/api/v1/gestionnaire/mon-organisation/profil';
const LOGO_URL = '/api/v1/gestionnaire/mon-organisation/logo';

async function patchProfil(
  patch: Partial<Pick<OrgProfil, 'logo_url'>>,
): Promise<OrgProfil> {
  const res = await fetch(PROFIL_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = (await res.json().catch(() => ({}))) as {
    data?: OrgProfil;
    error?: string;
  };
  if (!res.ok || !j.data) throw new Error(j.error ?? ERREUR_ENREGISTREMENT);
  return j.data;
}

// §06.05 §6 Bloc Organisation : logo (upload / remplacement). Upload R2 puis
// écriture de la clé dans organisations.logo_url (même flux que le traiteur).
function LogoCard({
  profil,
  onSaved,
}: {
  profil: OrgProfil;
  onSaved: (p: OrgProfil) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');
  // Clé dont l'aperçu n'a pas pu être chargé (fichier absent côté R2).
  const [apercuKo, setApercuKo] = useState<string | null>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    setErreur('');
    setSucces('');
    try {
      const form = new FormData();
      form.append('file', file);
      const up = await fetch(LOGO_URL, { method: 'POST', body: form });
      const j = (await up.json().catch(() => ({}))) as {
        logo_url?: string;
        error?: string;
      };
      if (!up.ok || !j.logo_url)
        throw new Error(j.error ?? 'Échec de l’envoi du logo.');
      const p = await patchProfil({ logo_url: j.logo_url }).catch(() => {
        throw new Error('Logo envoyé mais non enregistré. Veuillez réessayer.');
      });
      setSucces('Logo mis à jour.');
      onSaved(p);
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setUploading(false);
      // Permet de re-sélectionner le même fichier après un échec.
      input.value = '';
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {profil.logo_url && apercuKo !== profil.logo_url ? (
          <img
            // La clé change à chaque upload : force le rechargement du proxy.
            src={`${LOGO_URL}?v=${encodeURIComponent(profil.logo_url)}`}
            alt="Logo de l'organisation"
            onError={() => setApercuKo(profil.logo_url)}
            className="h-16 w-auto rounded-savr-md border border-savr-neutral-200 object-contain"
          />
        ) : (
          <p className="text-sm text-savr-neutral-500">Aucun logo.</p>
        )}
        <div className="space-y-1">
          <input
            id="org-logo"
            type="file"
            accept="image/png,image/jpeg"
            className="peer sr-only"
            onChange={(e) => void upload(e)}
            disabled={uploading}
          />
          <label
            htmlFor="org-logo"
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-savr-md border border-savr-neutral-300 bg-savr-white px-4 text-sm font-medium text-savr-neutral-900 hover:bg-savr-neutral-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-savr-primary-500 sm:h-10"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {uploading
              ? 'Envoi…'
              : profil.logo_url
                ? 'Remplacer le logo'
                : 'Ajouter un logo'}
          </label>
          <p className="text-xs text-savr-neutral-500">JPG ou PNG, 2 Mo max.</p>
          <FormError>{erreur}</FormError>
          {succes && (
            <p role="status" className="text-sm text-savr-success-strong">
              {succes}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Factures — Data Table commune, tri côté navigateur : la route /factures
// renvoie toutes les factures non brouillon (aucune pagination ni `.limit()`).
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
    id: 'montant',
    header: 'Montant TTC',
    accessorFn: (f) => f.montant_ttc ?? undefined,
    sortUndefined: 'last',
    meta: { className: 'tabular-nums' },
    cell: ({ row: { original: f } }) =>
      f.montant_ttc != null ? `${f.montant_ttc} €` : '—',
  },
  {
    id: 'statut',
    header: 'Statut',
    accessorFn: (f) => f.statut,
    cell: ({ row: { original: f } }) => (
      <Badge variant="neutral">{f.statut}</Badge>
    ),
  },
  {
    id: 'pdf',
    header: 'PDF',
    enableSorting: false,
    meta: { interactive: true },
    cell: ({ row: { original: f } }) => {
      // §06.04 §6 fiche facture : Pennylane si dispo, sinon Savr.
      const pdf = f.pdf_url_pennylane ?? f.pdf_url_savr;
      return pdf ? (
        <a
          href={pdf}
          target="_blank"
          rel="noreferrer"
          className="text-savr-primary-700 underline text-xs"
        >
          Télécharger
        </a>
      ) : (
        '—'
      );
    },
  },
];

export default function MonOrganisationPage() {
  const [tab, setTab] = useState<OrgTab>('profil');
  const [profil, setProfil] = useState<OrgProfil | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [factures, setFactures] = useState<FactureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState('');

  // Invitation form
  const [email, setEmail] = useState('');
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');

  useEffect(() => {
    // Ignore la réponse d'un onglet quitté entre-temps (sinon son erreur ou
    // sa fin de chargement s'appliquerait à l'onglet courant).
    let actif = true;
    const base = '/api/v1/gestionnaire/mon-organisation';
    const charger = async () => {
      if (tab === 'profil') {
        const d = await fetchData<OrgProfil>(`${base}/profil`);
        if (actif) setProfil(d);
      } else if (tab === 'membres') {
        const d = await fetchData<UserRow[]>(`${base}/users`);
        if (actif) setUsers(d);
      } else {
        const d = await fetchData<FactureRow[]>(`${base}/factures`);
        if (actif) setFactures(d);
      }
    };
    setLoading(true);
    setErreur('');
    charger()
      .catch(() => {
        if (actif) setErreur(ERREUR_CHARGEMENT);
      })
      .finally(() => {
        if (actif) setLoading(false);
      });
    return () => {
      actif = false;
    };
  }, [tab]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteMsg('');
    const res = await fetch('/api/v1/gestionnaire/mon-organisation/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, prenom, nom, role: 'gestionnaire_lieux' }),
    });
    if (res.ok) {
      setInviteMsg('Invitation envoyée.');
      setEmail('');
      setPrenom('');
      setNom('');
      const j = await fetch('/api/v1/gestionnaire/mon-organisation/users').then(
        (r) => r.json(),
      );
      setUsers((j.data ?? []) as UserRow[]);
    } else {
      const j = (await res.json()) as { error?: string };
      setInviteMsg(j.error ?? "Erreur lors de l'invitation.");
    }
    setInviting(false);
  }

  async function handleDesactiver(userId: string) {
    if (!confirm('Désactiver ce membre ?')) return;
    await fetch(
      `/api/v1/gestionnaire/mon-organisation/users/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actif: false }),
      },
    );
    setUsers((u) =>
      u.map((m) => (m.id === userId ? { ...m, actif: false } : m)),
    );
  }

  // Membres — Data Table commune, tri côté navigateur : la route
  // /users renvoie tous les membres de l'organisation (aucune pagination).
  const colonnesMembres: ColumnDef<UserRow, unknown>[] = [
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
      id: 'statut',
      header: 'Statut',
      accessorFn: (u) => (u.actif ? 'Actif' : 'Désactivé'),
      cell: ({ row: { original: u } }) => (
        <Badge variant={u.actif ? 'success' : 'neutral'}>
          {u.actif ? 'Actif' : 'Désactivé'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      meta: { label: 'Actions', interactive: true },
      cell: ({ row: { original: u } }) =>
        u.actif && (
          <Button
            variant="ghost"
            size="sm"
            className="text-savr-error text-xs"
            onClick={() => handleDesactiver(u.id)}
          >
            Désactiver
          </Button>
        ),
    },
  ];

  const tabCls = (t: OrgTab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? 'border-savr-primary-600 text-savr-primary-700'
        : 'border-transparent text-savr-neutral-500 hover:text-savr-neutral-700'
    }`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-savr-primary-800">
        Mon organisation
      </h1>

      <div className="flex border-b border-savr-neutral-200">
        <button className={tabCls('profil')} onClick={() => setTab('profil')}>
          Profil
        </button>
        <button className={tabCls('membres')} onClick={() => setTab('membres')}>
          Membres
        </button>
        <button
          className={tabCls('factures')}
          onClick={() => setTab('factures')}
        >
          Factures
        </button>
      </div>

      {loading && <p className="text-sm text-savr-neutral-500">Chargement…</p>}

      {!loading && erreur && (
        <p role="alert" className="text-sm text-savr-error">
          {erreur}
        </p>
      )}

      {/* Onglet Profil */}
      {!loading && !erreur && tab === 'profil' && profil && (
        <div className="space-y-4">
          <InfosLegalesCard
            profil={profil}
            urlProfil={PROFIL_URL}
            onSaved={setProfil}
          />
          <LogoCard profil={profil} onSaved={setProfil} />
        </div>
      )}

      {/* Onglet Membres */}
      {!loading && !erreur && tab === 'membres' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Membres</CardTitle>
            </CardHeader>
            <CardContent>
              <DataGrid
                columns={colonnesMembres}
                data={users}
                getRowId={(u) => u.id}
                empty={
                  <p className="text-sm text-savr-neutral-500">Aucun membre.</p>
                }
              />
            </CardContent>
          </Card>

          {/* Invitation */}
          <Card>
            <CardHeader>
              <CardTitle>Inviter un membre</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <FormField label="Prénom" htmlFor="invite-prenom" required>
                    <Input
                      id="invite-prenom"
                      type="text"
                      autoComplete="given-name"
                      value={prenom}
                      onChange={(e) => setPrenom(e.target.value)}
                      required
                    />
                  </FormField>
                  <FormField label="Nom" htmlFor="invite-nom" required>
                    <Input
                      id="invite-nom"
                      type="text"
                      autoComplete="family-name"
                      value={nom}
                      onChange={(e) => setNom(e.target.value)}
                      required
                    />
                  </FormField>
                  <FormField label="Email" htmlFor="invite-email" required>
                    <Input
                      id="invite-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </FormField>
                </div>
                {inviteMsg && (
                  <p className="text-sm text-savr-neutral-600">{inviteMsg}</p>
                )}
                <Button type="submit" disabled={inviting}>
                  {inviting ? 'Envoi…' : "Envoyer l'invitation"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Onglet Factures */}
      {!loading && !erreur && tab === 'factures' && (
        <Card>
          <CardHeader>
            <CardTitle>Factures</CardTitle>
          </CardHeader>
          <CardContent>
            <DataGrid
              columns={COLONNES_FACTURES}
              data={factures}
              getRowId={(f) => f.id}
              empty={
                <p className="text-sm text-savr-neutral-500">Aucune facture.</p>
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
