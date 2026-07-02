import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { calculerAlgoAttributionAg } from '@/lib/attribution-ag/algo.js';

const STATUTS_TERMINAUX = [
  'realisee',
  'cloturee',
  'annulee',
  'realisee_sans_collecte',
];

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

  // Détermination de l'override (§06.06 §3 Bloc 0) :
  //  - AG : override = prestataire choisi ≠ TOP 1 de l'algo (CDC : « Motif override
  //    obligatoire si choix ≠ top 1 algo » ; motif NULL sinon). Le top-1 est calculé
  //    côté serveur (source de vérité, jamais fourni par le client). Algo indisponible
  //    ou aucune reco → pas de baseline → pas de motif requis.
  //  - autres (ZD legacy) : override = prestataire choisi ≠ prestataire actuel.
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
      isOverride = prestataire_logistique_id !== c.prestataire_logistique_id;
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
            "motif_override_prestataire obligatoire (≥ 5 caractères) lorsqu'on choisit un prestataire ≠ recommandation algo (top 1)",
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
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
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
