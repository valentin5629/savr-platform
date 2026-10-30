'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { FormActions } from '@/components/ui/form-actions';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { LogoUpload } from '@/components/admin/logo-upload';
import { LIBELLE_TYPE_ORGANISATION } from '@/lib/libelles/organisation';

// Modification des informations légales d'une organisation par l'équipe Savr
// (CDC §06.06 « Informations légales » : édition admin/ops ; Val 2026-10-30).
// Route existante : PATCH /api/v1/admin/organisations/{id} (allowlist serveur,
// SIRET au format seul, type gardé si l'organisation gère des lieux).

export interface InformationsLegales {
  nom: string;
  raison_sociale: string | null;
  type: string;
  siret: string | null;
  email_principal: string | null;
  telephone: string | null;
  adresse: string | null;
  logo_url: string | null;
}

interface Props {
  organisationId: string;
  valeurs: InformationsLegales;
  onClose: () => void;
  onSaved: () => void;
}

export function ModaleInformationsLegales({
  organisationId,
  valeurs,
  onClose,
  onSaved,
}: Props) {
  // Montée à l'ouverture (page.tsx) : l'état part des valeurs de la fiche.
  const [f, setF] = useState(valeurs);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  function champ<K extends keyof InformationsLegales>(
    k: K,
    v: InformationsLegales[K],
  ) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const vide = (s: string | null) => (s && s.trim() ? s.trim() : null);
    try {
      const r = await fetch(
        `/api/v1/admin/organisations/${encodeURIComponent(organisationId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nom: f.nom.trim(),
            raison_sociale: vide(f.raison_sociale),
            type: f.type,
            siret: vide(f.siret),
            email_principal: vide(f.email_principal),
            telephone: vide(f.telephone),
            adresse: vide(f.adresse),
            logo_url: vide(f.logo_url),
          }),
        },
      );
      const data = (await r.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!r.ok) {
        setErreur(data?.error ?? 'Enregistrement impossible');
        return;
      }
      onSaved();
      onClose();
    } catch {
      setErreur('Connexion impossible, réessayez.');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      title="Modifier les informations légales"
      onClose={onClose}
      wide
      footer={
        <FormActions
          cancel={{ label: 'Annuler', onClick: onClose }}
          submit={{ label: 'Enregistrer', form: 'informations-legales-form' }}
          loading={envoi}
          loadingText="Enregistrement…"
        />
      }
    >
      {erreur && (
        <AlertBar variant="err" className="mb-4">
          {erreur}
        </AlertBar>
      )}
      <form
        id="informations-legales-form"
        onSubmit={(e) => void soumettre(e)}
        className="space-y-4"
      >
        <FormGrid cols={2}>
          <FormField label="Nom" htmlFor="org-nom" required>
            <Input
              id="org-nom"
              value={f.nom}
              onChange={(e) => champ('nom', e.target.value)}
              required
            />
          </FormField>
          <FormField label="Raison sociale" htmlFor="org-raison-sociale">
            <Input
              id="org-raison-sociale"
              value={f.raison_sociale ?? ''}
              onChange={(e) => champ('raison_sociale', e.target.value)}
            />
          </FormField>
          <FormField label="Type" htmlFor="org-type" required>
            <Combobox
              id="org-type"
              icon={null}
              options={Object.entries(LIBELLE_TYPE_ORGANISATION).map(
                ([value, label]) => ({ value, label }),
              )}
              value={f.type}
              onChange={(t) => champ('type', t)}
            />
          </FormField>
          <FormField label="SIREN/SIRET" htmlFor="org-siret">
            <Input
              id="org-siret"
              inputMode="numeric"
              value={f.siret ?? ''}
              onChange={(e) => champ('siret', e.target.value)}
              placeholder="14 chiffres"
            />
          </FormField>
          <FormField label="Email" htmlFor="org-email" required>
            <Input
              id="org-email"
              type="email"
              value={f.email_principal ?? ''}
              onChange={(e) => champ('email_principal', e.target.value)}
              required
            />
          </FormField>
          <FormField label="Téléphone" htmlFor="org-telephone">
            <Input
              id="org-telephone"
              type="tel"
              value={f.telephone ?? ''}
              onChange={(e) => champ('telephone', e.target.value)}
            />
          </FormField>
          <FormField
            label="Adresse"
            htmlFor="org-adresse"
            className="sm:col-span-2"
          >
            <Input
              id="org-adresse"
              value={f.adresse ?? ''}
              onChange={(e) => champ('adresse', e.target.value)}
            />
          </FormField>
          <FormField label="Logo" htmlFor="org-logo" className="sm:col-span-2">
            <LogoUpload
              inputId="org-logo"
              value={f.logo_url ?? ''}
              onChange={(v) => champ('logo_url', v)}
            />
          </FormField>
        </FormGrid>
      </form>
    </Modal>
  );
}
