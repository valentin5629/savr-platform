import { NextResponse } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';

let _lastStatus: 'ok' | 'ko' | null = null;

export async function GET(): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { status: 'ko', reason: 'config' },
      { status: 503 },
    );
  }

  try {
    const start = Date.now();
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/health_ping`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(200),
    });

    if (!res.ok || Date.now() - start > 200) {
      if (_lastStatus !== 'ko') {
        _lastStatus = 'ko';
        logger.error('health.db_ko', { http_status: res.status });
      }
      return NextResponse.json({ status: 'ko' }, { status: 503 });
    }

    if (_lastStatus === 'ko') {
      logger.info('health.db_recovered');
    }
    _lastStatus = 'ok';
    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    if (_lastStatus !== 'ko') {
      _lastStatus = 'ko';
      logger.error('health.db_ko', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
    return NextResponse.json({ status: 'ko' }, { status: 503 });
  }
}
