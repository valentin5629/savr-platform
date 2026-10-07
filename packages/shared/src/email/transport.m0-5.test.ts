/**
 * Transport Resend — garde hors production, configuration lue à l'envoi, journaux.
 *
 * Le SDK est mocké : aucun envoi réel. Chaque cas pose explicitement les quatre
 * variables qui décident du comportement (VERCEL_ENV, EMAIL_REDIRECT_TO,
 * RESEND_API_KEY, RESEND_FROM) ; `vi.unstubAllEnvs()` les rend après chaque cas.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const mockSend = vi.fn();
  const ResendCtor = vi.fn(() => ({ emails: { send: mockSend } }));
  const throttle = vi.fn(async () => {});
  const honor = vi.fn();
  return { mockSend, ResendCtor, throttle, honor };
});

vi.mock('resend', () => ({ Resend: h.ResendCtor }));
// Espacement neutralisé (aucune attente réelle) ; parseRetryAfter reste le vrai.
vi.mock('../rate-limit/outbound-throttle.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../rate-limit/outbound-throttle.js')
  >()),
  throttleOutbound: h.throttle,
  honorRetryAfter: h.honor,
}));

import { logger } from '../logger/index.js';
import { dispatchToResend, type EmailMessage } from './transport.js';

const CLE = 're_cle_secrete_ne_doit_jamais_etre_journalisee';
const FROM = 'Savr <notifications@envoi.savr-test.local>';
const REDIRECTION = 'recette@savr-test.local';

const MESSAGE: EmailMessage = {
  to: 'jean@traiteur-test.fr',
  cc: ['copie@traiteur-test.fr'],
  bcc: 'cachee@traiteur-test.fr',
  replyTo: 'reponse@savr-test.local',
  subject: 'Votre collecte est confirmée',
  html: '<p>Bonjour Jean, contenu confidentiel du message</p>',
};

interface Env {
  vercelEnv?: string;
  redirectTo?: string;
  apiKey?: string;
  from?: string;
}

function poserEnv(env: Env): void {
  vi.stubEnv('VERCEL_ENV', env.vercelEnv);
  vi.stubEnv('EMAIL_REDIRECT_TO', env.redirectTo);
  vi.stubEnv('RESEND_API_KEY', env.apiKey);
  vi.stubEnv('RESEND_FROM', env.from);
}

const PRODUCTION: Env = { vercelEnv: 'production', apiKey: CLE, from: FROM };
const PREVIEW: Env = {
  vercelEnv: 'preview',
  redirectTo: REDIRECTION,
  apiKey: CLE,
  from: FROM,
};

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

// Tout ce qui a été journalisé pendant le cas, à plat, pour y chercher une fuite.
const journal = (): string =>
  JSON.stringify([info.mock.calls, warn.mock.calls, error.mock.calls]);

const envoye = (): Record<string, unknown> =>
  h.mockSend.mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  h.mockSend.mockResolvedValue({ data: { id: 'rs_123' }, error: null });
  info = vi.spyOn(logger, 'info').mockImplementation(() => {});
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  error = vi.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('M0.5 / transport Resend — configuration lue à l’envoi', () => {
  it('import du module sans aucune variable → aucune erreur (rien n’est validé au chargement)', async () => {
    poserEnv({});
    vi.resetModules();
    await expect(import('./transport.js')).resolves.toHaveProperty(
      'dispatchToResend',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ['RESEND_FROM', { ...PRODUCTION, from: undefined }, ['RESEND_FROM']],
    ['RESEND_FROM vide', { ...PRODUCTION, from: '  ' }, ['RESEND_FROM']],
    [
      'RESEND_API_KEY',
      { ...PRODUCTION, apiKey: undefined },
      ['RESEND_API_KEY'],
    ],
    [
      'les deux',
      { ...PRODUCTION, apiKey: undefined, from: undefined },
      ['RESEND_API_KEY', 'RESEND_FROM'],
    ],
  ])(
    'configuration manquante (%s) → erreur claire, log d’erreur, aucun appel Resend',
    async (_cas, env, absentes) => {
      poserEnv(env as Env);

      await expect(dispatchToResend(MESSAGE)).rejects.toThrow(
        `Configuration email incomplète — variable(s) d'environnement absente(s) : ${(absentes as string[]).join(', ')}. Aucun email envoyé.`,
      );

      expect(error).toHaveBeenCalledWith('email.configuration_manquante', {
        variables_absentes: absentes,
      });
      expect(h.ResendCtor).not.toHaveBeenCalled();
      expect(h.mockSend).not.toHaveBeenCalled();
    },
  );

  it('hors production avec redirection : la configuration reste exigée (un envoi va partir)', async () => {
    poserEnv({ ...PREVIEW, from: undefined });

    await expect(dispatchToResend(MESSAGE)).rejects.toThrow('RESEND_FROM');
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it('RESEND_API_KEY=test → puits : aucun appel, aucune configuration exigée', async () => {
    poserEnv({ vercelEnv: 'production', apiKey: 'test' });

    await expect(dispatchToResend(MESSAGE)).resolves.toEqual({
      resendId: null,
      statut: 'sent',
      erreur: null,
    });
    expect(h.ResendCtor).not.toHaveBeenCalled();
  });
});

describe('M0.5 / transport Resend — production', () => {
  it('VERCEL_ENV=production → expéditeur RESEND_FROM, destinataires, objet et corps inchangés, même si EMAIL_REDIRECT_TO est posée', async () => {
    poserEnv({ ...PRODUCTION, redirectTo: REDIRECTION });

    const outcome = await dispatchToResend(MESSAGE);

    expect(outcome).toEqual({
      resendId: 'rs_123',
      statut: 'sent',
      erreur: null,
    });
    expect(h.ResendCtor).toHaveBeenCalledWith(CLE);
    expect(h.mockSend).toHaveBeenCalledTimes(1);
    expect(envoye()).toEqual({ from: FROM, ...MESSAGE });
  });
});

describe('M0.5 / transport Resend — hors production', () => {
  it('avec EMAIL_REDIRECT_TO → to, cc et bcc remplacés, replyTo intact, objet préfixé [PREVIEW], bandeau en tête du corps', async () => {
    poserEnv(PREVIEW);

    const outcome = await dispatchToResend(MESSAGE);

    expect(outcome.statut).toBe('sent');
    expect(envoye()).toEqual({
      from: FROM,
      to: REDIRECTION,
      cc: REDIRECTION,
      bcc: REDIRECTION,
      replyTo: MESSAGE.replyTo,
      subject: '[PREVIEW] Votre collecte est confirmée',
      html: expect.stringMatching(
        /^<div [^>]*>Destinataires d'origine : jean@traiteur-test\.fr ; cc : copie@traiteur-test\.fr ; cci : cachee@traiteur-test\.fr<\/div><p>Bonjour Jean, contenu confidentiel du message<\/p>$/,
      ),
    });
  });

  it('message sans cc ni bcc → seul `to` est posé, aucun champ destinataire ajouté', async () => {
    poserEnv(PREVIEW);

    await dispatchToResend({
      to: ['a@traiteur-test.fr', 'b@traiteur-test.fr'],
      subject: 'Objet',
      html: '<p>Corps</p>',
    });

    expect(envoye()).toEqual({
      from: FROM,
      to: REDIRECTION,
      subject: '[PREVIEW] Objet',
      html: expect.stringContaining(
        "Destinataires d'origine : a@traiteur-test.fr, b@traiteur-test.fr</div>",
      ),
    });
  });

  it('bandeau : les adresses d’origine sont échappées (aucun HTML injecté par un destinataire)', async () => {
    poserEnv(PREVIEW);

    await dispatchToResend({
      to: 'Jean <jean@traiteur-test.fr> & "Cie"',
      subject: 'Objet',
      html: '<p>Corps</p>',
    });

    expect(envoye()['html']).toContain(
      'Jean &lt;jean@traiteur-test.fr&gt; &amp; &quot;Cie&quot;</div>',
    );
  });

  it('sans EMAIL_REDIRECT_TO → statut skipped, avertissement, aucun appel Resend, aucune erreur — même sans configuration', async () => {
    poserEnv({ vercelEnv: 'preview' });

    await expect(dispatchToResend(MESSAGE)).resolves.toEqual({
      resendId: null,
      statut: 'skipped',
      erreur: null,
    });

    expect(warn).toHaveBeenCalledWith(
      'email.envoi_ignore',
      expect.objectContaining({
        raison: 'hors_production_sans_redirection',
        vercel_env: 'preview',
      }),
    );
    expect(error).not.toHaveBeenCalled();
    expect(h.ResendCtor).not.toHaveBeenCalled();
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it('EMAIL_REDIRECT_TO réduite à des espaces → traitée comme absente (skipped)', async () => {
    poserEnv({ ...PREVIEW, redirectTo: '   ' });

    const outcome = await dispatchToResend(MESSAGE);

    expect(outcome.statut).toBe('skipped');
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  it('VERCEL_ENV absent + EMAIL_REDIRECT_TO → redirigé, objet préfixé [DEV]', async () => {
    poserEnv({ ...PREVIEW, vercelEnv: undefined });

    await dispatchToResend(MESSAGE);

    expect(envoye()).toMatchObject({
      to: REDIRECTION,
      cc: REDIRECTION,
      bcc: REDIRECTION,
      subject: '[DEV] Votre collecte est confirmée',
    });
  });

  it('VERCEL_ENV absent sans EMAIL_REDIRECT_TO → skipped (local, CI : rien ne part)', async () => {
    poserEnv({ apiKey: CLE, from: FROM });

    const outcome = await dispatchToResend(MESSAGE);

    expect(outcome.statut).toBe('skipped');
    expect(warn).toHaveBeenCalledWith(
      'email.envoi_ignore',
      expect.objectContaining({ vercel_env: null }),
    );
    expect(h.mockSend).not.toHaveBeenCalled();
  });

  // Seule la valeur exacte 'production' ouvre l'envoi aux vrais destinataires.
  it.each(['preview', 'development', 'Production', 'prod', 'production ', ''])(
    'VERCEL_ENV=%j → jamais un destinataire d’origine dans l’appel Resend',
    async (vercelEnv) => {
      poserEnv({ ...PREVIEW, vercelEnv });

      await dispatchToResend(MESSAGE);

      expect(h.mockSend).toHaveBeenCalledTimes(1);
      const { to, cc, bcc } = envoye();
      expect([to, cc, bcc]).toEqual([REDIRECTION, REDIRECTION, REDIRECTION]);
    },
  );

  // Sur Vercel, NODE_ENV vaut 'production' en Preview aussi : il ne doit jamais
  // suffire à ouvrir l'envoi aux vrais destinataires.
  it.each(['preview', undefined])(
    'NODE_ENV=production avec VERCEL_ENV=%j → toujours hors production (redirigé)',
    async (vercelEnv) => {
      poserEnv({ ...PREVIEW, vercelEnv });
      vi.stubEnv('NODE_ENV', 'production');

      await dispatchToResend(MESSAGE);

      expect(envoye()).toMatchObject({
        to: REDIRECTION,
        cc: REDIRECTION,
        bcc: REDIRECTION,
      });
    },
  );
});

describe('M0.5 / transport Resend — résultat et journaux', () => {
  it('{ error } renvoyé par le SDK → statut failed propagé, statut HTTP, nom et message journalisés', async () => {
    poserEnv(PRODUCTION);
    h.mockSend.mockResolvedValue({
      data: null,
      error: {
        statusCode: 403,
        name: 'validation_error',
        message: 'The gosavr.io domain is not verified.',
      },
      headers: null,
    });

    const outcome = await dispatchToResend(MESSAGE);

    expect(outcome).toEqual({
      resendId: null,
      statut: 'failed',
      erreur: 'The gosavr.io domain is not verified.',
    });
    expect(error).toHaveBeenCalledWith('api.external.failed', {
      service: 'resend',
      endpoint: 'resend.send',
      http_status: 403,
      error_code: 'validation_error',
      message: 'The gosavr.io domain is not verified.',
    });
    expect(info).not.toHaveBeenCalled();
    expect(h.honor).not.toHaveBeenCalled();
  });

  it('429 rate_limit_exceeded → Retry-After honoré, échec propagé', async () => {
    poserEnv(PRODUCTION);
    h.mockSend.mockResolvedValue({
      data: null,
      error: {
        statusCode: 429,
        name: 'rate_limit_exceeded',
        message: 'Too many requests',
      },
      headers: { 'retry-after': '30' },
    });

    const outcome = await dispatchToResend(MESSAGE);

    expect(outcome.statut).toBe('failed');
    expect(h.honor).toHaveBeenCalledWith('resend', 30);
  });

  it('succès → id Resend journalisé et renvoyé', async () => {
    poserEnv(PRODUCTION);

    const outcome = await dispatchToResend(MESSAGE);

    expect(outcome.resendId).toBe('rs_123');
    expect(info).toHaveBeenCalledWith(
      'api.external.called',
      expect.objectContaining({
        service: 'resend',
        endpoint: 'resend.send',
        resend_id: 'rs_123',
      }),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ['succès', { data: { id: 'rs_123' }, error: null }],
    [
      'échec',
      {
        data: null,
        error: { statusCode: 500, name: 'application_error', message: 'KO' },
      },
    ],
  ])(
    'journaux (%s) : ni la clé API, ni le contenu, ni un destinataire',
    async (_cas, reponse) => {
      poserEnv(PREVIEW);
      h.mockSend.mockResolvedValue(reponse);

      await dispatchToResend(MESSAGE);

      const trace = journal();
      expect(trace).not.toContain(CLE);
      expect(trace).not.toContain('contenu confidentiel');
      expect(trace).not.toContain('traiteur-test.fr');
      expect(trace).not.toContain(REDIRECTION);
    },
  );
});
