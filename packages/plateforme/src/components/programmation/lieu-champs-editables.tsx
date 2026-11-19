'use client';

import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import type { LieuOption } from './lieu-combobox';
import { Text } from '@/components/ui/text';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  emplacementCorrespondant,
  ligneAdresseLivraison,
  nomAdresseLivraison,
  type AdresseLivraison,
} from '@/lib/lieux/adresses-livraison';

// PROG-01 (CDC §06.01 l.104-114) : à la sélection d'un lieu, ses champs s'affichent
// pré-remplis et ÉDITABLES. Toute valeur modifiée est stockée dans
// collectes.lieu_overrides (le référentiel lieu n'est PAS mis à jour). Les champs
// admin/ops-only (commentaire_lieu, siren, email_gestionnaire, reference_citeo) ne sont
// jamais exposés. Stationnement, accès office, type de véhicule max, contraintes
// horaires et flux acceptés sont retirés du formulaire, pour tous les rôles (décision
// Val 2026-10-16) : ils restent dans le référentiel lieu, renseignés par l'équipe Savr.

export interface LieuEdits {
  adresse_acces: string;
  code_postal: string;
  ville: string;
  acces_details: string;
}

export function lieuToEdits(lieu: LieuOption): LieuEdits {
  return {
    adresse_acces: lieu.adresse_acces ?? '',
    code_postal: lieu.code_postal ?? '',
    ville: lieu.ville ?? '',
    acces_details: lieu.acces_details ?? '',
  };
}

/**
 * Diff des éditions vs valeurs de référence du lieu → override (clés modifiées
 * seules). Exception : une adresse de livraison n° 2 ou n° 3 choisie parmi celles
 * du lieu (Val 2026-11-19) est recopiée EN ENTIER (adresse, code postal, ville),
 * pour que la collecte garde cette adresse même si le lieu change ensuite.
 */
export function computeLieuOverrides(
  base: LieuEdits,
  edits: LieuEdits,
  adresses: AdresseLivraison[] = [],
): Record<string, string> {
  const overrides: Record<string, string> = {};
  (Object.keys(edits) as (keyof LieuEdits)[]).forEach((k) => {
    if (edits[k] !== base[k]) overrides[k] = edits[k];
  });
  const choisie = adresseChoisie(edits, adresses);
  if (choisie && choisie.numero > 1) {
    overrides.adresse_acces = choisie.adresse_acces;
    overrides.code_postal = choisie.code_postal;
    overrides.ville = choisie.ville;
  }
  return overrides;
}

/** Adresse de livraison du lieu qui correspond à la saisie, ou `null`. */
function adresseChoisie(
  edits: LieuEdits,
  adresses: AdresseLivraison[],
): AdresseLivraison | null {
  // `emplacementCorrespondant` lit un lieu : on lui rend ses colonnes à partir
  // de la liste déjà calculée.
  const lieu = Object.fromEntries(
    adresses.flatMap((a) =>
      a.numero === 1
        ? [
            ['adresse_acces', a.adresse_acces],
            ['code_postal', a.code_postal],
            ['ville', a.ville],
          ]
        : [
            [`adresse_acces_${a.numero}`, a.adresse_acces],
            [`code_postal_${a.numero}`, a.code_postal],
            [`ville_${a.numero}`, a.ville],
          ],
    ),
  );
  const trouvee = emplacementCorrespondant(edits, lieu);
  return trouvee
    ? (adresses.find((a) => a.numero === trouvee.numero) ?? null)
    : null;
}

export function LieuChampsEditables({
  edits,
  onChange,
  adresses = [],
}: {
  edits: LieuEdits;
  onChange: (e: LieuEdits) => void;
  /** Adresses de livraison du lieu (`adressesLivraisonDuLieu`). */
  adresses?: AdresseLivraison[];
}) {
  const set = (k: keyof LieuEdits, v: string) => onChange({ ...edits, [k]: v });
  // Sélecteur visible seulement si le lieu a au moins 2 adresses ; l'adresse
  // n° 1 est présélectionnée (elle est déjà dans les champs). Une saisie libre
  // qui ne correspond à aucune adresse ne coche rien.
  const choisie = adresseChoisie(edits, adresses);
  const choisir = (numero: string) => {
    const a = adresses.find((x) => String(x.numero) === numero);
    if (a)
      onChange({
        ...edits,
        adresse_acces: a.adresse_acces,
        code_postal: a.code_postal,
        ville: a.ville,
      });
  };

  return (
    <div className="rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50 p-4 space-y-4">
      <Text tone="soft">
        Champs du lieu (modifiables pour cette collecte uniquement — le
        référentiel n'est pas mis à jour).
      </Text>

      {adresses.length >= 2 && (
        <RadioGroup
          legend="Adresse de livraison"
          value={choisie ? String(choisie.numero) : ''}
          onValueChange={choisir}
          className="space-y-2"
          data-testid="choix-adresse-livraison"
        >
          {adresses.map((a) => (
            <Label
              key={a.numero}
              variant="choice"
              htmlFor={`adresse-livraison-${a.numero}`}
              className="flex min-h-11 items-start gap-3"
            >
              <RadioGroupItem
                id={`adresse-livraison-${a.numero}`}
                value={String(a.numero)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">
                  {nomAdresseLivraison(a)}
                </span>
                <span className="block font-normal text-savr-neutral-600">
                  {ligneAdresseLivraison(a)}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      )}

      <FormField label="Adresse d'accès livraison" htmlFor="edit-adresse">
        <Input
          id="edit-adresse"
          value={edits.adresse_acces}
          onChange={(e) => set('adresse_acces', e.target.value)}
        />
      </FormField>

      <FormGrid>
        <FormField label="Code postal" htmlFor="edit-cp">
          <Input
            id="edit-cp"
            value={edits.code_postal}
            onChange={(e) => set('code_postal', e.target.value)}
          />
        </FormField>
        <FormField label="Ville" htmlFor="edit-ville">
          <Input
            id="edit-ville"
            value={edits.ville}
            onChange={(e) => set('ville', e.target.value)}
          />
        </FormField>
      </FormGrid>

      <FormField label="Détails d'accès" htmlFor="edit-acces-details">
        <Input
          id="edit-acces-details"
          value={edits.acces_details}
          onChange={(e) => set('acces_details', e.target.value)}
          placeholder="Ex : quai N°2, sonner interphone B"
        />
      </FormField>
    </div>
  );
}
