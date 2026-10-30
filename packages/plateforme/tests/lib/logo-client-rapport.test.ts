/**
 * Logo du client déposé depuis la fiche collecte (décision Val 2026-10-30).
 * Accès = celui du téléchargement du rapport ; logo rangé sur l'événement ;
 * rapports de don déjà fabriqués remis en fabrication.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const etat = vi.hoisted(() => ({
  collecteRls: null as Record<string, unknown> | null,
  collecteRlsErreur: null as unknown,
  logoActuel: null as string | null,
  collectesEvenement: [] as Array<{ id: string; statut: string }>,
  // Collectes AG avec don (non annulées, non « sans excédent ») de l'événement.
  nbAgAvecDon: 0,
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}));

function chaine(resultat: () => unknown, capture?: (v: unknown) => void) {
  const c: Record<string, unknown> = {
    then(ok: (v: unknown) => unknown) {
      return Promise.resolve(resultat()).then(ok);
    },
    single: () => Promise.resolve(resultat()),
    maybeSingle: () => Promise.resolve(resultat()),
  };
  for (const m of ['select', 'eq', 'order', 'limit', 'not']) c[m] = () => c;
  c.update = (v: unknown) => {
    capture?.(v);
    return c;
  };
  c.insert = (v: unknown) => {
    capture?.(v);
    return c;
  };
  return c;
}

vi.mock('@/lib/api-auth.js', () => ({
  createSupabaseServerClient: () => ({
    from: () =>
      chaine(() => ({ data: etat.collecteRls, error: etat.collecteRlsErreur })),
  }),
}));

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'evenements')
        return chaine(
          () => ({
            data: { logo_client_organisateur_url: etat.logoActuel },
            error: null,
          }),
          (v) => etat.updates.push(v as Record<string, unknown>),
        );
      if (table === 'audit_log')
        return chaine(
          () => ({ data: null, error: null }),
          (v) => etat.audits.push(v as Record<string, unknown>),
        );
      // collectes de l'événement (liste, ou comptage des AG avec don)
      return chaine(() => ({
        data: etat.collectesEvenement,
        count: etat.nbAgAvecDon,
        error: null,
      }));
    },
  }),
}));

const televerserLogo = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logo-upload.js', () => ({ televerserLogo }));

const regenerateCollecteDocument = vi.hoisted(() => vi.fn());
vi.mock('@/lib/pdf/regenerate.js', () => ({ regenerateCollecteDocument }));

const servirLogo = vi.hoisted(() =>
  vi.fn(async () => new NextResponse('img', { status: 200 })),
);
vi.mock('@/lib/logo-proxy.js', () => ({ servirLogo }));

// Bucket de l'environnement : la clé déposée doit le viser (lib/logo-key).
vi.mock('@savr/shared/src/r2/bucket.js', () => ({
  bucketEnvironnement: () => 'savr-test',
}));

import {
  deposerLogoClient,
  retirerLogoClient,
  servirLogoClient,
  type ActeurLogo,
} from '../../src/lib/evenements/logo-client-rapport.js';

const CLE = 'savr-test/logos/0f8fad5b-d9cb-469f-a165-70867728950e.png';
const req = {} as never;

const traiteur: ActeurLogo = {
  userId: 'u-1',
  role: 'traiteur_commercial',
  organisationId: 'org-traiteur',
  isStaff: false,
};
const admin: ActeurLogo = {
  userId: 'u-admin',
  role: 'admin_savr',
  organisationId: null,
  isStaff: true,
};

function collecte(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-1',
    type: 'anti_gaspi',
    statut: 'cloturee',
    evenement_id: 'ev-1',
    evenements: { organisation_id: 'org-traiteur' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  etat.collecteRls = collecte();
  etat.collecteRlsErreur = null;
  etat.logoActuel = null;
  etat.collectesEvenement = [];
  etat.nbAgAvecDon = 0;
  etat.updates = [];
  etat.audits = [];
  televerserLogo.mockResolvedValue({ cle: CLE });
  regenerateCollecteDocument.mockResolvedValue({
    ok: true,
    jobId: 'job',
    type: 'attestation-don',
  });
});

describe('contrôle d’accès (même garde que le téléchargement du rapport)', () => {
  it('collecte invisible sous la RLS → 404, rien envoyé au stockage', async () => {
    etat.collecteRls = null;
    const r = await deposerLogoClient(req, 'col-x', traiteur);
    expect(r.status).toBe(404);
    expect(televerserLogo).not.toHaveBeenCalled();
    expect(etat.updates).toHaveLength(0);
  });

  it('collecte annulée → 409, rien envoyé', async () => {
    etat.collecteRls = collecte({ statut: 'annulee' });
    const r = await deposerLogoClient(req, 'col-1', traiteur);
    expect(r.status).toBe(409);
    expect(televerserLogo).not.toHaveBeenCalled();
  });

  it('traiteur opérationnel d’une collecte AG programmée par une autre organisation → 403 (D12)', async () => {
    etat.collecteRls = collecte({
      evenements: { organisation_id: 'org-agence' },
    });
    const r = await deposerLogoClient(req, 'col-1', traiteur);
    expect(r.status).toBe(403);
    expect(televerserLogo).not.toHaveBeenCalled();
  });

  it('traiteur opérationnel, collecte ZD voisine d’une AG avec don de l’agence → 403 (D12 jugée sur l’événement)', async () => {
    etat.collecteRls = collecte({
      type: 'zero_dechet',
      evenements: { organisation_id: 'org-agence' },
    });
    etat.nbAgAvecDon = 1;
    const r = await deposerLogoClient(req, 'col-zd', traiteur);
    expect(r.status).toBe(403);
    expect(televerserLogo).not.toHaveBeenCalled();
    expect(etat.updates).toHaveLength(0);
  });

  it('traiteur opérationnel, collecte AG « sans excédent » voisine d’une AG avec don → 403, retrait compris', async () => {
    etat.collecteRls = collecte({
      statut: 'realisee_sans_collecte',
      evenements: { organisation_id: 'org-agence' },
    });
    etat.nbAgAvecDon = 1;
    expect((await deposerLogoClient(req, 'col-se', traiteur)).status).toBe(403);
    expect((await retirerLogoClient('col-se', traiteur)).status).toBe(403);
    expect(etat.updates).toHaveLength(0);
  });

  it('traiteur opérationnel, événement d’une agence sans attestation de don → autorisé', async () => {
    etat.collecteRls = collecte({
      type: 'zero_dechet',
      evenements: { organisation_id: 'org-agence' },
    });
    etat.nbAgAvecDon = 0;
    expect((await deposerLogoClient(req, 'col-zd', traiteur)).status).toBe(200);
  });

  it('gestionnaire de lieux sur une collecte d’un autre programmateur → autorisé', async () => {
    etat.collecteRls = collecte({
      evenements: { organisation_id: 'org-agence' },
    });
    const r = await deposerLogoClient(req, 'col-1', {
      ...traiteur,
      role: 'gestionnaire_lieux',
      organisationId: 'org-gest',
    });
    expect(r.status).toBe(200);
  });

  it('équipe Savr → autorisée sur toute collecte visible', async () => {
    etat.collecteRls = collecte({
      evenements: { organisation_id: 'org-agence' },
    });
    const r = await deposerLogoClient(req, 'col-1', admin);
    expect(r.status).toBe(200);
  });
});

describe('dépôt', () => {
  it('enregistre la clé sur l’événement et trace l’ancien et le nouveau logo', async () => {
    etat.logoActuel = null;
    const r = await deposerLogoClient(req, 'col-1', {
      ...traiteur,
      impersonatorId: 'u-admin-reel',
    });
    expect(r.status).toBe(200);
    expect(etat.updates).toEqual([{ logo_client_organisateur_url: CLE }]);
    expect(etat.audits).toHaveLength(1);
    expect(etat.audits[0]).toMatchObject({
      table_name: 'evenements',
      record_id: 'ev-1',
      action: 'logo_client_depose',
      user_id: 'u-1',
      impersonator_id: 'u-admin-reel',
      old_values: { logo_client_organisateur_url: null },
      new_values: { logo_client_organisateur_url: CLE, collecte_id: 'col-1' },
    });
  });

  it('erreur d’envoi (format, taille, stockage) → renvoyée telle quelle, rien écrit', async () => {
    televerserLogo.mockResolvedValue({
      reponse: NextResponse.json({ error: 'Format' }, { status: 422 }),
    });
    const r = await deposerLogoClient(req, 'col-1', traiteur);
    expect(r.status).toBe(422);
    expect(etat.updates).toHaveLength(0);
  });

  it('clé hors format (autre bucket) → 422, rien écrit', async () => {
    televerserLogo.mockResolvedValue({
      cle: 'savr-prod/logos/0f8fad5b-d9cb-469f-a165-70867728950e.png',
    });
    const r = await deposerLogoClient(req, 'col-1', traiteur);
    expect(r.status).toBe(422);
    expect(etat.updates).toHaveLength(0);
  });

  it('refait le rapport de don de chaque collecte AG de l’événement, selon son document', async () => {
    etat.collectesEvenement = [
      { id: 'c-don', statut: 'cloturee' },
      { id: 'c-vide', statut: 'realisee_sans_collecte' },
      { id: 'c-annulee', statut: 'annulee' },
      { id: 'c-future', statut: 'programmee' },
    ];
    regenerateCollecteDocument.mockImplementation(async (_sb, id: string) =>
      id === 'c-future'
        ? { ok: false, code: 'NO_DOCUMENT', message: '' }
        : { ok: true, jobId: 'j', type: 'x' },
    );
    const r = await deposerLogoClient(req, 'col-1', traiteur);
    const corps = (await r.json()) as { rapports_refaits: number };
    expect(corps.rapports_refaits).toBe(2);
    const appels = regenerateCollecteDocument.mock.calls.map((c) => [
      c[1],
      c[2],
    ]);
    expect(appels).toEqual([
      ['c-don', 'attestation-don'],
      ['c-vide', 'rapport-evenement-sans-excedent'],
      ['c-future', 'attestation-don'],
    ]);
  });
});

describe('retrait et aperçu', () => {
  it('retrait → null sur l’événement, trace « logo_client_retire »', async () => {
    etat.logoActuel = CLE;
    const r = await retirerLogoClient('col-1', traiteur);
    expect(r.status).toBe(200);
    expect(etat.updates).toEqual([{ logo_client_organisateur_url: null }]);
    expect(etat.audits[0]).toMatchObject({ action: 'logo_client_retire' });
    expect(televerserLogo).not.toHaveBeenCalled();
  });

  it('aperçu : sans logo → 404 ; avec logo → servi par le proxy', async () => {
    etat.logoActuel = null;
    expect((await servirLogoClient('col-1', traiteur)).status).toBe(404);
    etat.logoActuel = CLE;
    expect((await servirLogoClient('col-1', traiteur)).status).toBe(200);
    expect(servirLogo).toHaveBeenCalledWith({
      bucket: 'savr-test',
      key: 'logos/0f8fad5b-d9cb-469f-a165-70867728950e.png',
    });
  });

  it('aperçu refusé sur une collecte invisible → 404, aucune lecture du logo', async () => {
    etat.collecteRls = null;
    etat.logoActuel = CLE;
    expect((await servirLogoClient('col-x', traiteur)).status).toBe(404);
    expect(servirLogo).not.toHaveBeenCalled();
  });
});
