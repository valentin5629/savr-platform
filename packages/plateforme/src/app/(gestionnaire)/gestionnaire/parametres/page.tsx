import { RgpdComptePanel } from '@/components/compte/rgpd-compte-panel';
import { ParametresGestionnaireClient } from './parametres-client';

// Paramètres gestionnaire = ex « Mon organisation » (§06.05 §Navigation 8) + ex
// « Paramètres » (§06.05 §9, préférences personnelles), réunis en onglets
// (décision Val 2026-10-31). Onglet « Mon profil » : informations personnelles
// (prénom / nom / téléphone / poste) + droits RGPD, §06.04 §7 « section commune à
// tous les users » (décision Val 2026-09-28). « Préférences » et « Sécurité du
// compte » retirés de l'écran (Val 2026-11-01).
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
        </>
      }
    />
  );
}
