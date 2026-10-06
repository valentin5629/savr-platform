'use client';

import { AlertBar } from '@/components/ui/alert-bar';
import { fmtEuro } from '@/lib/format';
import { libelleStatutFacture } from '@/lib/libelles/facture';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { LogoCard } from '@/components/organisation/logo-card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InfosLegalesCard } from '@/components/organisation/infos-legales-card';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  FacturesFiltresBar,
  FILTRES_FACTURES,
  filtrerFactures,
} from '@/components/facture/factures-filtres-bar';
import { useFiltresUrl } from '@/lib/hooks/use-filtres-url';

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
      // §06.04 §6 fiche facture : Pennylane si dispo, sinon Savr.
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
  const [inviteMsg, setInviteMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

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
    setInviteMsg(null);
    const res = await fetch('/api/v1/gestionnaire/mon-organisation/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, prenom, nom, role: 'gestionnaire_lieux' }),
    });
    if (res.ok) {
      setInviteMsg({ ok: true, text: 'Invitation envoyée.' });
      setEmail('');
      setPrenom('');
      setNom('');
      const j = await fetch('/api/v1/gestionnaire/mon-organisation/users').then(
        (r) => r.json(),
      );
      setUsers((j.data ?? []) as UserRow[]);
    } else {
      const j = (await res.json()) as { error?: string };
      setInviteMsg({
        ok: false,
        text: j.error ?? "Erreur lors de l'invitation.",
      });
    }
    setInviting(false);
  }

  const { confirmer, dialogue } = useConfirm();
  async function handleDesactiver(userId: string) {
    if (
      !(await confirmer({
        title: 'Désactiver ce membre ?',
        confirmLabel: 'Désactiver',
        variant: 'destructive',
      }))
    )
      return;
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
      meta: { label: 'Actions', interactive: true },
      cell: ({ row: { original: u } }) =>
        u.actif && (
          <Button
            variant="ghost-destructive"
            size="sm"
            className="text-xs"
            onClick={() => handleDesactiver(u.id)}
          >
            Désactiver
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      {dialogue}
      <Heading level={1} tone="primary">
        Mon organisation
      </Heading>

      {/* Onglets du DS (R-UI-4b, D4). Chargement et erreur sont communs aux
          trois onglets : affichés sous la barre, hors contenu d'onglet. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as OrgTab)}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="profil">Profil</TabsTrigger>
          <TabsTrigger value="membres">Membres</TabsTrigger>
          <TabsTrigger value="factures">Factures</TabsTrigger>
        </TabsList>

        {loading && <Text className="mt-4">Chargement…</Text>}

        {!loading && erreur && (
          <p role="alert" className="mt-4 text-sm text-savr-error">
            {erreur}
          </p>
        )}

        {/* Onglet Profil */}
        {!loading && !erreur && profil && (
          <TabsContent value="profil" className="space-y-4">
            <InfosLegalesCard
              profil={profil}
              urlProfil={PROFIL_URL}
              onSaved={setProfil}
            />
            <LogoCard
              logoKey={profil.logo_url}
              uploadUrl={LOGO_URL}
              previewSrc={(k) => `${LOGO_URL}?v=${encodeURIComponent(k)}`}
              onUploaded={async (k) => {
                // Le logo est déjà sur R2 : un échec du PATCH ne doit pas être
                // confondu avec un échec d'envoi (message dédié, §06.05).
                const p = await patchProfil({ logo_url: k }).catch(() => {
                  throw new Error(
                    'Logo envoyé mais non enregistré. Veuillez réessayer.',
                  );
                });
                setProfil(p);
              }}
            />
          </TabsContent>
        )}

        {/* Onglet Membres */}
        {!loading && !erreur && (
          <TabsContent value="membres" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Membres</CardTitle>
              </CardHeader>
              <CardContent>
                <DataGrid
                  columnsToggle={false}
                  columns={colonnesMembres}
                  data={users}
                  getRowId={(u) => u.id}
                  empty={<Text>Aucun membre.</Text>}
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
                    <AlertBar variant={inviteMsg.ok ? 'success' : 'err'}>
                      {inviteMsg.text}
                    </AlertBar>
                  )}
                  <Button type="submit" loading={inviting} loadingText="Envoi…">
                    {"Envoyer l'invitation"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Onglet Factures */}
        {!loading && !erreur && (
          <TabsContent value="factures">
            <OngletFactures factures={factures} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// Onglet Factures — mêmes filtres que le traiteur (R-UI-4b, D10 :
// `FacturesFiltresBar`), appliqués côté client aux factures déjà chargées par
// la page : la route `/gestionnaire/mon-organisation/factures` n'accepte qu'un
// `statut` unique et ne renvoie pas `type` (filtre Type masqué) — reliquat.
function OngletFactures({ factures }: { factures: FactureRow[] }) {
  const { valeurs, set, reset, actif } = useFiltresUrl(FILTRES_FACTURES);
  const visibles = filtrerFactures(factures, valeurs);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Factures</CardTitle>
      </CardHeader>
      <CardContent>
        <FacturesFiltresBar
          className="mb-4"
          value={valeurs}
          set={set}
          actif={actif}
          onReset={reset}
          count={visibles.length}
          filtres={{ type: false }}
        />
        <DataGrid
          columnsToggle={false}
          columns={COLONNES_FACTURES}
          data={visibles}
          getRowId={(f) => f.id}
          empty={<Text>Aucune facture.</Text>}
        />
      </CardContent>
    </Card>
  );
}
