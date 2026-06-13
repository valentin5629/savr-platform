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
    .select('code, sujet, corps_html, actif')
    .eq('code', slug)
    .single();

  if (error || !tpl) {
    throw new Error(`Template email introuvable : ${slug}`);
  }

  if (!tpl.actif) return;

  const sujet = interpolate(tpl.sujet as string, variables);
  const html = interpolate(tpl.corps_html as string, variables);

  // Sink si RESEND_API_KEY vaut 'test' (dev/CI sans envoi réel)
  const apiKey = process.env.RESEND_API_KEY ?? '';
  let resendId: string | null = null;
  let statut: 'sent' | 'failed' = 'sent';
  let erreur: string | null = null;

  if (apiKey !== 'test') {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM ?? 'noreply@gosavr.io',
      to,
      subject: sujet,
      html,
    });

    if (result.error) {
      statut = 'failed';
      erreur = result.error.message;
    } else {
      resendId = result.data?.id ?? null;
    }
  }

  await supabase.from('emails_envoyes').insert({
    template_code: slug,
    destinataire: to,
    sujet,
    statut,
    resend_id: resendId,
    entity_type: options.entityType ?? null,
    entity_id: options.entityId ?? null,
    erreur,
    envoye_at: statut === 'sent' ? new Date().toISOString() : null,
  });
}
