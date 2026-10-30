'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { FormActions } from '@/components/ui/form-actions';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

// Ajout / modification d'une entité de facturation par l'équipe Savr depuis la
// fiche organisation (Val 2026-10-30). Le SIRET est vérifié à l'INSEE côté
// serveur, comme dans l'espace du manager traiteur (CDC §06.04 §6).

export interface EntiteFacturation {
  id: string;
  raison_sociale: string;
  siret: string;
  tva_intracom: string | null;
  adresse_facturation: string;
  code_postal: string;
  ville: string;
  email_facturation: string | null;
  contact_compta_nom: string | null;
  entite_par_defaut: boolean;
  actif?: boolean;
}

type Champs = Omit<EntiteFacturation, 'id'>;

const VIDE: Champs = {
  raison_sociale: '',
  siret: '',
  tva_intracom: '',
  adresse_facturation: '',
  code_postal: '',
  ville: '',
  email_facturation: '',
  contact_compta_nom: '',
  entite_par_defaut: false,
};

interface Props {
  organisationId: string;
  /** Entité à modifier ; absente = ajout. */
  entite: EntiteFacturation | null;
  /** Ajout de la première entité : cochée « par défaut » d'office. */
  premiere: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ModaleEntiteFacturation({
  organisationId,
  entite,
  premiere,
  onClose,
  onSaved,
}: Props) {
  // Montée à l'ouverture (page.tsx) : l'état part de l'entité, ou d'un
  // formulaire vide pour un ajout.
  const [f, setF] = useState<Champs>(() =>
    entite ? { ...entite } : { ...VIDE, entite_par_defaut: premiere },
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  function champ<K extends keyof Champs>(k: K, v: Champs[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const base = `/api/v1/admin/organisations/${encodeURIComponent(organisationId)}/entites-facturation`;
    try {
      const r = await fetch(
        entite ? `${base}/${encodeURIComponent(entite.id)}` : base,
        {
          method: entite ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(f),
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
      title={
        entite
          ? 'Modifier l’entité de facturation'
          : 'Ajouter une entité de facturation'
      }
      onClose={onClose}
      wide
      footer={
        <FormActions
          cancel={{ label: 'Annuler', onClick: onClose }}
          submit={{
            label: entite ? 'Enregistrer' : 'Ajouter',
            form: 'entite-facturation-form',
          }}
          loading={envoi}
          loadingText="Vérification du SIRET…"
        />
      }
    >
      {erreur && (
        <AlertBar variant="err" className="mb-4">
          {erreur}
        </AlertBar>
      )}
      <form
        id="entite-facturation-form"
        onSubmit={(e) => void soumettre(e)}
        className="space-y-4"
      >
        <FormGrid cols={2}>
          <FormField
            label="Raison sociale"
            htmlFor="ef-raison-sociale"
            required
          >
            <Input
              id="ef-raison-sociale"
              value={f.raison_sociale}
              onChange={(e) => champ('raison_sociale', e.target.value)}
              required
            />
          </FormField>
          <FormField label="SIRET" htmlFor="ef-siret" required>
            <Input
              id="ef-siret"
              inputMode="numeric"
              value={f.siret}
              onChange={(e) => champ('siret', e.target.value)}
              placeholder="14 chiffres"
              required
            />
          </FormField>
          <FormField
            label="Adresse"
            htmlFor="ef-adresse"
            required
            className="sm:col-span-2"
          >
            <Input
              id="ef-adresse"
              value={f.adresse_facturation}
              onChange={(e) => champ('adresse_facturation', e.target.value)}
              required
            />
          </FormField>
          <FormField label="Code postal" htmlFor="ef-code-postal" required>
            <Input
              id="ef-code-postal"
              value={f.code_postal}
              onChange={(e) => champ('code_postal', e.target.value)}
              required
            />
          </FormField>
          <FormField label="Ville" htmlFor="ef-ville" required>
            <Input
              id="ef-ville"
              value={f.ville}
              onChange={(e) => champ('ville', e.target.value)}
              required
            />
          </FormField>
          <FormField label="TVA intracommunautaire" htmlFor="ef-tva">
            <Input
              id="ef-tva"
              value={f.tva_intracom ?? ''}
              onChange={(e) => champ('tva_intracom', e.target.value)}
            />
          </FormField>
          <FormField label="Email de facturation" htmlFor="ef-email">
            <Input
              id="ef-email"
              type="email"
              value={f.email_facturation ?? ''}
              onChange={(e) => champ('email_facturation', e.target.value)}
            />
          </FormField>
          <FormField label="Contact comptabilité" htmlFor="ef-contact">
            <Input
              id="ef-contact"
              value={f.contact_compta_nom ?? ''}
              onChange={(e) => champ('contact_compta_nom', e.target.value)}
            />
          </FormField>
        </FormGrid>
        <Label
          variant="choice"
          htmlFor="ef-defaut"
          className="flex items-center gap-2"
        >
          <Checkbox
            id="ef-defaut"
            checked={f.entite_par_defaut}
            // L'entité par défaut le reste tant qu'une autre ne la remplace pas.
            // Une entité désactivée ne peut pas devenir l'entité par défaut.
            disabled={
              entite?.entite_par_defaut === true || entite?.actif === false
            }
            onCheckedChange={(v) => champ('entite_par_defaut', v === true)}
          />
          Entité de facturation par défaut
        </Label>
      </form>
    </Modal>
  );
}
