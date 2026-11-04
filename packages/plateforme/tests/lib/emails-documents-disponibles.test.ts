/**
 * Email « document disponible » envoyé une seule fois, à la clôture (48 h après
 * la collecte), quand le document existe (Val 2026-11-04). Reprend les règles
 * des emails autrefois envoyés par les batchs : destinataire, variables du
 * gabarit, lien vers la fiche de l'espace du programmeur, prénom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ statut: 'sent' }),
}));

import { sendEmail } from '@savr/shared/src/email/index.js';
import { envoyerEmailsDocumentsDisponibles } from '../../src/lib/pdf/emails-documents-disponibles.js';

function collecte(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-1',
    type: 'zero_dechet',
    date_collecte: '2026-11-01',
    co2_evite_kg: 45.25,
    taux_recyclage: 72.5,
    evenements: {
      nom_evenement: 'Gala Kaspia',
      date_evenement: '2026-11-01',
      organisation_id: 'org-1',
      programmeur: { prenom: 'Léa', organisation_id: 'org-1' },
      organisations: {
        email_principal: 'contact@kaspia.test',
        type: 'traiteur',
      },
      lieux: { nom: 'Grand Palais' },
    },
    attributions_antgaspi: null,
    ...overrides,
  };
}

function collecteAg(overrides: Record<string, unknown> = {}) {
  return collecte({
    id: 'col-ag',
    type: 'anti_gaspi',
    attributions_antgaspi: {
      volume_repas_realise: 120,
      associations: { nom: 'Les Restos du Cœur' },
    },
    ...overrides,
  });
}

/** Réponses dans l'ordre : collectes, emails envoyés, bordereaux, attestations. */
function makeSupabase(responses: Array<Record<string, unknown>>) {
  let idx = 0;
  const next = () => ({ data: [], error: null, ...responses[idx++] });
  const chain: Record<string, unknown> = {
    then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
      return Promise.resolve(next()).then(ok, ko);
    },
  };
  for (const m of [
    'select',
    'eq',
    'neq',
    'in',
    'not',
    'gt',
    'gte',
    'order',
    'limit',
  ]) {
    chain[m] = vi.fn(() => chain);
  }
  return { from: vi.fn(() => chain), _chain: chain };
}

function appels() {
  return vi.mocked(sendEmail).mock.calls as unknown as Array<
    [string, string, Record<string, string>, Record<string, unknown>]
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendEmail).mockResolvedValue({ statut: 'sent' });
});

describe('emails « document disponible » à la clôture', () => {
  it('sélection : collectes clôturées des 30 derniers jours', async () => {
    const sb = makeSupabase([{ data: [] }]);
    await envoyerEmailsDocumentsDisponibles(sb as never);
    const eq = (sb._chain.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eq).toContainEqual(['statut', 'cloturee']);
    const gte = (sb._chain.gte as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(gte[0]).toBe('realisee_at');
    const depuis = new Date(gte[1] as string).getTime();
    expect(
      Math.abs(depuis - (Date.now() - 30 * 24 * 3600 * 1000)),
    ).toBeLessThan(5000);
  });

  it('ZD avec bordereau émis : rapport_disponible au email_principal, variables du gabarit', async () => {
    const sb = makeSupabase([
      { data: [collecte()] },
      { data: [] },
      { data: [{ collecte_id: 'col-1', poids_total_kg: 120.5 }] },
      { data: [] },
    ]);
    const r = await envoyerEmailsDocumentsDisponibles(sb as never);

    expect(r.envoyes).toBe(1);
    const [slug, to, vars, opts] = appels()[0]!;
    expect(slug).toBe('rapport_disponible');
    expect(to).toBe('contact@kaspia.test');
    expect(Object.keys(vars).sort()).toEqual(
      [
        'co2_evite',
        'date_collecte',
        'lien_rapport',
        'lieu_nom',
        'nom_evenement',
        'poids_total',
        'prenom',
        'taux_recyclage',
      ].sort(),
    );
    expect(vars.prenom).toBe('Léa');
    expect(vars.poids_total).toBe('120,5');
    expect(vars.co2_evite).toBe('45,3');
    expect(vars.lien_rapport).toContain('/traiteur/collectes/col-1');
    expect(opts).toEqual({ entityType: 'collectes', entityId: 'col-1' });
  });

  it('ZD sans bordereau émis : rien n’est envoyé', async () => {
    const sb = makeSupabase([
      { data: [collecte()] },
      { data: [] },
      { data: [] },
      { data: [] },
    ]);
    const r = await envoyerEmailsDocumentsDisponibles(sb as never);
    expect(r.envoyes).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('AG avec attestation émise : attestation_don_disponible, repas et association', async () => {
    const sb = makeSupabase([
      { data: [collecteAg()] },
      { data: [] },
      { data: [] },
      { data: [{ collecte_id: 'col-ag' }] },
    ]);
    await envoyerEmailsDocumentsDisponibles(sb as never);
    const [slug, , vars] = appels()[0]!;
    expect(slug).toBe('attestation_don_disponible');
    expect(Object.keys(vars).sort()).toEqual(
      [
        'association_nom',
        'date_evenement',
        'lien_rapport',
        'nb_repas',
        'nom_evenement',
        'prenom',
      ].sort(),
    );
    expect(vars.nb_repas).toBe('120');
    expect(vars.association_nom).toBe('Les Restos du Cœur');
    expect(vars.date_evenement).toBe('01/11/2026');
  });

  it('AG sans attestation émise (poids pas encore saisi) : rien n’est envoyé', async () => {
    const sb = makeSupabase([
      { data: [collecteAg()] },
      { data: [] },
      { data: [] },
      { data: [] },
    ]);
    await envoyerEmailsDocumentsDisponibles(sb as never);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('collecte déjà prévenue (ligne emails_envoyes) : jamais un second email', async () => {
    const sb = makeSupabase([
      { data: [collecte()] },
      { data: [{ entity_id: 'col-1' }] },
      { data: [{ collecte_id: 'col-1', poids_total_kg: 10 }] },
      { data: [] },
    ]);
    await envoyerEmailsDocumentsDisponibles(sb as never);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('lecture des emails envoyés en échec : rien n’est envoyé (pas de doublon possible)', async () => {
    const sb = makeSupabase([
      { data: [collecte()] },
      { data: null, error: { message: 'timeout' } },
    ]);
    const r = await envoyerEmailsDocumentsDisponibles(sb as never);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(r.errors[0]).toContain('timeout');
  });

  it.each([
    ['agence', '/agence/collectes/col-1'],
    ['gestionnaire_lieux', '/gestionnaire/collectes/col-1'],
    ['traiteur', '/traiteur/collectes/col-1'],
  ])(
    'lien vers la fiche de l’espace du programmeur (%s)',
    async (type, chemin) => {
      const c = collecte();
      c.evenements.organisations.type = type;
      const sb = makeSupabase([
        { data: [c] },
        { data: [] },
        { data: [{ collecte_id: 'col-1', poids_total_kg: 10 }] },
        { data: [] },
      ]);
      await envoyerEmailsDocumentsDisponibles(sb as never);
      expect(appels()[0]![2].lien_rapport).toContain(chemin);
    },
  );

  it('programmeur d’une autre organisation : son prénom n’est pas repris', async () => {
    const c = collecte();
    c.evenements.programmeur = { prenom: 'Sam', organisation_id: 'org-savr' };
    const sb = makeSupabase([
      { data: [c] },
      { data: [] },
      { data: [{ collecte_id: 'col-1', poids_total_kg: 10 }] },
      { data: [] },
    ]);
    await envoyerEmailsDocumentsDisponibles(sb as never);
    expect(appels()[0]![2].prenom).toBe('');
  });

  it('AG, événement sans nom : « Votre événement »', async () => {
    const c = collecteAg();
    (c.evenements as Record<string, unknown>).nom_evenement = '  ';
    const sb = makeSupabase([
      { data: [c] },
      { data: [] },
      { data: [] },
      { data: [{ collecte_id: 'col-ag' }] },
    ]);
    await envoyerEmailsDocumentsDisponibles(sb as never);
    expect(appels()[0]![2].nom_evenement).toBe('Votre événement');
  });

  it('un envoi en échec ne prive pas la collecte suivante du sien', async () => {
    vi.mocked(sendEmail)
      .mockRejectedValueOnce(new Error('Resend KO'))
      .mockResolvedValueOnce({ statut: 'sent' });
    const sb = makeSupabase([
      { data: [collecte(), collecte({ id: 'col-2' })] },
      { data: [] },
      {
        data: [
          { collecte_id: 'col-1', poids_total_kg: 10 },
          { collecte_id: 'col-2', poids_total_kg: 20 },
        ],
      },
      { data: [] },
    ]);
    const r = await envoyerEmailsDocumentsDisponibles(sb as never);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(r.envoyes).toBe(1);
    expect(r.errors).toHaveLength(1);
  });
});
