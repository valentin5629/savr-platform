'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

const inputCls =
  'w-full rounded border border-savr-neutral-300 px-3 py-2 text-sm';
const labelCls = 'text-xs font-medium text-savr-neutral-500';

export function MonOrganisationClient({ isManager }: { isManager: boolean }) {
  const [tab, setTab] = useState<OrgTab>('infos');

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
      {!isManager && (
        <p className="text-sm text-savr-neutral-500">
          Lecture seule — seul le manager peut modifier les paramètres de
          l&apos;organisation.
        </p>
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
      {tab === 'equipe' && isManager && <EquipeTab />}
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
      <InfosLegalesCard
        profil={profil}
        isManager={isManager}
        onSaved={reloadProfil}
      />
      <LogoCard profil={profil} isManager={isManager} onSaved={reloadProfil} />
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

function InfosLegalesCard({
  profil,
  isManager,
  onSaved,
}: {
  profil: OrgProfil | null;
  isManager: boolean;
  onSaved: () => void;
}) {
  const [raisonSociale, setRaisonSociale] = useState('');
  const [siren, setSiren] = useState('');
  const [adresse, setAdresse] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profil) return;
    setRaisonSociale(profil.raison_sociale ?? '');
    setSiren(profil.siret ?? '');
    setAdresse(profil.adresse ?? '');
  }, [profil]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const res = await fetch('/api/v1/traiteur/mon-organisation/profil', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raison_sociale: raisonSociale,
        siret: siren,
        adresse,
      }),
    });
    setMsg(
      res.ok ? 'Modifications enregistrées.' : 'Erreur à l’enregistrement.',
    );
    setSaving(false);
    if (res.ok) onSaved();
  }

  if (!profil)
    return (
      <Card>
        <CardContent className="py-4 text-sm text-savr-neutral-500">
          Chargement…
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informations légales</CardTitle>
      </CardHeader>
      <CardContent>
        {isManager ? (
          <form onSubmit={save} className="space-y-3">
            <div>
              <label className={labelCls}>Raison sociale</label>
              <input
                className={inputCls}
                value={raisonSociale}
                onChange={(e) => setRaisonSociale(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>SIREN</label>
              <input
                className={inputCls}
                value={siren}
                onChange={(e) => setSiren(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Adresse</label>
              <input
                className={inputCls}
                value={adresse}
                onChange={(e) => setAdresse(e.target.value)}
              />
            </div>
            {msg && <p className="text-sm text-savr-neutral-600">{msg}</p>}
            <Button type="submit" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </form>
        ) : (
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <div>
              <span className="text-savr-neutral-500">Raison sociale : </span>
              {profil.raison_sociale ?? profil.nom ?? '—'}
            </div>
            <div>
              <span className="text-savr-neutral-500">SIREN : </span>
              {profil.siret ?? '—'}
            </div>
            <div className="md:col-span-2">
              <span className="text-savr-neutral-500">Adresse : </span>
              {profil.adresse ?? '—'}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LogoCard({
  profil,
  isManager,
  onSaved,
}: {
  profil: OrgProfil | null;
  isManager: boolean;
  onSaved: () => void;
}) {
  const [msg, setMsg] = useState('');
  const [uploading, setUploading] = useState(false);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMsg('');
    const form = new FormData();
    form.append('file', file);
    const up = await fetch('/api/v1/traiteur/mon-organisation/logo', {
      method: 'POST',
      body: form,
    });
    if (!up.ok) {
      const j = (await up.json()) as { error?: string };
      setMsg(j.error ?? 'Échec de l’upload.');
      setUploading(false);
      return;
    }
    const { logo_url } = (await up.json()) as { logo_url: string };
    const patch = await fetch('/api/v1/traiteur/mon-organisation/profil', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logo_url }),
    });
    setMsg(patch.ok ? 'Logo mis à jour.' : 'Logo uploadé mais non enregistré.');
    setUploading(false);
    if (patch.ok) onSaved();
  }

  const logoSrc = profil?.logo_url
    ? `/api/v1/traiteur/mon-organisation/logo?key=${encodeURIComponent(profil.logo_url)}`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {logoSrc ? (
          <img
            src={logoSrc}
            alt="Logo de l'organisation"
            className="h-16 w-auto rounded border border-savr-neutral-200"
          />
        ) : (
          <p className="text-sm text-savr-neutral-500">Aucun logo.</p>
        )}
        {isManager && (
          <div className="space-y-1">
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={upload}
              disabled={uploading}
              className="text-sm"
            />
            <p className="text-xs text-savr-neutral-400">
              JPG ou PNG, 2 Mo max.
            </p>
            {msg && <p className="text-sm text-savr-neutral-600">{msg}</p>}
          </div>
        )}
      </CardContent>
    </Card>
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
      `/api/v1/traiteur/mon-organisation/entites-facturation/${id}`,
      { method: 'DELETE' },
    );
    if (res.ok) onChanged();
    else {
      const j = (await res.json()) as { error?: string };
      alert(j.error ?? 'Erreur.');
    }
  }

  const actives = entites.filter((e) => e.actif);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entités de facturation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {actives.length === 0 ? (
          <p className="text-sm text-savr-neutral-500">Aucune entité.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-savr-neutral-500">
              <tr>
                <th className="py-1">Raison sociale</th>
                <th className="py-1">SIRET</th>
                <th className="py-1">Contact facturation</th>
                <th className="py-1">Vérif.</th>
                <th className="py-1">Défaut</th>
                {isManager && <th className="py-1"></th>}
              </tr>
            </thead>
            <tbody>
              {actives.map((e) => (
                <tr key={e.id} className="border-t border-savr-neutral-100">
                  <td className="py-1">{e.raison_sociale}</td>
                  <td className="py-1">{e.siret}</td>
                  <td className="py-1">{e.email_facturation ?? '—'}</td>
                  <td className="py-1">
                    <Badge
                      variant={
                        e.siret_verification === 'verifie'
                          ? 'success'
                          : 'neutral'
                      }
                    >
                      {e.siret_verification}
                    </Badge>
                  </td>
                  <td className="py-1">{e.entite_par_defaut ? '★' : ''}</td>
                  {isManager && (
                    <td className="py-1">
                      {!e.entite_par_defaut && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-savr-error text-xs"
                          onClick={() => remove(e.id)}
                        >
                          Supprimer
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {isManager &&
          (showForm ? (
            <form
              onSubmit={add}
              className="space-y-2 rounded border border-savr-neutral-200 p-3"
            >
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <input
                  className={inputCls}
                  placeholder="Raison sociale"
                  value={form.raison_sociale}
                  onChange={(ev) =>
                    setForm({ ...form, raison_sociale: ev.target.value })
                  }
                  required
                />
                <input
                  className={inputCls}
                  placeholder="SIRET (14 chiffres)"
                  value={form.siret}
                  onChange={(ev) =>
                    setForm({ ...form, siret: ev.target.value })
                  }
                  required
                />
                <input
                  className={`${inputCls} md:col-span-2`}
                  placeholder="Adresse de facturation"
                  value={form.adresse_facturation}
                  onChange={(ev) =>
                    setForm({ ...form, adresse_facturation: ev.target.value })
                  }
                  required
                />
                <input
                  className={inputCls}
                  placeholder="Code postal"
                  value={form.code_postal}
                  onChange={(ev) =>
                    setForm({ ...form, code_postal: ev.target.value })
                  }
                  required
                />
                <input
                  className={inputCls}
                  placeholder="Ville"
                  value={form.ville}
                  onChange={(ev) =>
                    setForm({ ...form, ville: ev.target.value })
                  }
                  required
                />
                <input
                  className={`${inputCls} md:col-span-2`}
                  type="email"
                  placeholder="Contact facturation (email qui reçoit les factures)"
                  value={form.email_facturation}
                  onChange={(ev) =>
                    setForm({ ...form, email_facturation: ev.target.value })
                  }
                />
              </div>
              {msg && <p className="text-sm text-savr-error">{msg}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Ajout…' : 'Ajouter'}
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
      `/api/v1/traiteur/mon-organisation/domaines-email/${id}`,
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
        <p className="text-xs text-savr-neutral-400">
          Les collaborateurs dont l’email appartient à ces domaines sont
          rattachés automatiquement à l’organisation.
        </p>
        {domaines.length === 0 ? (
          <p className="text-sm text-savr-neutral-500">Aucun domaine.</p>
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
          <form onSubmit={add} className="flex gap-2">
            <input
              className={inputCls}
              placeholder="monentreprise.fr"
              value={domaine}
              onChange={(e) => setDomaine(e.target.value)}
            />
            <Button type="submit">Ajouter</Button>
          </form>
        )}
        {msg && <p className="text-sm text-savr-error">{msg}</p>}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────── Équipe (manager) ─────────────────────────── */

function EquipeTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const reload = useCallback(() => {
    fetch('/api/v1/traiteur/equipe')
      .then((r) => r.json())
      .then((j) => setUsers((j.data ?? []) as UserRow[]));
  }, []);
  useEffect(() => reload(), [reload]);

  async function changeRole(id: string, role: string) {
    await fetch(`/api/v1/traiteur/equipe/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    reload();
  }
  async function suspend(id: string) {
    if (!confirm('Suspendre ce collaborateur ?')) return;
    await fetch(`/api/v1/traiteur/equipe/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif: false }),
    });
    reload();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Utilisateurs</CardTitle>
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
                  <th className="py-1">Rôle</th>
                  <th className="py-1">Dernière connexion</th>
                  <th className="py-1">Statut</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-savr-neutral-100">
                    <td className="py-1">
                      {u.prenom} {u.nom}
                    </td>
                    <td className="py-1">{u.email}</td>
                    <td className="py-1">
                      <select
                        className="rounded border border-savr-neutral-300 px-2 py-1 text-xs"
                        value={u.role}
                        onChange={(e) => changeRole(u.id, e.target.value)}
                      >
                        <option value="traiteur_commercial">Commercial</option>
                        <option value="traiteur_manager">Manager</option>
                      </select>
                    </td>
                    <td className="py-1">{u.derniere_connexion ?? '—'}</td>
                    <td className="py-1">
                      <Badge variant={u.actif ? 'success' : 'neutral'}>
                        {u.actif ? 'Actif' : 'Suspendu'}
                      </Badge>
                    </td>
                    <td className="py-1">
                      {u.actif && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-savr-error text-xs"
                          onClick={() => suspend(u.id)}
                        >
                          Suspendre
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

      <InviteCard onInvited={reload} />
      <TransfertCard users={users} onDone={reload} />
    </div>
  );
}

function InviteCard({ onInvited }: { onInvited: () => void }) {
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    const res = await fetch('/api/v1/traiteur/equipe/invitation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prenom, nom, email }),
    });
    if (res.ok) {
      setMsg('Invitation envoyée.');
      setPrenom('');
      setNom('');
      setEmail('');
      onInvited();
    } else {
      const j = (await res.json()) as { error?: string };
      setMsg(j.error ?? 'Erreur.');
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <input
              className={inputCls}
              placeholder="Prénom"
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
              required
            />
            <input
              className={inputCls}
              placeholder="Nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              required
            />
            <input
              className={inputCls}
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <p className="text-xs text-savr-neutral-400">
            Le collaborateur est ajouté avec le rôle Commercial.
          </p>
          {msg && <p className="text-sm text-savr-neutral-600">{msg}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Envoi…' : 'Envoyer l’invitation'}
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
  const [msg, setMsg] = useState('');

  async function transfer(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const res = await fetch('/api/v1/traiteur/equipe/transfert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_user_id: source, cible_user_id: cible }),
    });
    if (res.ok) {
      const j = (await res.json()) as { data?: { transferes?: number } };
      setMsg(`${j.data?.transferes ?? 0} événement(s) transféré(s).`);
      onDone();
    } else {
      const j = (await res.json()) as { error?: string };
      setMsg(j.error ?? 'Erreur.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transférer les collectes</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-savr-neutral-400">
          Réassigne toutes les collectes d’un collaborateur (ex. en cas de
          départ) vers un autre membre de l’équipe.
        </p>
        <form onSubmit={transfer} className="space-y-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div>
              <label className={labelCls}>Depuis</label>
              <select
                className={inputCls}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                required
              >
                <option value="">— choisir —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.prenom} {u.nom}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Vers</label>
              <select
                className={inputCls}
                value={cible}
                onChange={(e) => setCible(e.target.value)}
                required
              >
                <option value="">— choisir —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.prenom} {u.nom}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {msg && <p className="text-sm text-savr-neutral-600">{msg}</p>}
          <Button type="submit">Transférer</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────── Facturation ──────────────────────────────── */

function FacturationTab({ isManager }: { isManager: boolean }) {
  const [factures, setFactures] = useState<FactureRow[]>([]);
  const [statut, setStatut] = useState('');
  const [type, setType] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');

  useEffect(() => {
    // Filtres §6 l.690 : statut, type, période (date d'émission).
    const params = new URLSearchParams();
    if (statut) params.set('statut', statut);
    if (type) params.set('type', type);
    if (dateDebut) params.set('date_debut', dateDebut);
    if (dateFin) params.set('date_fin', dateFin);
    const qs = params.toString();
    fetch(`/api/v1/traiteur/factures${qs ? `?${qs}` : ''}`)
      .then((r) => r.json())
      .then((j) => setFactures((j.data ?? []) as FactureRow[]));
  }, [statut, type, dateDebut, dateFin]);

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
          <p className="text-xs text-savr-neutral-400">
            Les coordonnées bancaires de règlement figurent sur la facture
            (virement — pas de paiement en ligne en V1).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Factures</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filtres §6 l.690 : statut, type, période */}
          <div className="mb-3 flex flex-wrap gap-2">
            {/* Valeurs = enums réels plateforme.facture_statut / facture_type
                (brouillon exclu par la route ; « En retard » est un badge dérivé
                de date_echeance, pas un statut stocké → non filtrable). */}
            <select
              className="rounded border border-savr-neutral-300 px-2 py-1 text-xs"
              value={statut}
              onChange={(e) => setStatut(e.target.value)}
            >
              <option value="">Tous statuts</option>
              <option value="en_attente_pennylane">En attente</option>
              <option value="emise">Émise</option>
              <option value="payee">Payée</option>
              <option value="annulee">Annulée</option>
            </select>
            <select
              className="rounded border border-savr-neutral-300 px-2 py-1 text-xs"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">Tous types</option>
              <option value="zero_dechet">ZD</option>
              <option value="collecte_antigaspi">AG</option>
              <option value="achat_pack_antigaspi">Pack</option>
              <option value="avoir">Avoir</option>
            </select>
            <input
              type="date"
              aria-label="Période — du"
              className="rounded border border-savr-neutral-300 px-2 py-1 text-xs"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
            />
            <input
              type="date"
              aria-label="Période — au"
              className="rounded border border-savr-neutral-300 px-2 py-1 text-xs"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </div>
          {factures.length === 0 ? (
            <p className="text-sm text-savr-neutral-500">Aucune facture.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-savr-neutral-500">
                <tr>
                  <th className="py-1">Numéro</th>
                  <th className="py-1">Émission</th>
                  <th className="py-1">Échéance</th>
                  <th className="py-1">Montant TTC</th>
                  <th className="py-1">Statut</th>
                  <th className="py-1">PDF</th>
                </tr>
              </thead>
              <tbody>
                {factures.map((f) => {
                  const pdf = f.pdf_url_pennylane ?? f.pdf_url_savr;
                  return (
                    <tr key={f.id} className="border-t border-savr-neutral-100">
                      <td className="py-1">{f.numero_facture ?? '—'}</td>
                      <td className="py-1">{f.date_emission ?? '—'}</td>
                      <td className="py-1">{f.date_echeance ?? '—'}</td>
                      <td className="py-1">
                        {f.montant_ttc != null ? `${f.montant_ttc} €` : '—'}
                      </td>
                      <td className="py-1">
                        <Badge variant="neutral">{f.statut}</Badge>
                      </td>
                      <td className="py-1">
                        {pdf ? (
                          <a
                            href={pdf}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-savr-primary-700 underline"
                          >
                            Télécharger
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────────── Préférences ──────────────────────────────── */

function PreferencesTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Préférences</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <span className="text-savr-neutral-500">
            Langue de l’interface :{' '}
          </span>
          Français (FR)
        </div>
        <p className="text-xs text-savr-neutral-400">
          La gestion des notifications email par type d’événement sera
          disponible ultérieurement.
        </p>
      </CardContent>
    </Card>
  );
}
