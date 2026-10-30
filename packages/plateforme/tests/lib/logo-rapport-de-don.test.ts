/**
 * Attestation mise en file sans logo (trigger SQL de correction de volume,
 * 20260616100100) : le worker PDF complète le logo du client au rendu
 * (revue principale 2026-10-30).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

const logoKeyToDataUri = vi.hoisted(() =>
  vi.fn(async (cle: string | null | undefined) =>
    cle ? `data:image/png;base64,${cle}` : null,
  ),
);
vi.mock('../../src/lib/pdf/logo-inline.js', () => ({ logoKeyToDataUri }));

import { completerLogoAttestation } from '../../src/lib/pdf/logo-rapport-de-don.js';

function sb(reponses: Array<Record<string, unknown>>) {
  let i = 0;
  const c: Record<string, unknown> = {
    maybeSingle: () => Promise.resolve({ error: null, ...reponses[i++] }),
  };
  for (const m of ['select', 'eq']) c[m] = () => c;
  return { from: vi.fn(() => c) };
}

const logos = (depose: string | null) => ({
  data: {
    evenements: {
      logo_client_organisateur_url: depose,
      organisations: { type: 'traiteur', logo_url: 'cle-traiteur' },
      traiteur_operationnel: null,
      client_organisateur: null,
    },
  },
});

describe('completerLogoAttestation', () => {
  it('contenu sans champ logo → logo du client de l’événement ajouté', async () => {
    const s = sb([{ data: { collecte_id: 'c1' } }, logos('cle-deposee')]);
    const p = await completerLogoAttestation(s as never, 'att-2', {
      numero: 'ATT-DON-2026-00002',
    });
    expect(p).toEqual({
      numero: 'ATT-DON-2026-00002',
      logo_client_url: 'data:image/png;base64,cle-deposee',
    });
  });

  it('jamais le logo du traiteur à la place du client', async () => {
    const s = sb([{ data: { collecte_id: 'c1' } }, logos(null)]);
    const p = await completerLogoAttestation(s as never, 'att-2', {});
    expect(p.logo_client_url).toBeNull();
  });

  it('contenu qui porte déjà le champ (même null) → inchangé, aucune lecture', async () => {
    const s = sb([]);
    const payload = { logo_client_url: null, numero: 'x' };
    expect(await completerLogoAttestation(s as never, 'att-1', payload)).toBe(
      payload,
    );
    expect(s.from).not.toHaveBeenCalled();
  });

  it('lecture en échec → contenu inchangé (« Savr » seul), jamais d’erreur', async () => {
    const s = sb([
      { data: { collecte_id: 'c1' } },
      { error: { message: 'x' } },
    ]);
    const payload = { numero: 'x' };
    expect(await completerLogoAttestation(s as never, 'att-2', payload)).toBe(
      payload,
    );
  });

  it('le worker PDF complète le logo des attestations avant le rendu', () => {
    const src = readFileSync(
      fileURLToPath(
        new URL('../../src/lib/pdf/pdf-worker.ts', import.meta.url),
      ),
      'utf8',
    );
    expect(src).toMatch(
      /pdfType === 'attestation-don'\s*\?\s*await completerLogoAttestation\(supabase, job\.entity_id, job\.payload\)/,
    );
    expect(src).toContain('await generatePdf(pdfType, payload)');
  });
});
