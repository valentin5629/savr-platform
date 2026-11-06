/**
 * Job attribution AG — email à l'association (§06.02 n°16). L'email au
 * transporteur (n°18) est retiré (revue des emails, Val 2026-10-28).
 *
 * Régression 2026-09-11 : le job appelait la RPC `fn_envoyer_email_template`, qui n'a
 * jamais existé (ni migration, ni dev, ni prod) → aucun email d'attribution n'était
 * envoyé. Il passe désormais par le canal canonique `sendEmail`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const single = vi.fn();
const rpc = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));
const sendEmail = vi.fn();
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { logger } from '@savr/shared/src/logger/index.js';

import { processAttributionValidee } from '../../src/lib/attribution-ag/job.js';

const PAYLOAD = {
  collecte_id: 'col-1',
  attribution_id: 'attr-1',
  association_id: 'asso-1',
  transporteur_id: 'tr-1',
  branche: 'idf',
  mode_validation: 'auto_accept',
};

const ATTRIBUTION = {
  id: 'attr-1',
  branche_attribution: 'idf',
  mode_validation: 'auto_accept',
  collectes: {
    id: 'col-1',
    date_collecte: '2026-05-28',
    heure_collecte: '22:00',
    volume_estime_repas: 120,
    evenements: {
      nom_evenement: 'Gala',
      pax: 400,
      lieux: { nom: 'Musée', adresse_acces: '53 av.', ville: 'Paris' },
    },
  },
  associations: {
    nom: 'Asso',
    adresse: '1 rue',
    ville: 'Paris',
    contact_email: 'asso@example.org',
  },
  transporteurs: {
    nom: 'A Toutes!',
    contact_email: 'transp@example.org',
    type_tms: 'a_toutes',
  },
};

describe('job attribution AG — emails via sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: ATTRIBUTION, error: null });
    sendEmail.mockResolvedValue(undefined);
  });

  it('un seul email, à l’association : date, heure et volume (revue des emails, Val 2026-10-28)', async () => {
    await processAttributionValidee(PAYLOAD);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      'ag_attribution_association',
      'asso@example.org',
      {
        evenement_nom: 'Gala',
        date_collecte: '28/05/2026',
        heure_collecte: '22:00',
        volume_estime_repas: '120',
      },
      { entityType: 'collectes', entityId: 'col-1' },
    );
    // Le transporteur reçoit sa mission par son outil, plus par email.
    expect(sendEmail).not.toHaveBeenCalledWith(
      'ag_attribution_transporteur',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    // L'ancienne RPC fictive n'est plus jamais appelée.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("échappe le texte saisi : aucun HTML d'un client ne part chez l'association", async () => {
    single.mockResolvedValue({
      data: {
        ...ATTRIBUTION,
        collectes: {
          ...ATTRIBUTION.collectes,
          evenements: {
            ...ATTRIBUTION.collectes.evenements,
            nom_evenement: '<a href="https://piege.example">Cliquez</a>',
          },
        },
      },
      error: null,
    });
    await processAttributionValidee(PAYLOAD);

    const v = sendEmail.mock.calls[0]![2] as Record<string, string>;
    expect(v.evenement_nom).toBe(
      '&lt;a href=&quot;https://piege.example&quot;&gt;Cliquez&lt;/a&gt;',
    );
  });

  it('un email en échec est tracé sans destinataire, le job aboutit', async () => {
    sendEmail.mockRejectedValueOnce(
      new Error('Template email introuvable : ag_attribution_association'),
    );
    const logErr = vi.spyOn(logger, 'error');

    await expect(processAttributionValidee(PAYLOAD)).resolves.toBeUndefined();

    expect(logErr).toHaveBeenCalledWith(
      'api.external.failed',
      expect.objectContaining({
        service: 'resend',
        template: 'ag_attribution_association',
      }),
    );
    expect(JSON.stringify(logErr.mock.calls)).not.toContain('@example.org');
    logErr.mockRestore();
  });

  it("attribution introuvable → le job lève (l'event sera retenté par la politique outbox)", async () => {
    single.mockResolvedValue({ data: null, error: { message: 'not found' } });
    await expect(processAttributionValidee(PAYLOAD)).rejects.toThrow(
      'Attribution introuvable',
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
