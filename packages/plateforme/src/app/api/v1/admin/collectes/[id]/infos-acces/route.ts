import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { readJsonBody, serverError, withApiTrace } from '@/lib/api-helpers.js';
import { evaluerInfosAccesEtEnvoyer } from '@/lib/infos-acces/notify.js';

const CHAMPS = [
  'chauffeur_nom',
  'chauffeur_telephone',
  'accompagnant_nom',
  'accompagnant_telephone',
] as const;

type ChampInfosAcces = (typeof CHAMPS)[number];

// '' → null (effacement), string → trim, sinon on ne touche pas au champ.
function normaliser(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Saisie/correction manuelle des infos d'accès chauffeur par tournée (Admin).
 * Secours à la récupération auto MTS-1 (décision Val #3, 2026-07-15). Écrit sur
 * `plateforme.tournees` puis ré-évalue la complétude → envoie l'email récap au
 * programmateur dès que toutes les tournées ont nom + téléphone (même logique
 * atomique/anti-double-envoi que le chemin auto).
 *
 * Body : { tournees: [{ tournee_id, chauffeur_nom?, chauffeur_telephone?,
 *          accompagnant_nom?, accompagnant_telephone? }] }
 */
async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = await readJsonBody(req);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data as {
    tournees?: Array<Record<string, unknown>>;
  };

  if (!Array.isArray(body.tournees) || body.tournees.length === 0) {
    return NextResponse.json(
      { error: 'tournees est obligatoire (tableau non vide)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Collecte existante ?
  const { data: collecte, error: collErr } = await supabase
    .from('collectes')
    .select('id, controle_acces_requis')
    .eq('id', id)
    .single();
  if (collErr?.code === 'PGRST116' || !collecte) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }
  if (collErr) return serverError(collErr, 'admin.infos_acces.get_collecte');

  // Tournées rattachées à CETTE collecte (périmètre de saisie autorisé).
  const { data: liens, error: liensErr } = await supabase
    .from('collecte_tournees')
    .select(
      'tournee_id, tournees(id, chauffeur_nom, chauffeur_telephone, accompagnant_nom, accompagnant_telephone)',
    )
    .eq('collecte_id', id);
  if (liensErr) return serverError(liensErr, 'admin.infos_acces.get_tournees');

  const autorisees = new Set((liens ?? []).map((l) => l.tournee_id as string));

  // Construire les updates par tournée + valider l'appartenance.
  const updatesParTournee: Array<{
    tourneeId: string;
    updates: Partial<Record<ChampInfosAcces, string | null>>;
  }> = [];
  for (const item of body.tournees) {
    const tourneeId =
      typeof item.tournee_id === 'string' ? item.tournee_id : '';
    if (!tourneeId || !autorisees.has(tourneeId)) {
      return NextResponse.json(
        { error: 'tournee_id inconnu pour cette collecte' },
        { status: 422 },
      );
    }
    const updates: Partial<Record<ChampInfosAcces, string | null>> = {};
    for (const champ of CHAMPS) {
      if (champ in item) {
        const val = normaliser(item[champ]);
        if (val !== undefined) updates[champ] = val;
      }
    }
    if (Object.keys(updates).length > 0)
      updatesParTournee.push({ tourneeId, updates });
  }

  if (updatesParTournee.length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  // Écritures (N petit = nb camions). Chaque tournée est déjà bornée à la collecte.
  for (const { tourneeId, updates } of updatesParTournee) {
    const { error: updErr } = await supabase
      .from('tournees')
      .update(updates)
      .eq('id', tourneeId);
    if (updErr) return serverError(updErr, 'admin.infos_acces.update_tournee');
  }

  // Audit (écriture sensible : coordonnées chauffeur, contrôle d'accès site).
  // Agrégat audité = la collecte (record_id) ; le détail par tournée est dans new_values.
  await supabase.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: 'infos_acces_chauffeur_maj',
    user_id: auth.ctx.userId,
    old_values: { tournees: liens ?? [] },
    new_values: { tournees: updatesParTournee },
  });

  // Ré-évaluation complétude → email récap si complet (best-effort, non bloquant).
  const { envoye } = await evaluerInfosAccesEtEnvoyer(supabase, id);

  // Relecture de l'état à jour des tournées de la collecte.
  const { data: apres } = await supabase
    .from('collecte_tournees')
    .select(
      'rang, tournees(id, chauffeur_nom, chauffeur_telephone, accompagnant_nom, accompagnant_telephone, plaque_immatriculation)',
    )
    .eq('collecte_id', id)
    .order('rang');

  return NextResponse.json({ tournees: apres ?? [], email_envoye: envoye });
}

export const PATCH = withApiTrace(patchHandler);
