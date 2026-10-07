'use client';

import * as React from 'react';
import { AlertBar } from '@/components/ui/alert-bar';
import { FormActions } from '@/components/ui/form-actions';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { BORNES_DEMANDE_AJOUT } from '@/lib/lieux/demande-ajout';

// « Demander l'ajout d'un lieu » — liste Lieux du gestionnaire (§06.05 §3
// « Ajout / retrait lieu », arbitrage Val 2026-10-07). Le gestionnaire ne
// rattache pas un lieu lui-même : ce formulaire dépose une demande dans la file
// de l'Admin Savr (nom et adresse obligatoires, précision facultative), qui
// crée ou rattache le lieu à la main. Les bornes sont celles de la route.

const FORM_ID = 'demande-ajout-lieu';
const {
  nom: NOM,
  adresse: ADRESSE,
  precision: PRECISION,
} = BORNES_DEMANDE_AJOUT;

export function DemandeAjoutLieuModal({
  onClose,
  onDemandeEnCours,
}: {
  // Monté par la liste seulement quand le formulaire est ouvert.
  onClose: () => void;
  /** Une demande est ouverte pour l'organisation : celle-ci, ou une autre (409). */
  onDemandeEnCours: () => void;
}) {
  const { toast } = useToast();
  const [nom, setNom] = React.useState('');
  const [adresse, setAdresse] = React.useState('');
  const [precision, setPrecision] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const fermer = () => {
    if (!envoi) onClose();
  };

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch('/api/v1/gestionnaire/lieux/demande-ajout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nom, adresse, precision }),
      });
      // 409 : une demande est déjà ouverte pour l'organisation (collègue,
      // autre onglet) — même issue qu'un envoi réussi, le bouton se neutralise.
      if (r.ok || r.status === 409) {
        toast(
          r.ok
            ? {
                variant: 'success',
                title: 'Demande envoyée',
                description: 'L’équipe Savr a bien reçu votre demande.',
              }
            : {
                variant: 'info',
                title: 'Demande déjà en cours',
                description:
                  'Une demande d’ajout est déjà en cours de traitement par l’équipe Savr.',
              },
        );
        onDemandeEnCours();
        onClose();
        return;
      }
      // Seul le refus de saisie (422) porte un motif écrit pour le
      // gestionnaire ; une panne ou une session expirée rendent un message
      // technique (« Erreur serveur »), qui ne s'affiche pas.
      const j =
        r.status === 422
          ? ((await r.json().catch(() => null)) as { error?: unknown } | null)
          : null;
      setErreur(
        typeof j?.error === 'string'
          ? j.error
          : 'La demande n’a pas pu être envoyée. Réessayez.',
      );
    } catch {
      setErreur(
        'La demande n’a pas pu être envoyée. Vérifiez votre connexion puis réessayez.',
      );
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal
      open
      title="Demander l’ajout d’un lieu"
      onClose={fermer}
      footer={
        <FormActions
          cancel={{ label: 'Annuler', onClick: fermer }}
          submit={{ label: 'Envoyer la demande', form: FORM_ID }}
          loading={envoi}
          loadingText="Envoi…"
        />
      }
    >
      <form
        id={FORM_ID}
        onSubmit={(e) => void envoyer(e)}
        className="space-y-4"
      >
        {erreur && <AlertBar variant="err">{erreur}</AlertBar>}
        <Text variant="body">
          Le rattachement d’un lieu à votre organisation est réalisé par
          l’équipe Savr. Indiquez le lieu souhaité : votre demande lui est
          transmise.
        </Text>
        <FormField label="Nom du lieu" htmlFor={`${FORM_ID}-nom`} required>
          <Input
            id={`${FORM_ID}-nom`}
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            minLength={NOM.min}
            maxLength={NOM.max}
            required
          />
        </FormField>
        <FormField
          label="Adresse"
          htmlFor={`${FORM_ID}-adresse`}
          hint="Numéro et rue, code postal, ville."
          required
        >
          <Input
            id={`${FORM_ID}-adresse`}
            value={adresse}
            onChange={(e) => setAdresse(e.target.value)}
            minLength={ADRESSE.min}
            maxLength={ADRESSE.max}
            autoComplete="off"
            required
          />
        </FormField>
        <FormField
          label="Précision (facultatif)"
          htmlFor={`${FORM_ID}-precision`}
        >
          <Textarea
            id={`${FORM_ID}-precision`}
            rows={3}
            value={precision}
            onChange={(e) => setPrecision(e.target.value)}
            maxLength={PRECISION.max}
            placeholder="Exemple : espace concerné, date du premier événement prévu."
          />
        </FormField>
      </form>
    </Modal>
  );
}
