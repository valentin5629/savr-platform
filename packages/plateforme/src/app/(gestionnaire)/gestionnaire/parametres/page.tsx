import { PreferencesLangueCard } from '@/components/compte/preferences-langue';
import { RgpdComptePanel } from '@/components/compte/rgpd-compte-panel';
import { SecuriteAccesPanel } from '@/components/compte/securite-acces-panel';
import { ParametresGestionnaireClient } from './parametres-client';

// Paramètres gestionnaire = ex « Mon organisation » (§06.05 §Navigation 8) + ex
// « Paramètres » (§06.05 §9, préférences personnelles), réunis en onglets
// (décision Val 2026-10-31). Onglet « Mon profil » : V1 = langue seule (le bloc
// notifications email a été supprimé V1, §06.05 l.472-474). BL-P3-08 : la langue
// FR figée vit ici. BL-P3-13 : « Sécurité du compte » (historique des accès
// admin) aussi. Informations personnelles (prénom / nom / téléphone) + droits
// RGPD : §06.04 §7 « section commune à tous les users » (décision Val 2026-09-28).
export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string | string[] }>;
}) {
  const { onglet } = await searchParams;
  return (
    <ParametresGestionnaireClient
      initial={onglet}
      monProfil={
        <>
          <RgpdComptePanel />
          <PreferencesLangueCard />
          <SecuriteAccesPanel />
        </>
      }
    />
  );
}
