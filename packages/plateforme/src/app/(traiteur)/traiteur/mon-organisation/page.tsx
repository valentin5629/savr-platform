import { requirePageSession } from '@/lib/page-auth';
import { MonOrganisationClient } from './mon-organisation-client';

const TRAITEUR_ROLES = ['traiteur_manager', 'traiteur_commercial'] as const;

// CDC §06.04 §6 « Mon organisation » — visible manager + commercial. Le gating
// est DOUBLE : ici, côté serveur, on ne passe `isManager` au client que si le
// rôle de la SESSION l'est (jamais dérivé du client) ; et chaque route d'écriture
// re-vérifie `traiteur_manager` (defense-in-depth). Le commercial est en lecture
// seule et la sous-section Équipe lui est masquée (l.653).
export default async function MonOrganisationPage() {
  const session = await requirePageSession(TRAITEUR_ROLES);
  const isManager = session.role === 'traiteur_manager';

  return <MonOrganisationClient isManager={isManager} />;
}
