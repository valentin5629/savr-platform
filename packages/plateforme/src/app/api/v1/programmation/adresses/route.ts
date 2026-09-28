import { NextRequest, NextResponse } from 'next/server';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { suggererAdresses } from '@/lib/adresse-suggestions.js';

// Relais serveur des suggestions d'adresse (quick-add lieu §06.01). Passer par le
// serveur plutôt qu'un appel navigateur direct : l'IGN ne voit que Savr, jamais l'IP
// de l'utilisateur (arbitrage Val 2026-09-28) — même topologie que lib/geocoding.ts.
// Même périmètre que le formulaire de programmation (programmateurs + admin support).
const LONGUEUR_MAX = 200;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, LONGUEUR_MAX);

  // Fail-open : suggererAdresses renvoie [] sur saisie trop courte ou panne BAN.
  return NextResponse.json(await suggererAdresses(q, req.signal));
}
