'use client';

/**
 * Invitation d'un utilisateur dans une organisation (R-UI-5, G5) — un seul
 * composant pour les 4 écrans qui en recopiaient chacun une version :
 *
 *  - forme MODALE (`InviterUtilisateurModal`) : back-office Admin, provisioning
 *    direct `POST /api/v1/admin/users` (compte créé + lien d'activation envoyé
 *    côté serveur, BL-P1-BOA-09, §06.06 §8). Paramètres > Utilisateurs fait
 *    choisir l'organisation ; la fiche organisation l'impose (`organisationId`).
 *    Rôles proposés = ceux passés par l'appelant (le serveur ré-applique les
 *    gardes : admin_savr réservé à un admin_savr, rôles du type d'organisation).
 *  - forme CARTE inline (`InviterUtilisateurCarte`) : « Mon organisation » des
 *    espaces traiteur et gestionnaire, rôle imposé par l'endpoint ou le corps
 *    envoyé. Succès = Toast 4 s, erreur = bandeau inline (R-UI-1 H1).
 *
 * Champs communs : prénom, nom, email (obligatoires). Erreur serveur affichée
 * telle que renvoyée (`error`), sinon le message par défaut de l'écran.
 */

import * as React from 'react';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import {
  Autocomplete,
  type AutocompleteOption,
} from '@/components/ui/autocomplete';
import { FormActions } from '@/components/ui/form-actions';
import { useToast } from '@/components/ui/toast';
import { libelleRole } from '@/lib/libelles/role';

export interface IdentiteInvite {
  prenom: string;
  nom: string;
  email: string;
}

// ── Envoi commun ─────────────────────────────────────────────────────────────

// POST JSON vers l'endpoint ; `onSucces` s'exécute avant la fin de l'état
// « en cours » (le bouton reste en chargement pendant un rechargement de liste).
function useEnvoiInvitation(endpoint: string, erreurParDefaut: string) {
  const [enCours, setEnCours] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  async function envoyer(
    corps: Record<string, unknown>,
    onSucces: () => void | Promise<void>,
  ) {
    setEnCours(true);
    setErreur(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErreur(j.error ?? erreurParDefaut);
        return;
      }
      await onSucces();
    } finally {
      setEnCours(false);
    }
  }

  return { enCours, erreur, setErreur, envoyer };
}

const VIDE: IdentiteInvite = { prenom: '', nom: '', email: '' };

interface ChampDef {
  cle: keyof IdentiteInvite;
  label: string;
  type?: 'text' | 'email';
  autoComplete: string;
}
const PRENOM: ChampDef = {
  cle: 'prenom',
  label: 'Prénom',
  autoComplete: 'given-name',
};
const NOM: ChampDef = { cle: 'nom', label: 'Nom', autoComplete: 'family-name' };
const EMAIL: ChampDef = {
  cle: 'email',
  label: 'Email',
  type: 'email',
  autoComplete: 'email',
};

// Un champ d'identité (prénom / nom / email), obligatoire.
function ChampIdentite({
  champ,
  idPrefix,
  valeurs,
  onChange,
  ariaLabel,
  autoComplete,
}: {
  champ: ChampDef;
  idPrefix: string;
  valeurs: IdentiteInvite;
  onChange: React.Dispatch<React.SetStateAction<IdentiteInvite>>;
  /** Nom accessible = libellé seul (sans l'astérisque). */
  ariaLabel?: boolean;
  /** Indices d'autocomplétion navigateur (given-name, family-name, email). */
  autoComplete?: boolean;
}) {
  const id = `${idPrefix}-${champ.cle}`;
  return (
    <FormField label={champ.label} htmlFor={id} required>
      <Input
        id={id}
        type={champ.type ?? (autoComplete ? 'text' : undefined)}
        autoComplete={autoComplete ? champ.autoComplete : undefined}
        value={valeurs[champ.cle]}
        aria-label={ariaLabel ? champ.label : undefined}
        onChange={(e) => {
          const valeur = e.target.value;
          onChange((v) => ({ ...v, [champ.cle]: valeur }));
        }}
        required
      />
    </FormField>
  );
}

// ── Forme modale (back-office Admin) ─────────────────────────────────────────

export function InviterUtilisateurModal({
  titre,
  roles,
  roleInitial,
  organisationId,
  rechercherOrganisations,
  idPrefix,
  formId,
  onClose,
  onCreated,
}: {
  /** « Inviter un membre », « Ajouter un utilisateur »… */
  titre: string;
  /** Rôles proposés (valeurs) ; libellés via `libelleRole`. */
  roles: string[];
  roleInitial: string;
  /** Organisation imposée (fiche organisation) — pas de sélecteur. */
  organisationId?: string;
  /** Sans `organisationId` : recherche des organisations du sélecteur. */
  rechercherOrganisations?: (q: string) => Promise<AutocompleteOption[]>;
  /** Préfixe des ids de champ (`<prefix>-prenom`, `-nom`, `-email`, `-role`). */
  idPrefix: string;
  formId: string;
  onClose: () => void;
  onCreated: () => void;
}): React.ReactElement {
  const [valeurs, setValeurs] = React.useState<IdentiteInvite>(VIDE);
  const [role, setRole] = React.useState(roleInitial);
  const [org, setOrg] = React.useState<AutocompleteOption | null>(null);
  const { enCours, erreur, setErreur, envoyer } = useEnvoiInvitation(
    '/api/v1/admin/users',
    "Erreur lors de l'invitation",
  );
  const choixOrganisation = organisationId === undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const orgId = organisationId ?? org?.id;
    if (!orgId) {
      setErreur('Sélectionnez une organisation.');
      return;
    }
    await envoyer(
      {
        prenom: valeurs.prenom,
        nom: valeurs.nom,
        email: valeurs.email,
        role,
        organisation_id: orgId,
      },
      onCreated,
    );
  }

  const champ = (c: ChampDef) => (
    <ChampIdentite
      champ={c}
      idPrefix={idPrefix}
      valeurs={valeurs}
      onChange={setValeurs}
      ariaLabel
    />
  );

  return (
    <Modal
      open
      title={titre}
      onClose={onClose}
      footer={
        <FormActions
          cancel={{ label: 'Annuler', onClick: onClose }}
          submit={{ label: 'Inviter', form: formId }}
          loading={enCours}
          loadingText="Invitation…"
        />
      }
    >
      {erreur && (
        <AlertBar variant="err" className="mb-4">
          {erreur}
        </AlertBar>
      )}

      <form id={formId} onSubmit={(e) => void submit(e)} className="space-y-4">
        <FormGrid>
          {champ(PRENOM)}
          {champ(NOM)}
        </FormGrid>
        {champ(EMAIL)}

        <FormField label="Rôle" htmlFor={`${idPrefix}-role`}>
          <Combobox
            id={`${idPrefix}-role`}
            aria-label="Rôle"
            icon={null}
            options={roles.map((r) => ({ value: r, label: libelleRole(r) }))}
            value={role}
            onChange={setRole}
          />
        </FormField>

        {choixOrganisation && rechercherOrganisations && (
          <FormField
            label="Organisation"
            htmlFor="invite-organisation"
            required
          >
            <Autocomplete
              id="invite-organisation"
              aria-label="Organisation"
              placeholder="Rechercher une organisation…"
              fetchOptions={rechercherOrganisations}
              selected={org}
              onChange={setOrg}
            />
          </FormField>
        )}
      </form>
    </Modal>
  );
}

// ── Forme carte inline (espaces clients « Mon organisation ») ────────────────

export function InviterUtilisateurCarte({
  titre,
  endpoint,
  corps = (identite) => ({ ...identite }),
  erreurParDefaut,
  libelleBouton,
  aide,
  autoComplete = false,
  onInvited,
}: {
  titre: string;
  endpoint: string;
  /** Corps JSON envoyé (rôle imposé, ordre des clés du contrat de l'endpoint). */
  corps?: (identite: IdentiteInvite) => Record<string, unknown>;
  erreurParDefaut: string;
  libelleBouton: string;
  /** Mention sous les champs (rôle attribué…). */
  aide?: React.ReactNode;
  /** Indices d'autocomplétion navigateur sur les champs. */
  autoComplete?: boolean;
  /** Après succès (Toast + champs vidés) : rechargement de la liste. */
  onInvited: () => void | Promise<void>;
}) {
  const [valeurs, setValeurs] = React.useState<IdentiteInvite>(VIDE);
  const { enCours, erreur, envoyer } = useEnvoiInvitation(
    endpoint,
    erreurParDefaut,
  );
  const { toast } = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await envoyer(corps(valeurs), async () => {
      toast({ title: 'Invitation envoyée.', variant: 'success' });
      setValeurs(VIDE);
      await onInvited();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titre}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <FormGrid cols={3}>
            {[PRENOM, NOM, EMAIL].map((c) => (
              <ChampIdentite
                key={c.cle}
                champ={c}
                idPrefix="invite"
                valeurs={valeurs}
                onChange={setValeurs}
                autoComplete={autoComplete}
              />
            ))}
          </FormGrid>
          {aide}
          {erreur && (
            <AlertBar variant="err" role="alert">
              {erreur}
            </AlertBar>
          )}
          <Button type="submit" loading={enCours} loadingText="Envoi…">
            {libelleBouton}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
