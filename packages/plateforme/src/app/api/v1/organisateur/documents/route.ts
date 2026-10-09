import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

const ORGANISATEUR_ROLES: ClientRole[] = ['client_organisateur'];

interface DocItem {
  // Table du document : c'est elle qui aiguille le téléchargement.
  type: 'rapport' | 'bordereau' | 'attestation';
  // Nom affiché. Une collecte AG n'a qu'un document, toujours nommé « Rapport de
  // don » (décision Val 2026-10-09) : l'attestation de don s'il y a eu des
  // excédents, le rapport « Événement sans excédent alimentaire » sinon.
  nom: 'Rapport RSE' | 'Bordereau ZD' | 'Rapport de don';
  id: string;
  collecte_id: string;
  evenement_nom: string | null;
  date: string | null;
  disponible: boolean;
  sous_embargo: boolean;
  disponible_a: string | null;
}

type EvtJoin = {
  nom_evenement?: string | null;
  date_evenement?: string | null;
};
function evtOf(row: Record<string, unknown>): EvtJoin {
  const e = row.evenements as EvtJoin | EvtJoin[] | undefined;
  if (Array.isArray(e)) return e[0] ?? {};
  if (e) return e;
  const c = row.collectes as { evenements?: EvtJoin | EvtJoin[] } | undefined;
  const ce = c?.evenements;
  if (Array.isArray(ce)) return ce[0] ?? {};
  return ce ?? {};
}

// GET /api/v1/organisateur/documents — liste des documents PDF des événements du
// client organisateur (§11 §7 : rapports RSE / bordereaux ZD / rapports de don AG).
// Lecture seule, RLS-scopée (rr_select, bord_client_orga_select, att_client_orga_select).
// L'embargo H+24 n'est annoncé que sur les rapports RSE (disponible_a) ; le download
// réel re-vérifie l'embargo côté serveur.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ORGANISATEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const now = Date.now();

  const [rapports, bordereaux, attestations] = await Promise.all([
    supabase
      .from('rapports_rse')
      .select(
        `id, collecte_id, disponible_a, genere_at,
         collectes!inner(type, statut),
         evenements!inner(nom_evenement, date_evenement)`,
      )
      .order('disponible_a', { ascending: false }),
    supabase
      .from('bordereaux_savr')
      .select(
        `id, collecte_id, genere_at, pdf_fichier_id,
         collectes!inner(date_collecte, evenements!inner(nom_evenement, date_evenement))`,
      )
      .order('genere_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('attestations_don')
      .select(
        `id, collecte_id, genere_at, pdf_url,
         collectes!inner(date_collecte, evenements!inner(nom_evenement, date_evenement))`,
      )
      .order('genere_at', { ascending: false, nullsFirst: false }),
  ]);

  const firstError = rapports.error ?? bordereaux.error ?? attestations.error;
  if (firstError) return serverError(firstError, 'organisateur.documents.list');

  const items: DocItem[] = [];

  for (const r of (rapports.data ?? []) as Record<string, unknown>[]) {
    const collecte = r.collectes as { type: string; statut: string };
    const estAg = collecte.type === 'anti_gaspi';
    // Collecte AG avec excédents : son document est l'attestation, listée plus
    // bas. Une ligne de rapport peut exister en base pour elle (créée par
    // d'anciens batchs, jamais rendue en PDF) : elle n'est pas un document.
    if (estAg && collecte.statut !== 'realisee_sans_collecte') continue;
    const dispoA = r.disponible_a as string | null;
    const embargo = dispoA != null && now < new Date(dispoA).getTime();
    items.push({
      type: 'rapport',
      nom: estAg ? 'Rapport de don' : 'Rapport RSE',
      id: r.id as string,
      collecte_id: r.collecte_id as string,
      evenement_nom: evtOf(r).nom_evenement ?? null,
      date: evtOf(r).date_evenement ?? null,
      disponible: r.genere_at != null && !embargo,
      sous_embargo: embargo,
      disponible_a: dispoA,
    });
  }
  for (const b of (bordereaux.data ?? []) as Record<string, unknown>[]) {
    items.push({
      type: 'bordereau',
      nom: 'Bordereau ZD',
      id: b.id as string,
      collecte_id: b.collecte_id as string,
      evenement_nom: evtOf(b).nom_evenement ?? null,
      date: evtOf(b).date_evenement ?? null,
      disponible: b.genere_at != null && b.pdf_fichier_id != null,
      sous_embargo: false,
      disponible_a: null,
    });
  }
  for (const a of (attestations.data ?? []) as Record<string, unknown>[]) {
    items.push({
      type: 'attestation',
      nom: 'Rapport de don',
      id: a.id as string,
      collecte_id: a.collecte_id as string,
      evenement_nom: evtOf(a).nom_evenement ?? null,
      date: evtOf(a).date_evenement ?? null,
      disponible: a.genere_at != null && a.pdf_url != null,
      sous_embargo: false,
      disponible_a: null,
    });
  }

  return NextResponse.json({ data: items });
}
