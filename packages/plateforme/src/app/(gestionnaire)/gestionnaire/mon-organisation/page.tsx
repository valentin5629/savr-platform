'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
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
  patch: Partial<Pick<OrgProfil, 'adresse' | 'logo_url'>>,
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

// §06.05 §6 Bloc Organisation : nom en lecture seule (modification via
// support), adresse modifiable. Raison sociale, SIRET, email et téléphone sont
// affichés en lecture seule (réservés à l'Admin).
function InformationsCard({
  profil,
  onSaved,
}: {
  profil: OrgProfil;
  onSaved: (p: OrgProfil) => void;
}) {
  const [adresse, setAdresse] = useState(profil.adresse ?? '');
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErreur('');
    setSucces('');
    try {
      const p = await patchProfil({ adresse });
      setAdresse(p.adresse ?? '');
      setSucces('Adresse enregistrée.');
      onSaved(p);
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const lectureSeule = [
    ['Nom', profil.nom, 'Modification via le support Savr'],
    ['Raison sociale', profil.raison_sociale, null],
    ['SIRET', profil.siret, null],
    ['Email', profil.email_principal, null],
    ['Téléphone', profil.telephone, null],
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          {lectureSeule.map(([libelle, valeur, aide]) => (
            <div key={libelle}>
              <dt className="font-semibold text-savr-neutral-700">{libelle}</dt>
              <dd className="text-savr-neutral-900">{valeur ?? '—'}</dd>
              {aide && (
                <dd className="text-xs text-savr-neutral-500">{aide}</dd>
              )}
            </div>
          ))}
        </dl>
        <form onSubmit={save} className="space-y-3 md:max-w-xl">
          <FormField label="Adresse" htmlFor="org-adresse" error={erreur}>
            <Input
              id="org-adresse"
              value={adresse}
              maxLength={500}
              onChange={(e) => setAdresse(e.target.value)}
              error={!!erreur}
            />
          </FormField>
          {succes && (
            <p role="status" className="text-sm text-savr-success-strong">
              {succes}
            </p>
          )}
          <Button
            type="submit"
            disabled={saving || adresse === (profil.adresse ?? '')}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
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
      const p = await patchProfil({ logo_url: j.logo_url });
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
        {profil.logo_url ? (
          <img
            // La clé change à chaque upload : force le rechargement du proxy.
            src={`${LOGO_URL}?v=${encodeURIComponent(profil.logo_url)}`}
            alt="Logo de l'organisation"
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
          <InformationsCard profil={profil} onSaved={setProfil} />
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
                  {factures.map((f) => {
                    // §06.04 §6 fiche facture : Pennylane si dispo, sinon Savr.
                    const pdf = f.pdf_url_pennylane ?? f.pdf_url_savr;
                    return (
                      <tr
                        key={f.id}
                        className="border-t border-savr-neutral-100"
                      >
                        <td className="py-1">{f.numero_facture ?? '—'}</td>
                        <td className="py-1">{f.date_emission ?? '—'}</td>
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
                              className="text-savr-primary-700 underline text-xs"
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
      )}
    </div>
  );
}
