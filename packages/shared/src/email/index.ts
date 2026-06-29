import { Resend } from 'resend';
import { createAdminSupabaseClient } from '../supabase-client.js';

export interface SendEmailOptions {
  entityType?: string;
  entityId?: string;
}

export interface CapturedEmail {
  slug: string;
  to: string;
  variables: Record<string, string>;
  options: SendEmailOptions;
}

export type EmailCaptureFn = (email: CapturedEmail) => void;

let _captureFn: EmailCaptureFn | null = null;

export function setEmailCaptureSink(fn: EmailCaptureFn | null): void {
  _captureFn = fn;
}

function interpolate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '');
}

// Variables requises déclarées au template (email_templates.variables = text[]) qui
// manquent du payload. CDC §08 §4 l.547 : une variable requise absente = REFUS d'envoi
// (jamais d'email avec placeholder brut/undefined).
function findMissingVariables(
  required: string[] | null | undefined,
  provided: Record<string, string>,
): string[] {
  return (required ?? []).filter(
    (key) => provided[key] === undefined || provided[key] === null,
  );
}

type SendOutcome = {
  resendId: string | null;
  statut: 'sent' | 'failed';
  erreur: string | null;
};

// Rendu déjà fait : émet vers Resend (ou no-op sink si RESEND_API_KEY='test').
// Réutilisé par sendEmail (envoi initial) ET runEmailRetryWorker (retries).
async function dispatchToResend(
  sujet: string,
  html: string,
  to: string,
): Promise<SendOutcome> {
  const apiKey = process.env['RESEND_API_KEY'] ?? '';
  if (apiKey === 'test') {
    return { resendId: null, statut: 'sent', erreur: null };
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from: process.env['RESEND_FROM'] ?? 'noreply@gosavr.io',
    to,
    subject: sujet,
    html,
  });
  if (result.error) {
    return { resendId: null, statut: 'failed', erreur: result.error.message };
  }
  return { resendId: result.data?.id ?? null, statut: 'sent', erreur: null };
}

async function traceResendLog(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  erreur: string,
): Promise<void> {
  await supabase.from('integrations_logs').insert({
    integration: 'resend',
    direction: 'sortant',
    methode: 'POST',
    endpoint: 'resend.send',
    erreur,
  });
}

export async function sendEmail(
  slug: string,
  to: string,
  variables: Record<string, string>,
  options: SendEmailOptions = {},
): Promise<void> {
  if (_captureFn) {
    _captureFn({ slug, to, variables, options });
    return;
  }

  const supabase = createAdminSupabaseClient();

  const { data: tpl, error } = await supabase
    .from('email_templates')
    .select('code, sujet, corps_html, actif, variables')
    .eq('code', slug)
    .single();

  if (error || !tpl) {
    // Slug inexistant : aucun appel Resend, trace (CDC §08 §4 l.548).
    await traceResendLog(supabase, `TEMPLATE_NOT_FOUND: ${slug}`);
    throw new Error(`Template email introuvable : ${slug}`);
  }

  if (!tpl.actif) {
    // Template inactif : aucun appel Resend, trace (CDC §08 §4 l.548 « skip inactif »).
    await traceResendLog(supabase, `SKIP_INACTIF: ${slug}`);
    return;
  }

  // Variable requise manquante → refus d'envoi + trace (CDC §08 §4 l.547).
  const missing = findMissingVariables(
    tpl.variables as string[] | null,
    variables,
  );
  if (missing.length > 0) {
    await traceResendLog(
      supabase,
      `MISSING_VARIABLE: ${slug} [${missing.join(', ')}]`,
    );
    return;
  }

  const sujet = interpolate(tpl.sujet as string, variables);
  const html = interpolate(tpl.corps_html as string, variables);

  const outcome = await dispatchToResend(sujet, html, to);

  await supabase.from('emails_envoyes').insert({
    template_code: slug,
    destinataire: to,
    sujet,
    statut: outcome.statut,
    resend_id: outcome.resendId,
    entity_type: options.entityType ?? null,
    entity_id: options.entityId ?? null,
    erreur: outcome.erreur,
    envoye_at: outcome.statut === 'sent' ? new Date().toISOString() : null,
    variables_jsonb: variables,
    tentative_numero: 1,
  });
}

// ─── Retry worker (cron) — CDC §08 §4 l.546 ──────────────────────────────────
// Retry policy unifiée 5 min / 1h / 24h (arbitrage Val 2026-06-29 R10b, cf.
// _Divergences/M0.5_20260629.md). tentative_numero 1 = envoi initial, 2-4 = retries.
// La prochaine tentative est dérivée de created_at + offset cumulatif (0 colonne
// d'ordonnancement). Après tentative 4 échouée → statut='failed' (echec terminal) +
// trace integrations_logs (echec_final). Pas de DLQ V1 (dashboard Admin sur statut='failed').

const PALIERS_SECONDS = [5 * 60, 60 * 60, 24 * 60 * 60];

// Délai (s) entre created_at et l'échéance de la tentative SUIVANTE, étant donné le
// tentative_numero courant (1 → 5min ; 2 → 5min+1h ; 3 → 5min+1h+24h).
function cumulativeOffsetSeconds(tentativeNumero: number): number {
  let total = 0;
  for (let i = 0; i < tentativeNumero && i < PALIERS_SECONDS.length; i++) {
    total += PALIERS_SECONDS[i] as number;
  }
  return total;
}

export interface EmailRetryResult {
  scanned: number;
  retried: number;
  succeeded: number;
  exhausted: number;
}

interface FailedEmailRow {
  id: string;
  template_code: string;
  destinataire: string;
  variables_jsonb: Record<string, string> | null;
  tentative_numero: number;
  created_at: string;
}

export async function runEmailRetryWorker(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  nowMs?: number,
): Promise<EmailRetryResult> {
  const now = nowMs ?? Date.now();

  const { data: rows } = await supabase
    .from('emails_envoyes')
    .select(
      'id, template_code, destinataire, variables_jsonb, tentative_numero, created_at',
    )
    .eq('statut', 'failed')
    .lt('tentative_numero', 4);

  const failed = (rows ?? []) as unknown as FailedEmailRow[];
  const result: EmailRetryResult = {
    scanned: failed.length,
    retried: 0,
    succeeded: 0,
    exhausted: 0,
  };

  for (const row of failed) {
    const dueAt =
      new Date(row.created_at).getTime() +
      cumulativeOffsetSeconds(row.tentative_numero) * 1000;
    if (now < dueAt) continue;

    const { data: tpl } = await supabase
      .from('email_templates')
      .select('code, sujet, corps_html, actif')
      .eq('code', row.template_code)
      .single();
    if (!tpl || !tpl.actif) continue;

    const vars = (row.variables_jsonb ?? {}) as Record<string, string>;
    const sujet = interpolate(tpl.sujet as string, vars);
    const html = interpolate(tpl.corps_html as string, vars);

    const outcome = await dispatchToResend(sujet, html, row.destinataire);
    result.retried += 1;
    const nextTentative = row.tentative_numero + 1;

    if (outcome.statut === 'sent') {
      await supabase
        .from('emails_envoyes')
        .update({
          statut: 'sent',
          resend_id: outcome.resendId,
          envoye_at: new Date(now).toISOString(),
          tentative_numero: nextTentative,
          erreur: null,
        })
        .eq('id', row.id);
      result.succeeded += 1;
    } else {
      await supabase
        .from('emails_envoyes')
        .update({
          statut: 'failed',
          tentative_numero: nextTentative,
          erreur: outcome.erreur,
        })
        .eq('id', row.id);
      if (nextTentative >= 4) {
        // Échec final (tentative 4) → trace echec_final (CDC §08 §4 l.546).
        await traceResendLog(
          supabase,
          `echec_final: ${row.template_code} -> ${row.destinataire}`,
        );
        result.exhausted += 1;
      }
    }
  }

  return result;
}
