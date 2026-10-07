import { TextLink } from '@/components/ui/text-link';

// Briques métier des fiches collecte (Admin et client) : contact cliquable,
// téléphone cliquable, date longue de l'en-tête. Le shell générique des fiches
// (cadre, en-tête, onglets à erreurs) vit dans `components/ui/fiche/`, l'en-tête
// de section dans `components/ui/section-header`, les paires libellé / valeur
// dans `components/ui/info-item` (R-UI-5, F4 / F5 / G3).

// Contact nom + téléphone cliquable (appel direct depuis mobile).
export function ContactLigne({
  nom,
  telephone,
}: {
  nom?: string | null;
  telephone?: string | null;
}) {
  if (!nom && !telephone) {
    return <span className="text-savr-neutral-400">Non renseigné</span>;
  }
  return (
    <>
      {nom ?? '—'}
      {telephone && (
        <TextLink
          href={`tel:${telephone.replace(/\s/g, '')}`}
          external
          className="block"
        >
          {telephone}
        </TextLink>
      )}
    </>
  );
}

// Téléphone seul, cliquable (appel direct depuis mobile) ; « — » si absent.
export function TelephoneLien({ telephone }: { telephone?: string | null }) {
  const tel = telephone?.trim();
  if (!tel) return <span className="text-savr-neutral-400">—</span>;
  return (
    <TextLink href={`tel:${tel.replace(/\s/g, '')}`} external>
      {tel}
    </TextLink>
  );
}

// Date de collecte de l'en-tête des fiches : « Samedi 26 septembre 2026 ».
export function dateLongueCapitalisee(dateIso: string): string {
  const d = new Date(dateIso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });
  return d.charAt(0).toUpperCase() + d.slice(1);
}
