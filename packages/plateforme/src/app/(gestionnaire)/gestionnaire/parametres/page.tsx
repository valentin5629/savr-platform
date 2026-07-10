import { PreferencesLangueCard } from '@/components/compte/preferences-langue';

// Paramètres gestionnaire (§06.05 §9) — préférences personnelles utilisateur.
// V1 = langue seule (le bloc notifications email a été supprimé V1, §06.05 l.472-474 ;
// organisation + utilisateurs sont déplacés dans « Mon organisation »). BL-P3-08 :
// la langue FR figée vit dans « Paramètres » côté gestionnaire (à la différence du
// traiteur où Préférences est une sous-section de « Mon organisation », §06.04 §6).
export default function ParametresPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-savr-primary-800">Paramètres</h1>
      <PreferencesLangueCard />
    </div>
  );
}
