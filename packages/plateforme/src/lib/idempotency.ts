// Idempotence serveur des endpoints Admin Paramètres (§08 §9 / §9ter).
// -----------------------------------------------------------------------------
// Le CDC §08 §9 (taux de recyclage) et §9ter (facteurs CO₂) exigent un
// `Idempotency-Key` OBLIGATOIRE sur PUT avec dédup serveur : « si déjà reçu dans
// les 24h → renvoie le résultat précédent » (l.734), store = `integrations_logs`
// (l.800 « fenêtre dédup 24h via `integrations_logs` »). Ce module implémente ce
// contrat sans nouvelle table : `integrations_logs` porte déjà `correlation_id`
// (= la clé d'idempotence, cf. client Pennylane) et `payload_out` (= la réponse
// à rejouer). Réservé aux routes service-role (RLS bypass) — comme le logging
// Pennylane. Écriture best-effort : ne bloque jamais la réponse métier.
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000; // fenêtre 24h (CDC §9 l.800)

/**
 * Exige un `Idempotency-Key` non vide (obligatoire sur PUT, CDC §9/§9ter.6).
 * Absent → 422 (erreur typée, pas de mutation).
 */
export function idempotencyKeyOrError(
  req: Request,
): { key: string } | { error: NextResponse } {
  const raw = req.headers.get('idempotency-key');
  const key = raw?.trim();
  if (!key) {
    return {
      error: NextResponse.json(
        { error: 'Idempotency-Key manquante (obligatoire sur PUT)' },
        { status: 422 },
      ),
    };
  }
  return { key };
}

/**
 * Rejoue la réponse précédente si la même clé (même `scope`) a déjà abouti dans
 * les 24h — sans ré-exécuter la mutation (donc aucune 2ᵉ ligne d'historique).
 * Renvoie `null` si aucun rejeu applicable → la route poursuit normalement.
 */
export async function findIdempotentReplay(
  supabase: SupabaseClient,
  scope: string,
  key: string,
): Promise<NextResponse | null> {
  const since = new Date(Date.now() - REPLAY_WINDOW_MS).toISOString();
  const { data } = await supabase
    .from('integrations_logs')
    .select('statut_http, payload_out')
    .eq('integration', scope)
    .eq('correlation_id', key)
    .gte('created_at', since)
    .not('payload_out', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data && data.payload_out != null) {
    return NextResponse.json(data.payload_out, {
      status: data.statut_http ?? 200,
    });
  }
  return null;
}

/**
 * Persiste la réponse d'une mutation RÉUSSIE pour rejeu 24h (§6 Idempotence).
 * `direction='entrant'` (requête admin entrante), `correlation_id=key`,
 * `payload_out=réponse`. Best-effort : un échec de trace ne casse pas la route.
 */
export async function recordIdempotentResult(
  supabase: SupabaseClient,
  args: {
    scope: string;
    key: string;
    endpoint: string;
    methode: string;
    statutHttp: number;
    payloadOut: unknown;
  },
): Promise<void> {
  try {
    await supabase.from('integrations_logs').insert({
      integration: args.scope,
      direction: 'entrant',
      methode: args.methode,
      endpoint: args.endpoint,
      statut_http: args.statutHttp,
      payload_out: args.payloadOut as never,
      correlation_id: args.key,
    });
  } catch {
    /* best-effort : l'idempotence-trace ne bloque jamais la réponse */
  }
}
