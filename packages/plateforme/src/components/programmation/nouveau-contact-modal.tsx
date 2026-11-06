'use client';

import { useState } from 'react';
import { FormActions } from '@/components/ui/form-actions';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import type { ContactOption } from '@/components/programmation/contact-combobox';

const CONTACT_VIDE = { prenom: '', nom: '', telephone: '', fonction: '' };

/**
 * « Ajouter un nouveau contact » du sélecteur de contacts : crée le contact
 * dans le répertoire de l'organisation (POST /api/v1/programmation/contacts)
 * et le rend à l'appelant. Commune à la page « Ajouter une collecte » et à la
 * modification sur place d'une carte de la fiche événement.
 */
export function NouveauContactModal({
  open,
  organisationId,
  onClose,
  onCree,
}: {
  open: boolean;
  /** Organisation cible : honorée par la route pour le staff seulement. */
  organisationId?: string | null;
  onClose: () => void;
  onCree: (contact: ContactOption) => void;
}) {
  const [contact, setContact] = useState(CONTACT_VIDE);
  const complet = !!contact.prenom && !!contact.nom && !!contact.telephone;

  const fermer = () => {
    setContact(CONTACT_VIDE);
    onClose();
  };

  const ajouter = async () => {
    if (!complet) return;
    const res = await fetch('/api/v1/programmation/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        organisationId
          ? { ...contact, organisation_id: organisationId }
          : contact,
      ),
    });
    if (!res.ok) return;
    onCree((await res.json()) as ContactOption);
    setContact(CONTACT_VIDE);
  };

  return (
    <Modal
      open={open}
      title="Nouveau contact"
      onClose={fermer}
      footer={
        <FormActions
          cancel={{ label: 'Annuler', onClick: fermer }}
          submit={{
            label: 'Ajouter',
            onClick: () => void ajouter(),
            disabled: !complet,
          }}
        />
      }
    >
      <div className="space-y-4">
        <FormGrid>
          <FormField label="Prénom" htmlFor="contact-prenom" required>
            <Input
              id="contact-prenom"
              required
              value={contact.prenom}
              onChange={(e) =>
                setContact((p) => ({ ...p, prenom: e.target.value }))
              }
              placeholder="Prénom"
            />
          </FormField>
          <FormField label="Nom" htmlFor="contact-nom" required>
            <Input
              id="contact-nom"
              required
              value={contact.nom}
              onChange={(e) =>
                setContact((p) => ({ ...p, nom: e.target.value }))
              }
              placeholder="Nom"
            />
          </FormField>
        </FormGrid>
        <FormField label="Téléphone" htmlFor="contact-tel" required>
          <Input
            id="contact-tel"
            type="tel"
            required
            value={contact.telephone}
            onChange={(e) =>
              setContact((p) => ({ ...p, telephone: e.target.value }))
            }
            placeholder="06 12 34 56 78"
          />
        </FormField>
        <FormField label="Fonction (optionnel)" htmlFor="contact-fonction">
          <Input
            id="contact-fonction"
            value={contact.fonction}
            onChange={(e) =>
              setContact((p) => ({ ...p, fonction: e.target.value }))
            }
            placeholder="Ex : Responsable salle"
          />
        </FormField>
      </div>
    </Modal>
  );
}
