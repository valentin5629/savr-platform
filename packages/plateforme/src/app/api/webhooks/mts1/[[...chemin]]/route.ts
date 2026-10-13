// Notifications entrantes MTS-1 — ÉTAPE 1 : enregistrement seul.
// Décisions Val : 2026-10-12 (voie A : validation du prestataire en direct par
// les notifications MTS-1) ; 2026-10-13 (mesurer avant de traiter).
//
// MTS-1 peut pousser cinq notifications (relevé as-built §8 : tour/update,
// tour/progress, customerOrder/update, customerOrder/progress, stop/progress).
// Leur contenu réel n'est pas connu. Cette route les ENREGISTRE (jusqu'à
// 256 Ko) dans `integrations_inbox`, sans aucun effet sur les collectes ni les
// tournées, pour
// le mesurer sur le compte de démonstration avant d'écrire le traitement. Le
// traitement relira l'état chez MTS-1 : une notification restera un signal,
// jamais une vérité.
//
// Sécurité : jeton partagé `MTS1_WEBHOOK_TOKEN`, comparé en temps constant, lu
// dans l'en-tête `X-Mts1-Webhook-Token` (§08 §3bis) ou `Authorization`
// (réglage par défaut de la console MTS-1, préfixe `Bearer` facultatif). Jamais
// dans l'URL. Sans jeton configuré, la route refuse tout, dans tous les
// environnements : elle est inerte tant que la variable n'est pas posée.
// Un refus est journalisé (`webhook.signature_invalid`, sans le jeton) : c'est
// ce qui distingue « MTS-1 n'a rien envoyé » de « MTS-1 est mal réglé ».

import { createHash, timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { serverError } from '@/lib/api-helpers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Valeur de `integrations_inbox.source` : distincte de celle de la relève. */
const SOURCE = 'mts1_notification';
/** Au-delà, la notification est refusée sans être lue plus avant. */
const TAILLE_MAX_OCTETS = 256 * 1024;
/** Segments de chemin acceptés pour nommer le type de notification. */
const SEGMENT = /^[A-Za-z]{1,32}$/;

function jetonRecu(req: NextRequest): string | null {
  const dedie = req.headers.get('x-mts1-webhook-token');
  if (dedie) return dedie;
  const autorisation = req.headers.get('authorization');
  if (!autorisation) return null;
  return autorisation.replace(/^Bearer\s+/i, '');
}

// Comparaison en temps constant ; la longueur du secret n'est pas sensible.
function jetonValide(recu: string | null, attendu: string): boolean {
  if (!recu) return false;
  const a = Buffer.from(recu, 'utf8');
  const b = Buffer.from(attendu, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Type de notification, lu dans le chemin appelé — SUPPOSÉ de la forme
 * `…/v3/webhook/tour/update`, `…/v3/webhook/stop/progress` (relevé as-built
 * §8, pas encore constaté). Tout autre chemin donne « inconnu ».
 */
function typeDepuisChemin(chemin: string[]): string {
  const utiles = chemin.filter((s) => s !== 'v3' && s !== 'webhook');
  if (utiles.length === 0 || utiles.length > 3) return 'inconnu';
  return utiles.every((s) => SEGMENT.test(s)) ? utiles.join('/') : 'inconnu';
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chemin?: string[] }> },
): Promise<NextResponse> {
  // Un espace ou un saut de ligne collé avec la valeur dans l'hébergeur ne doit
  // pas faire refuser MTS-1 sans explication.
  const attendu = process.env['MTS1_WEBHOOK_TOKEN']?.trim();
  if (!attendu) {
    logger.warn('webhook.signature_invalid', {
      source: SOURCE,
      raison: 'jeton_non_configure',
    });
    return NextResponse.json(
      { error: 'Notifications non configurées' },
      { status: 503 },
    );
  }
  if (!jetonValide(jetonRecu(req), attendu)) {
    logger.warn('webhook.signature_invalid', {
      source: SOURCE,
      raison: 'jeton_invalide',
    });
    return NextResponse.json({ error: 'Jeton invalide' }, { status: 401 });
  }

  const texte = await req.text();
  const octets = Buffer.byteLength(texte, 'utf8');
  if (octets > TAILLE_MAX_OCTETS) {
    return NextResponse.json(
      { error: 'Notification trop volumineuse' },
      { status: 413 },
    );
  }

  const chemin = (await params).chemin ?? [];
  const type = typeDepuisChemin(chemin);

  let corps: unknown;
  try {
    corps = JSON.parse(texte);
  } catch {
    corps = { brut: texte.slice(0, 2_000) };
  }

  // Même chemin + même contenu = même notification (un rejeu de MTS-1).
  const empreinte = createHash('sha256')
    .update(`${chemin.join('/')}\n${texte}`)
    .digest('hex');

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from('integrations_inbox').insert({
    source: SOURCE,
    event_type: type,
    event_id_externe: empreinte,
    payload: { chemin: chemin.join('/'), corps },
    // Enregistrée, sans traitement à cette étape.
    traite: true,
    traite_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, doublon: true });
    }
    // 500 : MTS-1 garde la notification en échec et peut la relancer.
    return serverError(error, 'webhooks.mts1.enregistrement');
  }

  // Ni le contenu ni un identifiant métier ne vont au journal.
  logger.info('mts1.notification.enregistree', { type, octets });
  return NextResponse.json({ ok: true });
}
