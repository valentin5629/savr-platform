import type { NextRequest } from 'next/server';
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { envoyerRecapProgrammation } from '@/lib/programmation/recap-email.js';
import { notifierOverrideLieu } from '@/lib/programmation/lieu-override.js';
import { notifierTraiteurOperationnel } from '@/lib/notifications/traiteur-operationnel.js';
import { evaluerAutoAcceptAg } from '@/lib/attribution-ag/auto-accept.js';
import { urlApplication } from '@/lib/url-application';
import { ESPACES, ESPACE_PAR_ROLE } from '@/lib/routes';
import type { Role } from '@/lib/roles';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/** Lien « Voir mes collectes » : liste Collectes de l'espace du programmeur. */
export function lienCollectesProgrammeur(
  req: NextRequest,
  role: string | undefined,
): string | null {
  const espace = role ? ESPACE_PAR_ROLE[role as Role] : undefined;
  if (!espace) return null;
  try {
    return urlApplication(req, `${ESPACES[espace].prefixe}/collectes`);
  } catch {
    return null; // lien facultatif : l'email part sans
  }
}

/**
 * Suites d'une programmation confirmée (création ou reprise d'un brouillon),
 * communes aux deux routes ; ordre et effets repris de la route de création.
 * L'envoi immédiat des ordres (décision Val 2026-10-12) reste appelé par la
 * route elle-même, avant ces suites : le cliquet de complétude le lit dans la
 * route (tests/api/admin/envoi-immediat-routes.test.ts).
 *   1. lieu modifié : badge « Info incomplète » + signalement Admin (PROG-01) ;
 *   2. acceptation automatique de chaque collecte AG (PROG-05), best-effort ;
 *   3. email récapitulatif au programmeur (PROG-04), une ligne par collecte ;
 *   4. information du traiteur opérationnel programmé par un tiers (BL-P2-22),
 *      une notification par programmation.
 * L'acteur des notifications est l'organisation AU NOM DE laquelle on
 * programme, jamais celle du JWT (staff en support).
 */
export async function apresConfirmation(
  supabase: AdminSupabase,
  req: NextRequest,
  p: {
    ctx: { userId: string; role: string | undefined };
    evenementId: string;
    nomEvenement: string | null;
    organisationId: string;
    lieuId: string;
    collectes: { id: string; type: string }[];
    lieuOverrides: Record<string, unknown> | null;
  },
): Promise<void> {
  const ids = p.collectes.map((c) => c.id);

  if (p.lieuOverrides && Object.keys(p.lieuOverrides).length > 0) {
    await supabase
      .from('collectes')
      .update({ informations_completes: false })
      .in('id', ids);
    await notifierOverrideLieu(supabase, {
      evenementId: p.evenementId,
      lieuId: p.lieuId,
      overrides: p.lieuOverrides,
      userId: p.ctx.userId,
      role: p.ctx.role ?? null,
    });
  }

  await Promise.all(
    p.collectes
      .filter((c) => c.type === 'ag' || c.type === 'anti_gaspi')
      .map((c) =>
        evaluerAutoAcceptAg(c.id).then(
          () => undefined,
          () => undefined,
        ),
      ),
  );

  await envoyerRecapProgrammation(supabase, {
    programmeurUserId: p.ctx.userId,
    evenementId: p.evenementId,
    nomEvenement: p.nomEvenement,
    organisationId: p.organisationId,
    lieuId: p.lieuId,
    collecteIds: ids,
    lienCollectes: lienCollectesProgrammeur(req, p.ctx.role),
  }).catch(() => undefined); // non-bloquant

  if (ids[0]) {
    void notifierTraiteurOperationnel(supabase, {
      collecteId: ids[0],
      acteurOrgId: p.organisationId,
      changement: { kind: 'programmation', programmeurUserId: p.ctx.userId },
    }).catch(() => undefined);
  }
}
