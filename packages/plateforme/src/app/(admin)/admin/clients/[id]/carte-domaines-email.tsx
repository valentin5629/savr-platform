'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertBar } from '@/components/ui/alert-bar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TagIcon } from '@/components/ui/icones';
import { Text } from '@/components/ui/text';

// Domaines email de l'organisation (CDC §06.06 « Domaines email ») : un domaine
// VÉRIFIÉ rattache automatiquement les futurs inscrits de ce domaine à
// l'organisation. L'équipe Savr ajoute un domaine déjà vérifié (Val 2026-10-30),
// peut retirer ou rétablir la vérification, et retirer le domaine.

export interface DomaineEmail {
  id: string;
  domaine: string;
  verifie_at: string | null;
}

interface Props {
  organisationId: string;
  /** Un client organisateur n'est jamais en libre-service : aucun domaine ne
   * le rattache (CLAUDE.md §4), donc ni ajout ni vérification. */
  clientOrganisateur: boolean;
  domaines: DomaineEmail[];
  onChange: () => void;
}

export function CarteDomainesEmail({
  organisationId,
  clientOrganisateur,
  domaines,
  onChange,
}: Props) {
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [aRetirer, setARetirer] = useState<DomaineEmail | null>(null);

  const base = `/api/v1/admin/organisations/${encodeURIComponent(organisationId)}/domaines-email`;

  async function appeler(cle: string, url: string, init: RequestInit) {
    setEnCours(cle);
    setErreur(null);
    try {
      const r = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await r.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!r.ok) {
        setErreur(data?.error ?? 'Enregistrement impossible');
        return false;
      }
      onChange();
      return true;
    } catch {
      setErreur('Connexion impossible, réessayez.');
      return false;
    } finally {
      setEnCours(null);
    }
  }

  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    const ok = await appeler('ajout', base, {
      method: 'POST',
      body: JSON.stringify({ domaine: saisie }),
    });
    if (ok) setSaisie('');
  }

  async function retirer() {
    if (!aRetirer) return;
    const ok = await appeler(
      aRetirer.id,
      `${base}/${encodeURIComponent(aRetirer.id)}`,
      { method: 'DELETE' },
    );
    if (ok) setARetirer(null);
  }

  return (
    <Card padding="lg" className="space-y-4 md:col-span-2">
      <SectionHeader icon={TagIcon} title="Domaines email" />
      {erreur && !aRetirer && <AlertBar variant="err">{erreur}</AlertBar>}
      {domaines.length === 0 ? (
        <EmptyState
          size="inline"
          title="Aucun domaine email pour cette organisation."
        />
      ) : (
        <ul className="space-y-1">
          {domaines.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-3 border-b border-savr-neutral-100 py-2 last:border-0"
            >
              <span className="flex-1 font-mono text-sm">@{d.domaine}</span>
              <Badge variant={d.verifie_at ? 'success' : 'warning'}>
                {d.verifie_at ? 'Vérifié' : 'Non vérifié'}
              </Badge>
              {(d.verifie_at || !clientOrganisateur) && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={enCours === d.id}
                  onClick={() =>
                    void appeler(d.id, `${base}/${encodeURIComponent(d.id)}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ verifie: !d.verifie_at }),
                    })
                  }
                >
                  {d.verifie_at
                    ? 'Retirer la vérification'
                    : 'Marquer comme vérifié'}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setErreur(null);
                  setARetirer(d);
                }}
                aria-label={`Retirer @${d.domaine}`}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      )}
      {clientOrganisateur ? (
        <Text>
          Un client organisateur ne rejoint pas Savr en libre-service : ses
          comptes sont créés par l’équipe Savr, aucun domaine ne le rattache.
        </Text>
      ) : (
        <form
          onSubmit={(e) => void ajouter(e)}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <Input
            aria-label="Domaine à ajouter"
            placeholder="monentreprise.fr"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            className="sm:max-w-xs"
          />
          <Button
            type="submit"
            size="sm"
            loading={enCours === 'ajout'}
            disabled={!saisie.trim()}
          >
            Ajouter le domaine
          </Button>
        </form>
      )}

      <ConfirmDialog
        open={aRetirer !== null}
        title="Retirer le domaine"
        confirmLabel="Retirer"
        cancelLabel="Annuler"
        variant="destructive"
        loading={aRetirer !== null && enCours === aRetirer.id}
        loadingText="Retrait…"
        error={aRetirer ? erreur : null}
        onConfirm={() => void retirer()}
        onCancel={() => setARetirer(null)}
      >
        Les personnes qui s’inscriront avec une adresse @{aRetirer?.domaine} ne
        seront plus rattachées automatiquement à cette organisation. Les comptes
        existants ne changent pas.
      </ConfirmDialog>
    </Card>
  );
}
