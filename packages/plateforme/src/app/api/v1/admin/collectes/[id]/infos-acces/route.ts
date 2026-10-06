import { jourParis } from '@savr/shared/src/temps/index.js';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { readJsonBody, serverError, withApiTrace } from '@/lib/api-helpers.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { evaluerInfosAccesEtEnvoyer } from '@/lib/infos-acces/notify.js';

const CHAMPS = [
  'plaque_immatriculation',
  'chauffeur_nom',
  'chauffeur_telephone',
  'accompagnant_nom',
  'accompagnant_telephone',
] as const;

type ChampInfosAcces = (typeof CHAMPS)[number];

// Statuts où la collecte est finie : plus aucune tournée à créer (règle tracée
// « collecte terminée : seules les tournées existantes », même liste que la fiche).
const STATUTS_TERMINAUX = new Set([
  'realisee',
  'cloturee',
  'annulee',
  'realisee_sans_collecte',
]);

// Créneau d'une tournée créée par l'Admin, dérivé de l'heure de collecte (les
// collectes sont de nuit : défaut `nuit`, comme l'adapter MTS-1).
function creneauDepuisHeure(
  heure: string | null,
): 'matin' | 'apres_midi' | 'soir' | 'nuit' {
  const h = Number.parseInt(heure?.slice(0, 2) ?? '', 10);
  if (Number.isNaN(h)) return 'nuit';
  if (h < 12) return 'matin';
  if (h < 18) return 'apres_midi';
  if (h < 22) return 'soir';
  return 'nuit';
}

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
 *
 * Camion sans tournée (décision Val 2026-10-06, C2) : un item peut porter
 * `rang` (1..nb_camions_demande) au lieu de `tournee_id` → la tournée est créée
 * ici (ADM-{collecte}-{rang}, planifiee, prestataire = celui de la collecte) et
 * liée au rang ; l'adapter la REPREND ensuite au dispatch (findTournee par rang
 * → UPDATE external_ref, jamais une seconde tournée). Sans prestataire posé sur
 * la collecte → 422 (tournees.prestataire_logistique_id NOT NULL).
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
    .select(
      'id, statut, controle_acces_requis, nb_camions_demande, prestataire_logistique_id, date_collecte, heure_collecte',
    )
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
      'tournee_id, rang, tournees(id, chauffeur_nom, chauffeur_telephone, accompagnant_nom, accompagnant_telephone)',
    )
    .eq('collecte_id', id);
  if (liensErr) return serverError(liensErr, 'admin.infos_acces.get_tournees');

  const autorisees = new Set((liens ?? []).map((l) => l.tournee_id as string));
  const rangsPris = new Set(
    (liens ?? []).map((l) => (l as { rang?: number }).rang ?? 0),
  );
  const coll = collecte as {
    statut?: string | null;
    nb_camions_demande?: number | null;
    prestataire_logistique_id?: string | null;
    date_collecte?: string | null;
    heure_collecte?: string | null;
  };
  const nbCamions = Math.max(1, coll.nb_camions_demande ?? 1);

  // ── Passe 1 : validation complète, AUCUNE écriture. Un item invalide (même
  // le dernier) refuse tout le body : rien n'a été créé entre-temps.
  type ItemPlan = {
    tourneeId: string | null;
    rang: number | null;
    updates: Partial<Record<ChampInfosAcces, string | null>>;
  };
  const plan: ItemPlan[] = [];
  const rangsDemandes = new Set<number>();
  for (const item of body.tournees) {
    const tourneeId =
      typeof item.tournee_id === 'string' && item.tournee_id !== ''
        ? item.tournee_id
        : null;
    const rang =
      tourneeId === null && typeof item.rang === 'number' ? item.rang : null;
    const updates: Partial<Record<ChampInfosAcces, string | null>> = {};
    for (const champ of CHAMPS) {
      if (champ in item) {
        const val = normaliser(item[champ]);
        if (val !== undefined) updates[champ] = val;
      }
    }

    if (tourneeId !== null) {
      if (!autorisees.has(tourneeId)) {
        return NextResponse.json(
          { error: 'tournee_id inconnu pour cette collecte' },
          { status: 422 },
        );
      }
    } else if (rang !== null) {
      // Camion demandé sans tournée : création Admin (C2).
      if (!Number.isInteger(rang) || rang < 1 || rang > nbCamions) {
        return NextResponse.json(
          {
            error: `rang invalide : la collecte demande ${nbCamions} camion(s)`,
          },
          { status: 422 },
        );
      }
      if (rangsPris.has(rang)) {
        return NextResponse.json(
          {
            error: `Le camion ${rang} a maintenant une tournée : rechargez la fiche avant de saisir.`,
          },
          { status: 422 },
        );
      }
      if (rangsDemandes.has(rang)) {
        return NextResponse.json(
          { error: `Le camion ${rang} apparaît deux fois.` },
          { status: 422 },
        );
      }
      if (STATUTS_TERMINAUX.has(coll.statut ?? '')) {
        return NextResponse.json(
          {
            error:
              'Collecte terminée : aucune tournée ne peut plus être créée, seules les tournées existantes se corrigent.',
          },
          { status: 422 },
        );
      }
      if (!coll.prestataire_logistique_id) {
        return NextResponse.json(
          {
            error:
              'Aucun prestataire logistique sur la collecte : attribuez un prestataire avant de saisir le chauffeur.',
          },
          { status: 422 },
        );
      }
      // Une tournée n'est créée que pour une saisie réelle : un camion laissé
      // vide ne doit pas occuper son rang (l'adapter y échouerait en 23505 au
      // prochain changement de type de transporteur).
      if (!Object.values(updates).some((v) => v !== null)) {
        return NextResponse.json(
          {
            error: `Aucune coordonnée saisie pour le camion ${rang} : rien à créer.`,
          },
          { status: 422 },
        );
      }
      rangsDemandes.add(rang);
    } else {
      return NextResponse.json(
        { error: 'tournee_id inconnu pour cette collecte' },
        { status: 422 },
      );
    }
    if (Object.keys(updates).length > 0)
      plan.push({ tourneeId, rang, updates });
  }

  if (plan.length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  // ── Passe 2 : écritures, camion par camion. Pour un camion sans tournée :
  // la tournée est retrouvée par sa référence (rejeu sûr), puis liée par un
  // INSERT strict — si l'adapter a lié ce rang entre la lecture et l'écriture
  // (worker outbox juste après « Valider et envoyer »), un upsert aurait DÉTACHÉ
  // la tournée du prestataire : on refuse (409) et l'écran recharge. Les
  // coordonnées sont écrites aussitôt après le lien : un 409 sur un camion
  // suivant ne laisse jamais une tournée créée sans coordonnées.
  const tourneesCreees: Array<{ rang: number; tournee_id: string }> = [];
  const updatesParTournee: Array<{
    tourneeId: string;
    updates: Partial<Record<ChampInfosAcces, string | null>>;
  }> = [];
  for (const item of plan) {
    let tourneeId = item.tourneeId;
    if (tourneeId === null && item.rang !== null) {
      const rang = item.rang;
      const referenceInterne = `ADM-${id}-${rang}`;
      const { data: creee, error: creeErr } = await supabase
        .from('tournees')
        .upsert(
          {
            reference_interne: referenceInterne,
            date_tournee: coll.date_collecte ?? jourParis(),
            creneau: creneauDepuisHeure(coll.heure_collecte ?? null),
            prestataire_logistique_id: coll.prestataire_logistique_id,
            statut: 'planifiee',
          },
          { onConflict: 'reference_interne' },
        )
        .select('id')
        .single();
      if (creeErr || !creee) {
        return serverError(
          creeErr ?? new Error('tournée non créée'),
          'admin.infos_acces.creer_tournee',
        );
      }
      const nouvelId = (creee as { id: string }).id;
      const { error: lienErr } = await supabase
        .from('collecte_tournees')
        .insert({ collecte_id: id, tournee_id: nouvelId, rang });
      if (lienErr) {
        if ((lienErr as { code?: string }).code === '23505') {
          // Rang pris entre-temps : la tournée Admin, jamais liée, est retirée
          // (par sa référence, jamais celle du prestataire) ; best-effort —
          // un échec la laisse orpheline, reprise par l'upsert au rejeu.
          const { error: delErr } = await supabase
            .from('tournees')
            .delete()
            .eq('id', nouvelId)
            .eq('reference_interne', referenceInterne);
          if (delErr) {
            logger.warn('admin.infos_acces.tournee_admin_orpheline', {
              collecte_id: id,
              tournee_id: nouvelId,
              rang,
              error: delErr.message,
            });
          }
          return NextResponse.json(
            {
              error: `Le prestataire vient de créer la tournée du camion ${rang} : rechargez la fiche avant de saisir.`,
            },
            { status: 409 },
          );
        }
        return serverError(lienErr, 'admin.infos_acces.lier_tournee');
      }
      tourneesCreees.push({ rang, tournee_id: nouvelId });
      tourneeId = nouvelId;
    }
    if (tourneeId === null) continue; // impossible après la passe 1
    const { error: updErr } = await supabase
      .from('tournees')
      .update(item.updates)
      .eq('id', tourneeId);
    if (updErr) return serverError(updErr, 'admin.infos_acces.update_tournee');
    updatesParTournee.push({ tourneeId, updates: item.updates });
  }

  // Audit (écriture sensible : coordonnées chauffeur, contrôle d'accès site).
  // Agrégat audité = la collecte (record_id) ; le détail par tournée est dans new_values.
  await supabase.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: 'infos_acces_chauffeur_maj',
    user_id: auth.ctx.userId,
    old_values: { tournees: liens ?? [] },
    new_values: {
      tournees: updatesParTournee,
      tournees_creees: tourneesCreees,
    },
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

  return NextResponse.json({
    tournees: apres ?? [],
    email_envoye: envoye,
    tournees_creees: tourneesCreees,
  });
}

export const PATCH = withApiTrace(patchHandler);
