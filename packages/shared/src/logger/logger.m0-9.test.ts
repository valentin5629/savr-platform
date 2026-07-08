import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  logger,
  sanitizePayload,
  setLogContext,
  clearLogContext,
  runWithTrace,
  getTraceId,
  generateTraceId,
  extractOrCreateTraceId,
} from './index.js';

describe('M0.9 — Logger structuré', () => {
  beforeEach(() => {
    clearLogContext();
  });

  it('émet une ligne JSON conforme au schéma figé sur stdout', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('collecte.scheduled', { collecte_id: 'abc', type: 'zd' });

    expect(spy).toHaveBeenCalledOnce();
    const raw = spy.mock.calls[0]![0]! as string;
    const entry = JSON.parse(raw);

    expect(entry).toMatchObject({
      level: 'info',
      service: 'platform',
      event: 'collecte.scheduled',
      payload: { collecte_id: 'abc', type: 'zd' },
    });
    expect(typeof entry.ts).toBe('string');
    expect(entry.actor_id).toBeNull();
    expect(entry.actor_role).toBeNull();
    expect(entry.org_id).toBeNull();

    spy.mockRestore();
  });

  it('émet level warn correctement', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.warn('pesee.hors_seuil', {
      pesee_id: '1',
      collecte_id: '2',
      type_depassement: 'max',
    });

    const entry = JSON.parse(spy.mock.calls[0]![0]! as string);
    expect(entry.level).toBe('warn');

    spy.mockRestore();
  });

  it('émet level error correctement', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.error('pdf.job_failed', {
      job_id: '1',
      type_doc: 'bordereau',
      collecte_id: '2',
      retry_count: 3,
    });

    const entry = JSON.parse(spy.mock.calls[0]![0]! as string);
    expect(entry.level).toBe('error');

    spy.mockRestore();
  });

  it('propage le contexte global (actor_id, org_id, actor_role)', () => {
    setLogContext({
      actor_id: 'user-1',
      actor_role: 'admin_savr',
      org_id: 'org-1',
    });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('organisation.created', { org_id: 'org-1' });

    const entry = JSON.parse(spy.mock.calls[0]![0]! as string);
    expect(entry.actor_id).toBe('user-1');
    expect(entry.actor_role).toBe('admin_savr');
    expect(entry.org_id).toBe('org-1');

    spy.mockRestore();
  });

  it("permet un override de contexte au niveau de l'appel", () => {
    setLogContext({ actor_id: 'user-global', actor_role: 'admin_savr' });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info(
      'user.invited',
      {},
      { actor_id: 'user-override', actor_role: 'traiteur_manager' },
    );

    const entry = JSON.parse(spy.mock.calls[0]![0]! as string);
    expect(entry.actor_id).toBe('user-override');
    expect(entry.actor_role).toBe('traiteur_manager');

    spy.mockRestore();
  });
});

describe('M0.9 — sanitizePayload (RGPD)', () => {
  it('ne laisse jamais un email en clair', () => {
    const result = sanitizePayload({ email: 'valentin@gosavr.io' });
    expect(result.email).not.toBe('valentin@gosavr.io');
    expect(result.email).toContain('***');
  });

  it('masque les champs sensibles (password, token)', () => {
    const result = sanitizePayload({
      password: 'secret123',
      token: 'jwt.xxx.yyy',
    });
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
  });

  it('laisse passer les champs non sensibles', () => {
    const result = sanitizePayload({ collecte_id: 'abc', poids_kg: 42 });
    expect(result.collecte_id).toBe('abc');
    expect(result.poids_kg).toBe(42);
  });

  it('masque un email niché dans un objet imbriqué', () => {
    const result = sanitizePayload({
      user: { prenom: 'Val', email: 'valentin@gosavr.io' },
    });
    const user = result.user as Record<string, unknown>;
    expect(user.email).not.toBe('valentin@gosavr.io');
    expect(user.email).toContain('***');
    // La clé voisine non sensible reste intacte.
    expect(user.prenom).toBe('Val');
  });

  it('masque les emails dans un tableau d’objets imbriqués', () => {
    const result = sanitizePayload({
      items: [
        { id: 1, email: 'a@b.io' },
        { id: 2, email: 'c@d.io' },
      ],
    });
    const items = result.items as Array<Record<string, unknown>>;
    expect(items[0]!.email).toContain('***');
    expect(items[0]!.email).not.toBe('a@b.io');
    expect(items[1]!.email).toContain('***');
    expect(items[0]!.id).toBe(1);
  });

  it('masque toute clé contenant « email » (pas seulement === email)', () => {
    const result = sanitizePayload({ contact_email: 'jean@traiteur.fr' });
    expect(result.contact_email).not.toBe('jean@traiteur.fr');
    expect(result.contact_email).toContain('***');
  });

  it('masque telephone, phone et siret ([REDACTED])', () => {
    const result = sanitizePayload({
      telephone: '0601020304',
      phone: '+33601020304',
      siret: '12345678900011',
    });
    expect(result.telephone).toBe('[REDACTED]');
    expect(result.phone).toBe('[REDACTED]');
    expect(result.siret).toBe('[REDACTED]');
  });

  it('masque telephone/siret nichés en profondeur', () => {
    const result = sanitizePayload({
      org: { contact: { telephone: '0601020304', siret: '12345678900011' } },
    });
    const contact = (result.org as Record<string, unknown>).contact as Record<
      string,
      unknown
    >;
    expect(contact.telephone).toBe('[REDACTED]');
    expect(contact.siret).toBe('[REDACTED]');
  });

  it('ne sur-masque PAS un email déjà haché ni le montant de facture', () => {
    // §07/01 : actor_email_hash doit rester lisible pour corrélation (pas d'@).
    const result = sanitizePayload({
      actor_email_hash: 'a1b2c3d4e5',
      montant_ttc: 1234.56,
    });
    expect(result.actor_email_hash).toBe('a1b2c3d4e5');
    expect(result.montant_ttc).toBe(1234.56);
  });
});

// ── BL-P2-44 — OTel léger : trace_id généré + propagé (AsyncLocalStorage) ─────
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('M0.9 — BL-P2-44 trace_id (OTel léger, §07/01 l.20/l.30)', () => {
  beforeEach(() => clearLogContext());

  it('M0.9-21 — trace_id genere par requete (uuid) + propage via AsyncLocalStorage', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Aucune en-tete entrante → un uuid est genere pour la requete.
    const traceId = extractOrCreateTraceId(() => undefined);
    expect(traceId).toMatch(UUID_RE);
    // Le log emis PENDANT le contexte de trace porte ce trace_id.
    runWithTrace(traceId, () => {
      logger.info('collecte.scheduled', { collecte_id: 'c-1', type: 'zd' });
      expect(getTraceId()).toBe(traceId);
    });
    const entry = JSON.parse(spy.mock.calls[0]![0] as string) as {
      trace_id: string | null;
    };
    expect(entry.trace_id).toBe(traceId);
    spy.mockRestore();
  });

  it('M0.9-22 — isolation ALS : deux runWithTrace concurrents ne partagent pas leur trace_id', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Deux "requetes" entrelacees (yield sur une microtache entre l'ouverture du
    // contexte et le log). Un etat MODULE-GLOBAL (le piege _context) ferait fuiter
    // le trace_id de l'une vers l'autre → cet oracle ROUGIRAIT. ALS les isole.
    async function requete(id: string): Promise<string | null> {
      return runWithTrace(id, async () => {
        await Promise.resolve();
        logger.info('evenement.created', { marqueur: id });
        return getTraceId();
      });
    }
    const [a, b] = await Promise.all([requete('trace-A'), requete('trace-B')]);
    expect(a).toBe('trace-A');
    expect(b).toBe('trace-B');
    // Chaque ligne de log porte le trace_id de SA requete (pas de fuite croisee).
    const parTrace = Object.fromEntries(
      spy.mock.calls
        .map(
          (c) =>
            JSON.parse(c[0] as string) as {
              trace_id: string | null;
              payload: { marqueur?: string };
            },
        )
        .filter((e) => e.payload.marqueur)
        .map((e) => [e.payload.marqueur, e.trace_id]),
    );
    expect(parTrace['trace-A']).toBe('trace-A');
    expect(parTrace['trace-B']).toBe('trace-B');
    spy.mockRestore();
  });

  it('M0.9-24 — hors contexte trace : trace_id null (fallback, non-regression)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Aucun runWithTrace autour → fallback sur _context (vide) → null. Le schema
    // fige (§07/01) reste conforme : la cle trace_id est presente, a null.
    logger.info('collecte.scheduled', { collecte_id: 'c-2', type: 'zd' });
    const entry = JSON.parse(spy.mock.calls[0]![0] as string) as {
      trace_id: string | null;
    };
    expect(entry.trace_id).toBeNull();
    expect(generateTraceId()).toMatch(UUID_RE); // generateur = uuid v4
    spy.mockRestore();
  });
});
