'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
  if (!res.ok || j.data === undefined) throw new Error(ERREUR_CHARGEMENT);
  return j.data;
}

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
    const charger: Promise<() => void> =
      tab === 'profil'
        ? fetchData<OrgProfil>(`${base}/profil`).then((d) => () => setProfil(d))
        : tab === 'membres'
          ? fetchData<UserRow[]>(`${base}/users`).then((d) => () => setUsers(d))
          : fetchData<FactureRow[]>(`${base}/factures`).then(
              (d) => () => setFactures(d),
            );
    setLoading(true);
    setErreur('');
    charger
      .then((appliquer) => {
        if (actif) appliquer();
      })
      .catch((e: unknown) => {
        if (actif)
          setErreur(e instanceof Error ? e.message : ERREUR_CHARGEMENT);
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
        <Card>
          <CardHeader>
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            {(
              [
                ['Nom', profil.nom],
                ['Raison sociale', profil.raison_sociale],
                ['SIRET', profil.siret],
                ['Adresse', profil.adresse],
                ['Email', profil.email_principal],
                ['Téléphone', profil.telephone],
              ] as const
            ).map(([libelle, valeur]) => (
              <div key={libelle}>
                <div className="text-savr-neutral-500">{libelle}</div>
                <div>{valeur ?? '—'}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Onglet Membres */}
      {!loading && !erreur && tab === 'membres' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Membres</CardTitle>
            </CardHeader>
            <CardContent>
              {users.length === 0 ? (
                <p className="text-sm text-savr-neutral-500">Aucun membre.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-savr-neutral-500">
                    <tr>
                      <th className="py-1">Nom</th>
                      <th className="py-1">Email</th>
                      <th className="py-1">Statut</th>
                      <th className="py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.id}
                        className="border-t border-savr-neutral-100"
                      >
                        <td className="py-1">
                          {u.prenom} {u.nom}
                        </td>
                        <td className="py-1">{u.email}</td>
                        <td className="py-1">
                          <Badge variant={u.actif ? 'success' : 'neutral'}>
                            {u.actif ? 'Actif' : 'Désactivé'}
                          </Badge>
                        </td>
                        <td className="py-1">
                          {u.actif && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-savr-error text-xs"
                              onClick={() => handleDesactiver(u.id)}
                            >
                              Désactiver
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
                  <input
                    type="text"
                    placeholder="Prénom"
                    value={prenom}
                    onChange={(e) => setPrenom(e.target.value)}
                    required
                    className="rounded border border-savr-neutral-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Nom"
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                    required
                    className="rounded border border-savr-neutral-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="rounded border border-savr-neutral-300 px-3 py-2 text-sm"
                  />
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
            {factures.length === 0 ? (
              <p className="text-sm text-savr-neutral-500">Aucune facture.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-savr-neutral-500">
                  <tr>
                    <th className="py-1">Numéro</th>
                    <th className="py-1">Émission</th>
                    <th className="py-1">Montant TTC</th>
                    <th className="py-1">Statut</th>
                    <th className="py-1">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {factures.map((f) => (
                    <tr key={f.id} className="border-t border-savr-neutral-100">
                      <td className="py-1">{f.numero_facture ?? '—'}</td>
                      <td className="py-1">{f.date_emission ?? '—'}</td>
                      <td className="py-1">
                        {f.montant_ttc != null ? `${f.montant_ttc} €` : '—'}
                      </td>
                      <td className="py-1">
                        <Badge variant="neutral">{f.statut}</Badge>
                      </td>
                      <td className="py-1">
                        {(f.pdf_url_savr ?? f.pdf_url_pennylane) ? (
                          <a
                            href={
                              f.pdf_url_savr ?? f.pdf_url_pennylane ?? undefined
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="text-savr-primary-700 underline text-xs"
                          >
                            Télécharger
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
