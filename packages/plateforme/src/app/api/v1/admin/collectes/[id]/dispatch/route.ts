import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { calculerAlgoAttributionAg } from '@/lib/attribution-ag/algo.js';
import { serverError } from '@/lib/api-helpers.js';

const STATUTS_TERMINAUX = [
  'realisee',
  'cloturee',
  'annulee',
  'realisee_sans_collecte',
];

// ZD — l'Admin choisit (ou change) le prestataire sur la fiche (décision Val
// 2026-10-07). Refus rendus ici, `null` si le choix est recevable.
async function refusChoixPrestataireZd(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  c: { statut: string; statut_tms: string; tms_reference: string | null },
  prestataireId: string,
): Promise<NextResponse | null> {
  // On n'attribue qu'une collecte à dispatcher (`programmee`) ou rejetée par
  // son prestataire (réattribution) : pas une collecte en cours d'annulation.
  if (!['programmee', 'rejetee_par_prestataire'].includes(c.statut)) {
    return NextResponse.json(
      {
        error: `Impossible de choisir un prestataire pour une collecte au statut '${c.statut}'`,
      },
      { status: 409 },
    );
  }
  // Commande vivante chez le prestataire actuel : le dispatch n'émettrait
  // qu'une modification de cette commande, sans la transférer — la fiche
  // afficherait le nouveau prestataire et c'est l'ancien qui viendrait.
  if (c.tms_reference && c.statut_tms !== 'rejetee_par_prestataire') {
    return NextResponse.json(
      {
        error:
          'Cette collecte est déjà commandée chez son prestataire : le changement de prestataire n’est pas possible tant que la commande est en cours.',
      },
      { status: 409 },
    );
  }
  const { data: transporteur, error } = await supabase
    .from('transporteurs')
    .select('type_tms, actif')
    .eq('prestataire_logistique_id', prestataireId)
    .maybeSingle();
  if (error) {
    return serverError(error, 'admin.collectes.dispatch.transporteur');
  }
  const t = transporteur as { type_tms: string; actif: boolean } | null;
  if (!t?.actif) {
    return NextResponse.json(
      { error: 'Prestataire inconnu ou inactif dans le référentiel' },
      { status: 422 },
    );
  }
  // A Toutes! (vélo cargo) : son envoi exige l'association destinataire d'une
  // collecte Anti-Gaspi. Sur une ZD l'ordre finirait en échec définitif et
  // bloquerait tous les envois suivants de la collecte.
  if (t.type_tms === 'a_toutes') {
    return NextResponse.json(
      {
        error: 'A Toutes! ne prend pas en charge les collectes Zéro Déchet',
      },
      { status: 422 },
    );
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { prestataire_logistique_id, motif_override_prestataire } = body;

  const supabase = createAdminSupabaseClient();
  const { data: collecte, error: fetchErr } = await supabase
    .from('collectes')
    .select(
      'id, statut, statut_tms, tms_reference, type, date_collecte, dirty_tms, prestataire_logistique_id',
    )
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !collecte) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }

  const c = collecte as {
    id: string;
    statut: string;
    statut_tms: string;
    tms_reference: string | null;
    type: string;
    date_collecte: string;
    dirty_tms: boolean;
    prestataire_logistique_id: string | null;
  };

  // 409 si statut terminal
  if (STATUTS_TERMINAUX.includes(c.statut)) {
    return NextResponse.json(
      {
        error: `Impossible de dispatcher une collecte au statut '${c.statut}'`,
      },
      { status: 409 },
    );
  }

  // AG : l'association destinataire est choisie AVANT le prestataire (décision
  // Val 2026-10-01) — son adresse est le point B transmis au prestataire par
  // l'adapter. Sans attribution, l'ordre partirait sans adresse de livraison :
  // on refuse l'envoi tant que l'association n'est pas attribuée (§06.09 §3).
  if (c.type === 'anti_gaspi') {
    // (association_id NOT NULL : la ligne existe ⇔ l'association est attribuée)
    const { data: attribution, error: attrErr } = await supabase
      .from('attributions_antgaspi')
      .select('id')
      .eq('collecte_id', id)
      .maybeSingle();
    if (attrErr) {
      return serverError(attrErr, 'admin.collectes.dispatch.attribution');
    }
    if (!attribution) {
      return NextResponse.json(
        {
          error:
            "Choisissez d'abord l'association bénéficiaire : son adresse est transmise au prestataire logistique pour la livraison.",
        },
        { status: 422 },
      );
    }
  }

  // ZD : l'Admin choisit le prestataire sur la fiche (décision Val 2026-10-07).
  // Sans prestataire — ni choisi ici, ni déjà posé — l'ordre partirait vers
  // personne : le worker le classerait « rien à envoyer » et la collecte
  // resterait non transmise sans que rien ne le dise.
  if (
    c.type === 'zero_dechet' &&
    !prestataire_logistique_id &&
    !c.prestataire_logistique_id
  ) {
    return NextResponse.json(
      {
        error:
          "Choisissez d'abord le prestataire logistique : sans lui, la collecte ne peut pas être transmise.",
      },
      { status: 422 },
    );
  }

  if (
    c.type === 'zero_dechet' &&
    typeof prestataire_logistique_id === 'string' &&
    prestataire_logistique_id !== c.prestataire_logistique_id
  ) {
    const refus = await refusChoixPrestataireZd(
      supabase,
      c,
      prestataire_logistique_id,
    );
    if (refus) return refus;
  }

  // Détermination de l'override (§06.06 §3 Bloc 0) :
  //  - AG : override = prestataire choisi ≠ TOP 1 de l'algo (CDC : « Motif override
  //    obligatoire si choix ≠ top 1 algo » ; motif NULL sinon). Le top-1 est calculé
  //    côté serveur (source de vérité, jamais fourni par le client). Algo indisponible
  //    ou aucune reco → pas de baseline → pas de motif requis.
  //  - ZD : pas de reco algo. Le premier choix est libre ; override = CHANGER un
  //    prestataire déjà posé.
  let isOverride = false;
  if (prestataire_logistique_id) {
    if (c.type === 'anti_gaspi') {
      let top1PrestaId: string | null = null;
      try {
        const reco = await calculerAlgoAttributionAg(id);
        if (reco.transporteur) {
          const { data: t } = await supabase
            .from('transporteurs')
            .select('prestataire_logistique_id')
            .eq('id', reco.transporteur.id)
            .single();
          top1PrestaId =
            (t as { prestataire_logistique_id?: string } | null)
              ?.prestataire_logistique_id ?? null;
        }
      } catch {
        top1PrestaId = null;
      }
      isOverride =
        top1PrestaId != null && prestataire_logistique_id !== top1PrestaId;
    } else {
      isOverride =
        c.prestataire_logistique_id != null &&
        prestataire_logistique_id !== c.prestataire_logistique_id;
    }
  }

  // Override prestataire : ops interdit, motif obligatoire (≥ 5 car.)
  if (isOverride) {
    if (auth.ctx.role === 'ops_savr') {
      return NextResponse.json(
        { error: "L'override de prestataire est réservé aux admin Savr" },
        { status: 403 },
      );
    }
    if (
      !motif_override_prestataire ||
      String(motif_override_prestataire).length < 5
    ) {
      return NextResponse.json(
        {
          error:
            c.type === 'anti_gaspi'
              ? "motif_override_prestataire obligatoire (≥ 5 caractères) lorsqu'on choisit un prestataire ≠ recommandation algo (top 1)"
              : 'motif_override_prestataire obligatoire (≥ 5 caractères) pour changer le prestataire déjà attribué',
        },
        { status: 422 },
      );
    }
  }

  // fn_dispatcher_collecte : UPDATE collecte + outbox E1/E2 dans la même transaction (G4)
  const { data: eventType, error: rpcErr } = await supabase.rpc(
    'fn_dispatcher_collecte',
    {
      p_id: id,
      p_prestataire_logistique_id: prestataire_logistique_id ?? null,
      p_motif_override: motif_override_prestataire ?? null,
    },
  );

  if (rpcErr) {
    return serverError(rpcErr, 'admin.collectes.dispatch.create');
  }

  await supabase.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: 'DISPATCH',
    user_id: auth.ctx.userId,
    new_values: {
      event_type: eventType,
      dirty_tms: false,
      prestataire_logistique_id,
      motif_override_prestataire,
    },
  });

  return NextResponse.json({ ok: true, event_type: eventType });
}
