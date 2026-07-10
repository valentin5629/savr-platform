'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PreferencesLangueCard } from '@/components/compte/preferences-langue';

type OrgTab = 'profil' | 'membres' | 'factures' | 'preferences';

interface OrgProfil {
  id: string;
  nom: string;
  nom_affichage: string | null;
  logo_url: string | null;
  description_activite: string | null;
  site_web: string | null;
  telephone_standard: string | null;
  ville: string | null;
  code_postal: string | null;
  siret_verification: string | null;
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
  pdf_url: string | null;
}

export default function MonOrganisationPage() {
  const [tab, setTab] = useState<OrgTab>('profil');
  const [profil, setProfil] = useState<OrgProfil | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [factures, setFactures] = useState<FactureRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Invitation form
  const [email, setEmail] = useState('');
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');

  useEffect(() => {
    if (tab === 'profil') {
      setLoading(true);
      fetch('/api/v1/gestionnaire/mon-organisation/profil')
        .then((r) => r.json())
        .then((j) => setProfil(j.data as OrgProfil))
        .finally(() => setLoading(false));
    } else if (tab === 'membres') {
      setLoading(true);
      fetch('/api/v1/gestionnaire/mon-organisation/users')
        .then((r) => r.json())
        .then((j) => setUsers((j.data ?? []) as UserRow[]))
        .finally(() => setLoading(false));
    } else if (tab === 'factures') {
      setLoading(true);
      fetch('/api/v1/gestionnaire/mon-organisation/factures')
        .then((r) => r.json())
        .then((j) => setFactures((j.data ?? []) as FactureRow[]))
        .finally(() => setLoading(false));
    } else {
      // Préférences (BL-P3-08) : bloc statique langue FR figé, aucun fetch.
      setLoading(false);
    }
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
    await fetch(`/api/v1/gestionnaire/mon-organisation/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif: false }),
    });
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
        <button
          className={tabCls('preferences')}
          onClick={() => setTab('preferences')}
        >
          Préférences
        </button>
      </div>

      {loading && <p className="text-sm text-savr-neutral-500">Chargement…</p>}

      {/* Onglet Profil */}
      {!loading && tab === 'profil' && profil && (
        <Card>
          <CardHeader>
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div>
              <div className="text-savr-neutral-500">Nom</div>
              <div>{profil.nom_affichage ?? profil.nom}</div>
            </div>
            {profil.ville && (
              <div>
                <div className="text-savr-neutral-500">Ville</div>
                <div>
                  {profil.code_postal} {profil.ville}
                </div>
              </div>
            )}
            {profil.site_web && (
              <div>
                <div className="text-savr-neutral-500">Site web</div>
                <a
                  href={profil.site_web}
                  target="_blank"
                  rel="noreferrer"
                  className="text-savr-primary-700 underline"
                >
                  {profil.site_web}
                </a>
              </div>
            )}
            {profil.telephone_standard && (
              <div>
                <div className="text-savr-neutral-500">Téléphone</div>
                <div>{profil.telephone_standard}</div>
              </div>
            )}
            {profil.description_activite && (
              <div className="col-span-2">
                <div className="text-savr-neutral-500">Description</div>
                <div>{profil.description_activite}</div>
              </div>
            )}
            <div>
              <div className="text-savr-neutral-500">Vérification SIRET</div>
              <Badge
                variant={
                  profil.siret_verification === 'verifie'
                    ? 'success'
                    : 'neutral'
                }
              >
                {profil.siret_verification ?? 'non vérifié'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Onglet Membres */}
      {!loading && tab === 'membres' && (
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

      {/* Onglet Préférences (BL-P3-08) — langue FR figé, §06.05 l.474 */}
      {tab === 'preferences' && <PreferencesLangueCard />}

      {/* Onglet Factures */}
      {!loading && tab === 'factures' && (
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
                        {f.pdf_url ? (
                          <a
                            href={f.pdf_url}
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
