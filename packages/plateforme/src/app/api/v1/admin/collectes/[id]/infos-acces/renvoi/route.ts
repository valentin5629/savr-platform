import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';
import { estUuid } from '@/lib/filtre-csv.js';
import { evaluerInfosAccesEtEnvoyer } from '@/lib/infos-acces/notify.js';
import {
  deriverSuiviEmail,
  lireDernierEmailInfosAcces,
} from '@/lib/infos-acces/suivi-email.js';

// Collecte finie : les coordonnées du chauffeur n'ont plus d'usage (même liste
// que la saisie, `../route.ts`).
const STATUTS_TERMINAUX = new Set([
  'realisee',
  'cloturee',
  'annulee',
  'realisee_sans_collecte',
]);

/**
 * POST /api/v1/admin/collectes/:id/infos-acces/renvoi
 *
 * Renvoi, à la demande de l'équipe Savr, de l'email « infos d'accès chauffeur »
 * au programmateur (décision Val 2026-10-08, C2) — quand le précédent n'est pas
 * arrivé, ou quand les coordonnées ont changé depuis l'envoi.
 *
 * L'email repart des coordonnées ACTUELLES, par le même chemin que l'envoi
 * automatique (`fn_infos_acces_marquer_si_complet` → claim atomique). Refusé
 * tant qu'une reprise automatique est en cours : le worker de retry porte déjà
 * cet envoi, un renvoi ferait partir deux emails.
 *
 * Réponse 200 `{ email }` : 'envoye' | 'en_reprise' | 'non_envoye' | 'sans_objet'
 * (même vocabulaire que la saisie).
 */
async function postHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const introuvable = (): NextResponse =>
    NextResponse.json({ error: 'Collecte introuvable' }, { status: 404 });
  // Identifiant mal formé : introuvable, sans interroger la base (un uuid
  // invalide y lèverait une erreur de type, rendue en 500).
  if (!estUuid(id)) return introuvable();
  const supabase = createAdminSupabaseClient();

  const { data: collecte, error: collErr } = await supabase
    .from('collectes')
    .select('id, statut, controle_acces_requis, infos_acces_email_envoye_at')
    .eq('id', id)
    .maybeSingle();
  if (collErr) return serverError(collErr, 'admin.infos_acces.renvoi.collecte');
  if (!collecte) return introuvable();
  const coll = collecte as {
    statut: string;
    controle_acces_requis: boolean;
    infos_acces_email_envoye_at: string | null;
  };
  if (!coll.controle_acces_requis) {
    return NextResponse.json(
      { error: 'Cette collecte n’exige pas de contrôle d’accès.' },
      { status: 422 },
    );
  }
  if (STATUTS_TERMINAUX.has(coll.statut)) {
    return NextResponse.json(
      { error: 'Collecte terminée : l’email ne peut plus être renvoyé.' },
      { status: 422 },
    );
  }

  const tampon = coll.infos_acces_email_envoye_at;
  const dernier = await lireDernierEmailInfosAcces(supabase, id);
  if (dernier.error) {
    return serverError(dernier.error, 'admin.infos_acces.renvoi.dernier_email');
  }
  if (deriverSuiviEmail(dernier.data, tampon).etat === 'en_reprise') {
    return NextResponse.json(
      {
        error:
          'Une nouvelle tentative d’envoi est déjà en cours pour cet email.',
      },
      { status: 409 },
    );
  }

  // Le claim précédent est retiré seulement s'il n'a pas bougé depuis la
  // lecture : deux renvois lancés en même temps ne font partir qu'un email.
  if (tampon) {
    const { data: liberes, error: libErr } = await supabase
      .from('collectes')
      .update({ infos_acces_email_envoye_at: null })
      .eq('id', id)
      .eq('infos_acces_email_envoye_at', tampon)
      .select('id');
    if (libErr) return serverError(libErr, 'admin.infos_acces.renvoi.claim');
    if ((liberes ?? []).length === 0) {
      return NextResponse.json(
        {
          error:
            'Un envoi vient d’être lancé pour cette collecte : rechargez la fiche.',
        },
        { status: 409 },
      );
    }
  }

  const { issue } = await evaluerInfosAccesEtEnvoyer(supabase, id);
  logger.info('admin.infos_acces.renvoi', {
    collecte_id: id,
    user_id: auth.ctx.userId,
    issue,
  });

  return NextResponse.json({ email: issue });
}

export const POST = withApiTrace(postHandler);
